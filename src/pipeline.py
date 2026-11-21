"""Pipeline (part 1): 4 inputs → public data + SITG + vision → 19 features → llm_input.json.

Inputs (client form): client_name, company_legal_name (exact, Zefix), Geneva building address, industry_type.
Optional technical hint: website. Everything else is researched automatically or marked unknown.

The output (llm_input.json) is the hand-off to the final-report LLM (separate step):
- run(...)            → the full JSON, photos embedded as base64 (for the report)
- for_llm_text(doc)   → the same JSON without the photos (what is sent to the LLM as text)
"""

import base64
import copy
import re
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from src import building_condition as bc
from src import features as feat
from src import geneva, reconstruction
from src.blocks import block_aerial, block_facade, block_public, block_website
from src.company_profile import company_profile
from src.llm import build_metrics
from src.public_data import probe, strip_binary
from src.web_scrape import scrape


class InputError(Exception):
    """Company or address not found / ambiguous / out of scope → shown to the user (HTTP 422), no JSON."""


class ServiceError(Exception):
    """An external public service failed (timeout, outage) → retry later (HTTP 503); not the client's fault."""


# Geneva cadastre destination -> RegBL building class (usage label and m3 reconstruction prices).
# Needed because RegBL classes are sometimes wrong in GE (a 3,500 m2 workshop registered as a single-family house).
GE_DESTINATION_TO_GKLAS = {"Atelier": 1251, "Usine": 1251, "Hangar": 1251, "Autre bât. d'activités": 1274,
                           "Dépôt": 1252, "Entrepôt": 1252, "Garage": 1242, "Bureaux": 1220, "Commerce": 1230}

IMAGE_NAMES = {"aerial_image": "orthophoto.jpg", "facade": "facade_streetview.jpg"}  # website photos: website_N.jpg


def _safe(future, photos_from=None):
    """A vision block that fails (timeout, invalid JSON twice…) degrades to status=error; the pipeline continues."""
    try:
        return future.result()
    except Exception as e:  # noqa: BLE001
        ok = photos_from and photos_from.get("jpeg")
        photos = [{"label": "Orthophoto SWISSIMAGE", "jpeg": photos_from["jpeg"], "credit": "© swisstopo"}] if ok else []
        return {"status": "error", "note": f"{type(e).__name__}: {str(e)[:160]}", "data": None, "photos": photos}


def _resolve(company: str, address: str) -> tuple[dict, dict]:
    """Public data + register profile, with the hard input checks."""
    with ThreadPoolExecutor(2) as ex:
        f_probe = ex.submit(probe, company, address, None)
        f_prof = ex.submit(company_profile, company)
        pdata, _ = f_probe.result()
        if pdata.get("error"):
            raise (ServiceError if pdata.get("error_kind") == "service" else InputError)(pdata["error"])
        geo = pdata.get("geocode") or {}
        if not geo.get("house_number_matched"):  # never report on a neighbouring building
            raise InputError(f"House number not found for '{address}'. Closest official address: '{geo.get('label')}'.")
        try:
            profile = f_prof.result()
        except Exception as e:  # noqa: BLE001 — unofficial API: degrade, never fail
            profile = {"status": "error", "error": str(e)[:200]}
    canton = pdata.get("regbl", {}).get("fields", {}).get("gdekt")
    if canton != "GE":
        raise InputError(f"Out of scope: AXA Smart Property currently covers buildings in the canton of Geneva only (found: {canton}).")
    return pdata, profile


def _geneva(pdata: dict) -> dict:
    """SITG data; rejects housing / mixed-use buildings (the Geneva cadastre is authoritative)."""
    regbl, footprint = pdata.get("regbl", {}).get("fields", {}), pdata.get("footprint", {})
    try:
        ge = {"establishment": geneva.establishment((pdata.get("zefix") or {}).get("uid"), regbl.get("egid"))}
        ge.update(geneva.building(regbl.get("egid"), footprint.get("geometry")))
    except Exception as e:  # noqa: BLE001
        return {"status": "error", "error": str(e)[:200]}
    cls = (ge.get("building") or {}).get("nomen_classe") or ""
    if cls.startswith(("Mixte", "Habitation", "Logement")):  # official classes: Habitation, Mixte: logements/…
        raise InputError(f"Out of scope: the Geneva cadastre classifies this building as '{cls}'. "
                         "AXA Smart Property covers companies with their own activity building.")
    return ge


