"""End-to-end pipeline: 3 inputs → 3 evidence blocks → 25 features → final LLM report → HTML with photos.

Inputs (the client provides only these): client_name, company_legal_name (exact, Zefix), building address.
Optional technical hint: website (improves block 3; not part of the client form).
Everything else is researched automatically or marked unknown.
"""

import re
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from src import building_condition as bc
from src import geneva
from src import features as feat
from src import reconstruction
from src.blocks import block_aerial, block_public, block_website
from src.company_profile import company_profile
from src.llm import build_metrics
from src.public_data import probe, strip_binary
from src.report_writer import render_html, write
from src.web_scrape import scrape


def _safe(future, photos_from=None):
    """An LLM block that fails (timeout, invalid JSON twice…) degrades to status=error; the report still runs."""
    try:
        return future.result()
    except Exception as e:  # noqa: BLE001
        ok = photos_from and photos_from.get("jpeg")
        photos = [{"label": "Orthophoto SWISSIMAGE", "jpeg": photos_from["jpeg"], "credit": "© swisstopo"}] if ok else []
        return {"status": "error", "note": f"{type(e).__name__}: {str(e)[:160]}", "data": None, "photos": photos}


class ServiceError(Exception):
    """An external public service failed (timeout, outage) → retry later; not the client's fault."""


class InputError(Exception):
    """Company or address not found / ambiguous / out of scope → shown to the user, no report."""


# Scope: SMEs with their OWN activity building (workshop, factory, warehouse). Housing and mixed-use buildings
# (shops on the ground floor of an apartment block) are out of scope: shared risks, several insureds, other product.
RESIDENTIAL_GKAT = {1020: "residential building", 1030: "residential building with secondary use",
                    1040: "partly residential building (mixed use)"}


# Geneva cadastre destination -> RegBL building class (used for usage label and m3 reconstruction prices).
# Needed because RegBL classes are sometimes wrong in GE (a 3,500 m2 workshop registered as a single-family house).
GE_DESTINATION_TO_GKLAS = {"Atelier": 1251, "Usine": 1251, "Hangar": 1251, "Autre bât. d'activités": 1274,
                           "Dépôt": 1252, "Entrepôt": 1252, "Garage": 1242, "Bureaux": 1220, "Commerce": 1230}


def check_scope(regbl: dict, footprint: dict) -> None:
    """Outside Geneva only (in GE the SITG cadastre is authoritative and checked later).
    Reject only when BOTH the category and the class say housing, to tolerate RegBL inconsistencies."""
    if regbl.get("gdekt") == "GE":
        return
    gkat, gklas = regbl.get("gkat"), regbl.get("gklas") or 0
    if gkat in RESIDENTIAL_GKAT and 1100 <= gklas < 1200:
        raise InputError(f"Out of scope: the building (EGID {regbl.get('egid')}) is a {RESIDENTIAL_GKAT[gkat]}. "
                         "AXA Smart Property covers companies with their own activity building (workshop, factory, warehouse).")


