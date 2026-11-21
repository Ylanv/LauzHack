"""The 3 evidence blocks.

A. public_data  — official registers + geodata (Zefix, RegBL, AV, hazards, financial signals, reconstruction). 0 token.
B. aerial_image — orthophoto of the building → 1 vision call.
C. website      — simple scraping of the company site (text + photos) → 1 call (text + images).
Each block = {"status", "data", "photos"?, "llm_call"?}. Blocks B/C are skipped (status "skipped") without an LLM key.
"""

import json

from src import config
from src.prompts import FACADE_PROMPT, FACADE_SCHEMA, SYSTEM, VISION_PROMPT, VISION_SCHEMA, WEB_PROMPT, WEB_SCHEMA


def llm_available(role: str) -> bool:
    return bool(config.LLM_API_KEY and config.MODELS.get(role))


# ---------------------------------------------------------------- A
def block_public(probe: dict, profile: dict, reconstruction: dict) -> dict:
    z, rb, fp = probe.get("zefix", {}), probe.get("regbl", {}).get("fields", {}), probe.get("footprint", {})
    hn, hc = probe.get("hazards_national", {}), probe.get("hazards_cantonal", {})
    data = {
        "company": {
            "registered_names": z.get("names"), "uid": z.get("uid"), "legal_form_code": z.get("legal_form_code"),
            "seat": z.get("seat_address"), "purpose": z.get("purpose"), "in_liquidation": z.get("in_liquidation"),
            "register_status": profile.get("register_status"), "registered_since": profile.get("founded_or_registered"),
            "share_capital_chf": profile.get("share_capital_chf"), "statutory_auditor": profile.get("has_statutory_auditor"),
            "bankruptcy_risk": profile.get("bankruptcy_risk"),
            "annual_revenue_chf": None, "annual_revenue_note": profile.get("annual_revenue_note"),
            "company_value_chf": None, "company_value_note": profile.get("company_value_note"),
        },
        "building": {
            "address": probe.get("geocode", {}).get("label"), "egid": rb.get("egid"), "canton": rb.get("gdekt"),
            "commune": rb.get("ggdename"), "category_code": rb.get("gkat"), "class_code": rb.get("gklas"),
            "construction_year": rb.get("gbauj"), "floors": rb.get("gastw"), "footprint_m2": fp.get("area_m2"),
            "floor_area_m2": rb.get("gebf"),
            "footprint_source": fp.get("source"), "volume_m3": rb.get("gvol"),
            "altitude_m": probe.get("height", {}).get("altitude_m"),
            "cantonal_insurance_regime": probe.get("cantonal_insurance_regime"),
            "reconstruction_cost": reconstruction,
        },
        "natural_hazards": {
            "seismic_zone_sia261": hn.get("seismic_zone"), "seismic_soil_class": hn.get("soil_class"),
            "hail_50y_cm": hn.get("hail_50y_cm"), "surface_runoff_perimeter_share": hn.get("runoff_perimeter_share"),
            "surface_runoff_max_depth": hn.get("runoff_max_depth"), "surface_runoff_share_by_depth": hn.get("runoff_share_by_depth"),
            "cantonal_hazard_map": hc.get("processes") if hc.get("status") == "ok" else None,
            "cantonal_hazard_map_note": hc.get("note"),
        },
        "neighbourhood": {"swissprtr_sites_1km": probe.get("swissprtr", {}).get("nearby", [])},
    }
    return {"status": "ok", "data": data}