def _building_inputs(regbl: dict, gb: dict, ge: dict, footprint_m2: float | None, observed_floors: int | None):
    """RegBL completed with SITG, with plausibility checks. Returns (regbl_plus, observed_floors, volume_note)."""
    rb = dict(regbl)
    if gb.get("destination") in GE_DESTINATION_TO_GKLAS:
        rb["gklas"] = GE_DESTINATION_TO_GKLAS[gb["destination"]]
    rb["gastw"] = regbl.get("gastw") or gb.get("niveaux_horsol")
    rb["gbauj"] = regbl.get("gbauj") or gb.get("annee_construction")
    # The energy index / RegBL area sometimes covers a whole group of buildings → keep only if <= footprint x levels x 1.3
    levels = rb["gastw"]
    max_area = footprint_m2 * (levels or 3) * 1.3 if footprint_m2 else None
    area = regbl.get("gebf") or (ge.get("energy") or {}).get("heated_area_m2")
    rb["gebf"] = area if (area and (not max_area or area <= max_area)) else None
    if area and not rb["gebf"] and ge.get("energy"):
        ge["energy"]["heated_area_m2_rejected"] = area
        ge["energy"]["heated_area_m2"] = None
    volume_note = None
    if not regbl.get("gvol") and gb.get("surface") and gb.get("hauteur"):
        # Cadastre footprint x height = volume; the height can include chimneys (a 1-level workshop at 29 m) → check it.
        h, lv = gb["hauteur"], gb.get("niveaux_horsol")
        if (h <= lv * 7) if lv else (h <= 15):
            rb["gvol"] = round(gb["surface"] * h)
        else:
            rb["gastw"] = rb.get("gastw") or lv or 1
            observed_floors = None
            volume_note = f"cadastre height {h} m rejected as implausible for {lv or 'unknown'} level(s)"
    if not rb["gastw"] and gb.get("hauteur"):  # height → floors estimate (~4 m per level for workshops)
        observed_floors = observed_floors or max(1, round(gb["hauteur"] / 4))
    return rb, observed_floors, volume_note


def run(client_name: str, company: str, address: str, industry_type: str | None = None, website: str | None = None,
        use_llm: bool = True) -> dict:
    """Returns llm_input.json as a dict. use_llm=False: no vision call (0 token)."""
    t0 = time.perf_counter()
    m = re.search(r"\b(\d{4})\s+(.+)$", address.split(",")[-1].strip())
    zip_code, town = (m.group(1), m.group(2)) if m else (None, None)

    pdata, profile = _resolve(company, address)
    regbl, footprint = pdata.get("regbl", {}).get("fields", {}), pdata.get("footprint", {})
    ge = _geneva(pdata)

    # The cantonal company register gives the website → feeds the scraper.
    try:
        scraped = scrape(company, zip_code, town, website or (ge.get("establishment") or {}).get("website"))
    except Exception as e:  # noqa: BLE001
        scraped = {"status": "error", "note": str(e)[:200]}

    # Vision blocks in parallel: orthophoto, street-level facade, website (text + photos).
    purpose = (pdata.get("zefix") or {}).get("purpose")
    with ThreadPoolExecutor(3) as ex:
        f_a = ex.submit(block_aerial, pdata, use_llm)
        f_f = ex.submit(block_facade, pdata, company, address, use_llm)
        f_w = ex.submit(block_website, scraped, company, address, purpose, use_llm)
        aerial, facade, web = _safe(f_a, photos_from=pdata.get("swissimage")), _safe(f_f), _safe(f_w)

    gb = ge.get("building") or {}
    rb, observed_floors, volume_note = _building_inputs(
        regbl, gb, ge, footprint.get("area_m2"), (web.get("data") or {}).get("floors_visible_on_photos"))
    rc = reconstruction.estimate(rb, footprint.get("area_m2"), observed_floors)
    if volume_note and rc.get("method"):
        rc["method"] += f" ({volume_note})"
    public = block_public(pdata, profile, rc)
    public["data"]["geneva"] = ge
    reno_year = gb.get("annee_transformation") or next(
        (int(x["date"][:4]) for x in ge.get("renovation_permits", []) if x.get("date")), None)
    public["data"]["building"]["condition"] = bc.condition(rb, reno_year, (aerial.get("data") or {}).get("pv_panels"))
    public["data"]["building"]["heating"] = bc.heating(regbl)

    blocks = {"public_data": public, "aerial_image": aerial, "facade": facade, "website": web}
    fs = feat.build(blocks, industry_type)
    calls = [x["llm_call"] for x in (aerial, facade, web) if x.get("llm_call")]
    request = {"client_name": client_name, "company_legal_name": company, "building_address": address,
               "industry_type": industry_type}
    return _llm_input(request, fs, blocks, calls, int((time.perf_counter() - t0) * 1000))