def run(client_name: str, company: str, address: str, industry_type: str | None = None, website: str | None = None,
        use_llm: bool = True, final_report: bool = True) -> dict:
    """use_llm=False: no LLM at all (0 token). final_report=False: vision (Gemini) runs on the orthophoto and website
    photos, then the pipeline stops and returns the JSON for the final-report LLM."""
    t0 = time.perf_counter()
    m = re.search(r"\b(\d{4})\s+(.+)$", address.split(",")[-1].strip())
    zip_code, town = (m.group(1), m.group(2)) if m else (None, None)

    # 1) Public data first (identity checks + EGID + footprint), register profile in parallel.
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

    regbl = pdata.get("regbl", {}).get("fields", {})
    footprint = pdata.get("footprint", {})
    canton = regbl.get("gdekt")
    if canton != "GE":
        raise InputError(f"Out of scope: AXA Smart Property currently covers buildings in the canton of Geneva only (found: {canton}).")
    check_scope(regbl, footprint)

    # 2) Geneva open data (SITG): establishment register gives the website → feeds the scraper.
    ge = {}
    if canton == "GE":
        try:
            ge["establishment"] = geneva.establishment((pdata.get("zefix") or {}).get("uid"))
            ge.update(geneva.building(regbl.get("egid"), footprint.get("geometry")))
        except Exception as e:  # noqa: BLE001
            ge = {"status": "error", "error": str(e)[:200]}
        cls = (ge.get("building") or {}).get("nomen_classe") or ""
        if cls.startswith("Mixte") or cls.startswith("Logement"):
            raise InputError(f"Out of scope: the Geneva cadastre classifies this building as '{cls}'. "
                             "AXA Smart Property covers companies with their own activity building.")
    site_hint = website or (ge.get("establishment") or {}).get("website")
    try:
        scraped = scrape(company, zip_code, town, site_hint)
    except Exception as e:  # noqa: BLE001
        scraped = {"status": "error", "note": str(e)[:200]}

    # 3) Blocks 2 (vision) and 3 (website) in parallel.
    purpose = (pdata.get("zefix") or {}).get("purpose")
    with ThreadPoolExecutor(2) as ex:
        f_b = ex.submit(block_aerial, pdata, use_llm)
        f_c = ex.submit(block_website, scraped, company, address, purpose, use_llm)
        aerial, web = _safe(f_b, photos_from=pdata.get("swissimage")), _safe(f_c)

    # 4) Block 1 completed with SITG + what image / website observed.
    gb = ge.get("building") or {}
    regbl_plus = dict(regbl)
    if gb.get("destination") in GE_DESTINATION_TO_GKLAS:
        regbl_plus["gklas"] = GE_DESTINATION_TO_GKLAS[gb["destination"]]
    regbl_plus["gastw"] = regbl.get("gastw") or gb.get("niveaux_horsol")
    # Floor area sanity: the energy index / RegBL area sometimes covers a whole group of buildings
    # (11,315 m2 declared for a 705 m2-footprint, 2-level building) -> keep it only if <= footprint x levels x 1.3.
    fp_m2, lv = footprint.get("area_m2"), regbl.get("gastw") or gb.get("niveaux_horsol")
    max_area = fp_m2 * (lv or 3) * 1.3 if fp_m2 else None
    area = regbl.get("gebf") or (ge.get("energy") or {}).get("heated_area_m2")
    regbl_plus["gebf"] = area if (area and (not max_area or area <= max_area)) else None
    if area and not regbl_plus["gebf"] and ge.get("energy"):
        ge["energy"]["heated_area_m2_rejected"] = area
        ge["energy"]["heated_area_m2"] = None
    regbl_plus["gbauj"] = regbl.get("gbauj") or gb.get("annee_construction")
    observed_floors = (web.get("data") or {}).get("floors_visible_on_photos")
    if not regbl.get("gvol") and gb.get("surface") and gb.get("hauteur"):
        # Geneva cadastre: measured footprint x height = building volume (closer to SIA 416 than floors x storey height).
        # Plausibility: the cadastre height can include chimneys / technical parts (a 1-level workshop at 29 m).
        h, lv = gb["hauteur"], gb.get("niveaux_horsol")
        plausible = (h <= lv * 7) if lv else (h <= 15)
        if plausible:
            regbl_plus["gvol"] = round(gb["surface"] * h)
        else:
            regbl_plus["gastw"] = regbl_plus.get("gastw") or lv or 1  # fall back on levels x typical storey height
            observed_floors = None
            volume_note = f"cadastre height {h} m rejected as implausible for {lv or 'unknown'} level(s)"
    if not regbl_plus["gastw"] and gb.get("hauteur"):  # SITG height → floors estimate (4 m per floor for workshops)
        observed_floors = observed_floors or max(1, round(gb["hauteur"] / 4))
    pv = (aerial.get("data") or {}).get("pv_panels")
    rc = reconstruction.estimate(regbl_plus, footprint.get("area_m2"), observed_floors)
    if "volume_note" in locals() and rc.get("method"):
        rc["method"] += f" ({volume_note})"
    public = block_public(pdata, profile, rc)
    if ge:
        public["data"]["geneva"] = ge
    b = public["data"]["building"]
    reno_year = gb.get("annee_transformation") or next((int(x["date"][:4]) for x in ge.get("renovation_permits", []) if x.get("date")), None)
    b["condition"] = bc.condition(regbl_plus, None, reno_year, pv)
    b["heating"] = bc.heating(regbl)

    blocks = {"public_data": public, "aerial_image": aerial, "website": web}
    fs = feat.build(blocks, industry_type)
    if not use_llm or not final_report:
        calls = [x["llm_call"] for x in (aerial, web) if x.get("llm_call")]
        return llm_input(client_name, company, address, fs, blocks, int((time.perf_counter() - t0) * 1000), calls, industry_type)
    report, synth_call = write(blocks, fs["features"])

    calls = [x["llm_call"] for x in (aerial, web) if x.get("llm_call")] + ([synth_call] if synth_call else [])
    cov = feat.coverage(fs["features"])
    metrics = build_metrics(calls, int((time.perf_counter() - t0) * 1000), cov["all"]["total"], cov["all"]["filled"])
    result = {
        "schema_version": "2.0",
        "report_id": str(uuid.uuid4()),
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "request": {"client_name": client_name, "company_legal_name": company, "building_address": address,
                    "industry_type": industry_type},
        "identification": fs["identification"],
        "features": fs["features"],
        "feature_evidence": fs["feature_evidence"],
        "feature_coverage": cov,
        "sources": fs["sources"],
        "report": report,
        "metrics": metrics,
    }
    result["html"] = render_html(result, blocks)
    result["blocks"] = strip_binary(blocks)
    return result