# ---------------------------------------------------------------- B
def block_aerial(probe: dict, use_llm: bool = True) -> dict:
    img = probe.get("swissimage", {})
    photos = [{"label": "Orthophoto SWISSIMAGE (building outlined in red)", "jpeg": img["jpeg"], "credit": img.get("attribution")}] \
        if img.get("jpeg") else []
    if not photos:
        return {"status": "empty", "data": None, "photos": []}
    if not use_llm or not llm_available("vision"):
        return {"status": "skipped", "note": "LLM not called (input prepared)" if not use_llm else "no LLM key / MODEL_VISION",
                "data": None, "photos": photos, "llm_input": {"prompt": VISION_PROMPT.format(m_per_px=img.get("m_per_px")),
                                                              "schema": "VISION_SCHEMA", "images": ["orthophoto"]}}
    from src.llm import llm_call
    data, call = llm_call("vision", SYSTEM, VISION_PROMPT.format(m_per_px=img.get("m_per_px")), VISION_SCHEMA,
                          "aerial_image", images=[img["jpeg"]], max_tokens=900)
    return {"status": "ok", "data": data, "photos": photos, "llm_call": call}


# ---------------------------------------------------------------- facade (Street View, demo)
def block_facade(probe: dict, company: str, address: str, use_llm: bool = True) -> dict:
    from src.streetview import facade_photo
    sv = facade_photo((probe.get("footprint") or {}).get("geometry"))
    if sv.get("status") != "ok":
        return {"status": sv.get("status"), "note": sv.get("note"), "data": None, "photos": []}
    photos = [{"label": "Street-level facade photo (Google Street View, demo)", "jpeg": sv["jpeg"], "credit": sv["credit"]}]
    if not use_llm or not llm_available("vision"):
        return {"status": "skipped", "note": "LLM not called", "data": None, "photos": photos, "camera": sv.get("camera")}
    from src.llm import llm_call
    data, call = llm_call("vision", SYSTEM, FACADE_PROMPT.format(company=company, address=address), FACADE_SCHEMA,
                          "facade", images=[sv["jpeg"]], max_tokens=700)
    return {"status": "ok", "data": data, "photos": photos, "camera": sv.get("camera"), "llm_call": call}


# ---------------------------------------------------------------- C
def block_website(scraped: dict, company: str, address: str, purpose: str | None, use_llm: bool = True) -> dict:
    if scraped.get("status") != "ok":
        return {"status": "empty", "data": None, "note": scraped.get("note"), "photos": []}
    photos = [{"label": p["alt"] or "Photo from the company website", "jpeg": p["jpeg"], "credit": p["url"]} for p in scraped["photos"]]
    meta = {"site": scraped["site"], "pages": scraped["pages"], "js_rendered_suspect": scraped["js_rendered_suspect"]}
    if not use_llm or not llm_available("extraction"):
        return {"status": "skipped", "note": "LLM not called (input prepared)" if not use_llm else "no LLM key / MODEL_EXTRACTION",
                "data": None, "meta": meta, "photos": photos,
                "raw": {"risk_sentences": scraped["risk_sentences"], "text_excerpt": scraped["text_excerpt"][:3500],
                        "photo_urls": [p["url"] for p in scraped["photos"]]}}
    from src.llm import llm_call
    prompt = WEB_PROMPT.format(company=company, address=address, purpose=purpose or "unknown", site=scraped["site"],
                               n_photos=len(photos), risk_sentences="\n".join(f"- {s}" for s in scraped["risk_sentences"]) or "(none)",
                               text=scraped["text_excerpt"][:3500])
    # Photos need a vision-capable model: use MODEL_VISION if photos are attached.
    role = "vision" if photos and llm_available("vision") else "extraction"
    data, call = llm_call(role, SYSTEM, prompt, WEB_SCHEMA, "website", images=[p["jpeg"] for p in photos] if role == "vision" else None,
                          max_tokens=1400)
    return {"status": "ok", "data": data, "meta": meta, "photos": photos, "llm_call": call}


def compact(blocks: dict) -> str:
    """What the final LLM reads: block data only, no images/bytes, no nulls → fewer tokens."""
    def prune(o):
        if isinstance(o, dict):
            return {k: prune(v) for k, v in o.items() if v not in (None, [], {}, "") and not isinstance(v, bytes)}
        if isinstance(o, list):
            return [prune(v) for v in o]
        return o
    return json.dumps({k: {"status": b["status"], "data": prune(b.get("data"))} for k, b in blocks.items()},
                      ensure_ascii=False, separators=(",", ":"))