def _llm_input(request: dict, fs: dict, blocks: dict, calls: list, duration_ms: int) -> dict:
    images = {}
    for key in ("aerial_image", "facade", "website"):
        for i, ph in enumerate(blocks.get(key, {}).get("photos", [])):
            images[IMAGE_NAMES.get(key, f"website_{i + 1}.jpg")] = ph
    aer = blocks["aerial_image"].get("data") or {}
    fac = blocks["facade"].get("data") or {}
    shows = {"orthophoto.jpg": "; ".join(aer.get("observations") or []) or "aerial view of the building (outlined in red)",
             "facade_streetview.jpg": ("; ".join(fac.get("observations") or []) if fac.get("facade_visible")
                                       else "street view towards the building (facade not clearly visible)")}
    for i, obs in enumerate((blocks["website"].get("data") or {}).get("photo_observations") or []):
        shows[f"website_{i + 1}.jpg"] = obs
    cov = feat.coverage(fs["features"])
    doc = {
        "schema_version": "2.0-llm-input",
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "request": request,
        "identification": fs["identification"],
        "features": fs["features"],                  # 19 x {feature, value, status, requires_verification}
        "feature_evidence": fs["feature_evidence"],  # per feature: source_ids + note
        "feature_coverage_before_llm": cov,
        "sources": fs["sources"],
        "evidence": {
            "public_data": blocks["public_data"]["data"],
            "aerial_image": {"image": "orthophoto.jpg" if "orthophoto.jpg" in images else None,
                             "status": blocks["aerial_image"]["status"], "vision": blocks["aerial_image"].get("data"),
                             "note": blocks["aerial_image"].get("note")},
            "facade": {"image": "facade_streetview.jpg" if "facade_streetview.jpg" in images else None,
                       "status": blocks["facade"]["status"], "camera": blocks["facade"].get("camera"),
                       "vision": blocks["facade"].get("data"), "note": blocks["facade"].get("note")},
            "website": {"status": blocks["website"]["status"], "meta": blocks["website"].get("meta"),
                        "extraction": blocks["website"].get("data"), "raw": blocks["website"].get("raw"),
                        "note": blocks["website"].get("note"), "images": [n for n in images if n.startswith("website_")]},
        },
        # Photos for the REPORT (base64). Never sent to the LLM: see for_llm_text().
        "images": {n: {"label": ph["label"], "credit": ph.get("credit"), "shows": shows.get(n, ph["label"]),
                       "mime": "image/jpeg", "data_url": "data:image/jpeg;base64," + base64.b64encode(ph["jpeg"]).decode()}
                   for n, ph in images.items()},
        "metrics": build_metrics(calls, duration_ms, cov["all"]["total"], cov["all"]["filled"], external_calls={
            # Google Street View Static API: metadata request = free; image = billed (10,000 free per month)
            "google_streetview_metadata": 0 if blocks["facade"].get("note") == "no GOOGLE_MAPS_API_KEY" else 1,
            "google_streetview_images": 1 if blocks["facade"].get("photos") else 0,
        }),
    }
    return strip_binary(doc)