def llm_input(client_name, company, address, fs, blocks, duration_ms, calls=(), industry_type=None) -> dict:
    """The hand-off JSON: everything collected without any LLM, ready to send to the LLM step.
    Images are returned separately (bytes) so the JSON stays small; the JSON references them by name."""
    images = {}
    for key in ("aerial_image", "website"):
        for i, ph in enumerate(blocks.get(key, {}).get("photos", [])):
            name = "orthophoto.jpg" if key == "aerial_image" else f"website_{i + 1}.jpg"
            images[name] = {"jpeg": ph["jpeg"], "label": ph["label"], "credit": ph.get("credit")}
    cov = feat.coverage(fs["features"])
    payload = {
        "schema_version": "2.0-llm-input",
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "request": {"client_name": client_name, "company_legal_name": company, "building_address": address,
                    "industry_type": industry_type},
        "identification": fs["identification"],
        "features": fs["features"],                  # 19 x {feature, value, status, requires_verification}
        "feature_evidence": fs["feature_evidence"],  # per feature: source_ids + note
        "feature_coverage_before_llm": cov,
        "sources": fs["sources"],
        "evidence": {
            "public_data": blocks["public_data"]["data"],                       # registers + geodata (+ SITG in GE)
            "aerial_image": {"image": "orthophoto.jpg" if "orthophoto.jpg" in images else None,
                             "status": blocks["aerial_image"]["status"],
                             "vision": blocks["aerial_image"].get("data"),          # Gemini output (VISION_SCHEMA)
                             "note": blocks["aerial_image"].get("note")},
            "website": {"status": blocks["website"]["status"], "meta": blocks["website"].get("meta"),
                        "extraction": blocks["website"].get("data"),            # Gemini output on text + photos (WEB_SCHEMA)
                        "raw": blocks["website"].get("raw"), "note": blocks["website"].get("note"),
                        "images": [n for n in images if n.startswith("website_")]},
        },
        "images": {n: {"label": v["label"], "credit": v["credit"]} for n, v in images.items()},
        "metrics": build_metrics(list(calls), duration_ms, cov["all"]["total"], cov["all"]["filled"]),
    }
    return {"llm_input": strip_binary(payload), "images": {n: v["jpeg"] for n, v in images.items()}}
