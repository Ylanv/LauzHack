"""System prompt + strict sub-schemas for the 3 LLM calls (vision, website, final report)."""

SYSTEM = """You are AXA Smart Property, a Swiss commercial-building risk pre-underwriting assistant.
Return exactly one JSON object conforming to the provided JSON Schema. JSON only, no Markdown.
RULES:
1. Never invent a value, equipment, repair need, figure or URL. Unknown stays null / "unknown".
2. Absence of evidence is "unknown", never "confirmed_absent".
3. Distinguish what concerns THIS building from general company information.
4. Report possible damage as something to inspect, never as confirmed damage.
5. No insurance premium, no actuarial score, no invented probability.
6. Be concise: each text field is one short sentence."""

PRESENCE = {"type": "string", "enum": ["confirmed_present", "confirmed_absent", "possible", "unknown"]}
STR_LIST = {"type": "array", "items": {"type": "string"}}
NSTR = {"type": ["string", "null"]}


def _obj(props: dict) -> dict:
    """Strict object: every property required, no extra keys (structured-output friendly)."""
    return {"type": "object", "additionalProperties": False, "required": list(props), "properties": props}


# ---------------------------------------------------------------- block B: aerial image (vision)
VISION_SCHEMA = _obj({
    "image_quality": {"type": "string", "enum": ["good", "limited", "unusable"]},
    "roof_type": NSTR,
    "roof_material": NSTR,
    "construction_material_hint": NSTR,
    "pv_panels": PRESENCE,
    "skylights": PRESENCE,
    "roof_equipment": STR_LIST,
    "outdoor_storage": PRESENCE,
    "outdoor_storage_detail": NSTR,
    "vegetation_close_to_walls": PRESENCE,
    "neighbouring_buildings_close": PRESENCE,
    "possible_roof_issues": STR_LIST,
    "observations": STR_LIST,
})
VISION_PROMPT = """Aerial orthophoto (SWISSIMAGE, ~{m_per_px} m/pixel, north up). The building to analyse is outlined in RED.
Describe only what is visible on THIS building and its immediate surroundings: roof type and visible roof material
(tiles, metal sheet, gravel/flat membrane, green roof…), a construction-material hint only if clearly visible, solar panels, skylights,
roof equipment, outdoor storage (pallets, containers, tanks, wood piles), vegetation touching the walls, neighbours closer
than ~10 m, and anything on the roof that deserves an inspection. Max 5 observations, max 12 words each."""

# ---------------------------------------------------------------- block C: company website
WEB_SCHEMA = _obj({
    "activity_summary": NSTR,
    "construction_material": NSTR,
    "processes": STR_LIST,
    "gas_installations": PRESENCE,
    "high_temperature_processes": PRESENCE,
    "flammable_materials": PRESENCE,
    "flammable_materials_detail": NSTR,
    "protections_mentioned": STR_LIST,
    "floors_visible_on_photos": {"type": ["integer", "null"]},
    "photo_observations": STR_LIST,
    "evidence": {"type": "array", "items": _obj({"claim": {"type": "string"}, "quote_or_photo": {"type": "string"},
                                                  "building_specific": {"type": "boolean"}})},
})
WEB_PROMPT = """Company: {company} — building: {address}. Registered purpose: {purpose}
Below: short text excerpts from the company website ({site}) and up to {n_photos} photos from it.
Extract only what matters for fire and property risk: activity, construction material of the company's OWN building
(only if stated or clearly shown), processes (welding, painting, ovens, woodworking,
printing, chemicals…), gas, high temperature, flammable materials, protections (sprinklers, detection), and what the
photos show (workshop, storage, facade, number of floors). Quote the text or name the photo for every claim.
A photo or text describing the company in general is building_specific=false unless it clearly shows this site.
WARNING: company websites mostly show PRODUCTS or CUSTOMER PROJECTS (kitchens, interiors, cars, prints), not the company's own
building. Only fill floors_visible_on_photos if a photo clearly shows the exterior of the company's own building; otherwise null.
Be brief: max 6 evidence items, quotes of max 15 words, max 5 processes and 5 photo observations.

RISK SENTENCES:
{risk_sentences}

TEXT EXCERPT:
{text}"""

# ---------------------------------------------------------------- final report
FINDING = _obj({
    "topic": {"type": "string"},
    "fact": {"type": "string"},
    "effect": {"type": "string"},
    "direction": {"type": "string", "enum": ["increases_risk", "decreases_risk", "neutral", "unknown"]},
    "confidence": {"type": "string", "enum": ["verified", "observed", "inferred"]},
})
REPORT_SCHEMA = _obj({
    "executive_summary": {"type": "string"},
    "attention_level": {"type": "string", "enum": ["low", "moderate", "high", "very_high"]},
    "blocks": {"type": "array", "items": _obj({
        "block": {"type": "string", "enum": ["public_data", "aerial_image", "website"]},
        "summary": {"type": "string"},
        "findings": {"type": "array", "items": FINDING},
    })},
    "key_risks": STR_LIST,
    "missing_information": STR_LIST,
    "recommendations": STR_LIST,
})
REPORT_PROMPT = """Write the pre-underwriting report for an AXA property underwriter (Geneva, B2B) from the evidence below.
The FEATURES list is the target schema (25 risk features, each with value, status and pricing relevance 1-5); unknown
features must appear in missing_information when relevance >= 4.
LEGAL: natural-hazard exposure (flood, runoff, hail, landslide) must NOT be presented as a premium surcharge for the
regulated natural-hazards cover — present it as underwriting / prevention / special-cover information.
Go through the blocks ONE BY ONE in this order: public_data (official registers and geodata, verified),
aerial_image (vision on the orthophoto, observed), website (company website text and photos, inferred unless building-specific).
For each relevant fact: state the fact, then EXPLAIN ITS EFFECT on the property risk (fire, natural hazards, maintenance,
financial solidity of the client, reconstruction value) and give the direction. Skip blocks that were not run.
Then: key risks, missing information the underwriter must ask the client, and concrete recommendations.
Keep it compact: max 6 findings per block, max 5 items per list, one sentence per field.

FEATURES (JSON):
{features}

EVIDENCE BLOCKS (JSON):
{blocks}"""