def for_llm_text(llm_input: dict) -> dict:
    """The JSON to send to the final-report LLM: identical, minus the base64 photos.
    Photos are NOT sent to the LLM (already analysed by the vision step). The LLM sees the catalogue
    images[name] = {label, shows, credit} and references photos BY NAME (e.g. "facade_streetview.jpg");
    the report renderer then inserts llm_input["images"][name]["data_url"]."""
    doc = copy.deepcopy(llm_input)
    for img in (doc.get("images") or {}).values():
        img.pop("data_url", None)
    return doc


def save(llm_input: dict, out_dir, with_image_files: bool = True) -> None:
    """Write llm_input.json (+ the photos as .jpg files for convenience)."""
    import json
    from pathlib import Path
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    (out / "llm_input.json").write_text(json.dumps(llm_input, ensure_ascii=False, indent=2), encoding="utf-8")
    if with_image_files:
        for name, img in llm_input.get("images", {}).items():
            (out / name).write_bytes(base64.b64decode(img["data_url"].split(",", 1)[1]))


# ---------------------------------------------------------------- request cache
# Same company + address + industry (+ website, vision on/off) → reuse the stored llm_input.json: no public-data,
# Google or vision call. Shared backend: Upstash Redis when configured (persistent), else file cache
# (.cache/ locally, /tmp on Vercel = per warm instance only). The client name is never stored or used in the key.
# Degraded results (a block in error, e.g. a 429) are not cached, so a retry can still get the full evidence.
REQUEST_CACHE_VERSION = 1  # bump when the pipeline output changes, to invalidate old entries
REQUEST_CACHE_TTL_S = int(__import__("os").environ.get("REQUEST_CACHE_TTL_S", str(7 * 24 * 3600)))


def _norm(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "").strip().lower().replace(",", " "))


def request_cache_key(company: str, address: str, industry_type: str | None, website: str | None, use_llm: bool) -> str:
    from src.cache import make_key
    return make_key("llm_input", {"v": REQUEST_CACHE_VERSION, "company": _norm(company), "address": _norm(address),
                                  "industry": industry_type or None, "website": _norm(website) or None, "vision": use_llm})


def run_cached(client_name: str, company: str, address: str, industry_type: str | None = None, website: str | None = None,
               use_llm: bool = True, refresh: bool = False) -> tuple[dict, bool]:
    """run() behind the request cache. Returns (llm_input, cache_hit). refresh=True forces new API calls."""
    from src.cache import cache
    key = request_cache_key(company, address, industry_type, website, use_llm)
    if not refresh:
        hit = cache.get(key)
        if hit and time.time() - hit.get("cached_at", 0) < REQUEST_CACHE_TTL_S:
            doc = hit["doc"]
            doc["request"]["client_name"] = client_name
            m = doc["metrics"]
            m["request_cache"] = {"hit": True, "cached_at": datetime.fromtimestamp(hit["cached_at"], timezone.utc).isoformat(timespec="seconds"),
                                  "original_cost_usd": m.get("cost_usd"), "original_duration_ms": m.get("duration_ms")}
            m.update(cost_usd=0.0, cost_chf=0.0, cost_source="request_cache")
            return doc, True
    doc = run(client_name, company, address, industry_type, website, use_llm=use_llm)
    if all((b or {}).get("status") != "error" for b in doc.get("evidence", {}).values()):
        stored = copy.deepcopy(doc)
        stored["request"]["client_name"] = None
        cache.set(key, {"cached_at": time.time(), "doc": stored})
    doc["metrics"]["request_cache"] = {"hit": False}
    return doc, False
