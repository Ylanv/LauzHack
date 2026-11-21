"""The 19 risk features (Geneva target schema) + identification/financial fields, filled from the 3 evidence blocks.

Every feature uses the same record:
  {"feature", "value", "status", "pricing_relevance", "insurance_components", "priority", "group",
   "source_ids", "requires_verification", "note"}
status: verified (official register/geodata) · observed (vision on the orthophoto) · inferred (website / indirect)
        · estimated (calculation) · unknown (not found — never guessed).

Relevance scores are the team's proposed priorities, not AXA's official pricing weights.
LEGAL: for the regulated natural-hazards cover, geographic exposure may NOT be used as an individual premium
surcharge → natural-hazard features are for underwriting, prevention and special covers only.
"""

import re

# key: (group, relevance, components, priority)
CATALOG = {
    # Building characteristics
    "reconstruction_value_chf":    ("building", 5, ["fire", "natural_hazards", "property"], "P2"),
    "building_usage":              ("building", 5, ["fire"], "P0"),
    "construction_material":       ("building", 5, ["fire", "earthquake"], "P1"),
    "construction_year":           ("building", 4, ["fire", "water"], "P0"),
    "floor_area_m2":               ("building", 4, ["property"], "P0"),
    "number_of_floors":            ("building", 3, ["fire", "earthquake"], "P0"),
    "roof_type_material":          ("building", 4, ["fire", "water", "special_covers"], "P1"),
    "building_renovations":        ("building", 3, ["fire", "water"], "P1"),
    # Industrial and fire risks
    "business_sector":             ("fire", 5, ["fire"], "P0"),
    "site_industrial_processes":   ("fire", 5, ["fire"], "P1"),
    "high_temperature_operations": ("fire", 5, ["fire"], "P1"),
    "gas_installations":           ("fire", 5, ["fire"], "P1"),
    "flammable_material_storage":  ("fire", 5, ["fire"], "P1"),
    # Protection systems (sprinklers, detection, compartmentation, flood protection) REMOVED: not findable in public
    # data (whole canton of Geneva: 20 building permits mention sprinklers) -> asked to the client outside the pipeline.
    # External hazards (* not usable as an individual premium surcharge for the regulated cover)
    "earthquake_exposure":         ("hazards", 5, ["earthquake"], "P0"),
    "flood_exposure":              ("hazards", 5, ["natural_hazards", "special_covers"], "P0"),
    "surface_runoff_exposure":     ("hazards", 4, ["natural_hazards", "special_covers"], "P0"),
    "hail_exposure":               ("hazards", 4, ["natural_hazards"], "P0"),
    "landslide_exposure":          ("hazards", 3, ["natural_hazards"], "P0"),
    # Maintenance and history
    "potential_repair_needs":      ("maintenance", 3, ["fire", "water", "underwriting"], "P1"),
    # previous_claims (AXA / client) and water_pipe_condition (inspection) REMOVED: not public.
}
REGULATED_HAZARDS = {"flood_exposure", "surface_runoff_exposure", "hail_exposure", "landslide_exposure"}

# RegBL building class (GKLAS) → usage label
USAGE = {1110: "single-family house", 1121: "two-family house", 1122: "apartment building", 1130: "residential community",
         1211: "hotel", 1212: "short-stay accommodation", 1220: "office building", 1230: "retail / wholesale",
         1231: "restaurant / bar", 1241: "transport / communications", 1242: "garage building", 1251: "industrial building",
         1252: "tank / silo / warehouse", 1261: "culture / leisure", 1262: "museum / library", 1263: "school",
         1264: "hospital / clinic", 1265: "sports hall", 1271: "agricultural building", 1272: "religious building",
         1274: "other non-residential"}

PRESENT = {"confirmed_present", "possible"}
# Cantonal hazard map levels (official German codes) -> English
LEVEL_EN = {"nicht_gefaehrdet": "none", "restgefaehrdung": "residual", "gering": "low", "mittel": "medium", "erheblich": "high"}


class Sources:
    """Central source registry: one entry per source, features point to it by id (no repeated URLs)."""

    def __init__(self):
        self.items, self._by_key = [], {}

    def add(self, key, provider, kind, url=None, reliability="verified"):
        if key not in self._by_key:
            sid = f"src_{len(self.items) + 1}"
            self._by_key[key] = sid
            self.items.append({"id": sid, "provider": provider, "kind": kind, "url": url, "reliability": reliability})
        return self._by_key[key]


def _rec(key, value, status, src=(), note=None, verify=None):
    group, rel, comps, prio = CATALOG[key]
    if isinstance(value, list):
        value = list(dict.fromkeys(value))
    if value in (None, "", [], "unknown"):
        value, status = None, "unknown"
    value = {"confirmed_present": "present", "possible": "possible", "confirmed_absent": "absent"}.get(value, value)         if isinstance(value, str) else value
    if key in REGULATED_HAZARDS:
        note = ((note + " · ") if note else "") + "not usable as an individual premium surcharge (regulated natural-hazards cover)"
    return {"feature": key, "value": value, "status": status, "pricing_relevance": rel, "insurance_components": comps,
            "priority": prio, "group": group, "source_ids": [s for s in src if s] if status != "unknown" else [],
            "requires_verification": verify if verify is not None else status != "verified", "note": note}


def build(blocks: dict, industry_type: str | None = None) -> dict:
    """blocks (+ industry declared by the client) → {"identification", "features", "feature_evidence", "sources"}"""
    from src.industries import typical
    ind = typical(industry_type) or {}
    S = Sources()
    pub = blocks["public_data"]["data"]
    c, b, h = pub["company"], pub["building"], pub["natural_hazards"]
    vis = blocks.get("aerial_image", {}).get("data") or {}
    fac = blocks.get("facade", {}).get("data") or {}
    fac = fac if fac.get("facade_visible") else {}
    fac_warning = None
    web = blocks.get("website", {}).get("data") or {}
    site = (blocks.get("website", {}).get("meta") or {}).get("site")

    zefix = S.add("zefix", "Zefix commercial register (Linked Data + zefix.ch)", "official_registry", "https://www.zefix.ch")
    regbl = S.add("regbl", "Federal Register of Buildings (RegBL)", "official_registry", "https://www.housing-stat.ch")
    av = S.add("av", "Official cadastral survey (geodienste.ch)", "official_geodata", "https://geodienste.ch/services/av")
    nat = S.add("nat", "geo.admin.ch (FOEN / MeteoSwiss / SIA 261)", "official_geodata", "https://wms.geo.admin.ch")
    cant = S.add("cant", "Cantonal hazard maps (geodienste.ch)", "official_geodata", "https://geodienste.ch/services/gefahrenkarten")
    img = S.add("img", "SWISSIMAGE © swisstopo + vision model", "aerial_image", None, "observed") if vis else None
    sv = S.add("sv", "Google Street View (demo) + vision model", "street_image", None, "observed") if fac else None
    webs = S.add("web", "Company website", "company_website", site, "inferred") if web else None
    calc = S.add("calc", "Indicative cost model (volume × CHF/m³)", "derived_calculation", None, "estimated")
    ge = pub.get("geneva") or {}
    gb, est, boilers = ge.get("building") or {}, ge.get("establishment") or {}, ge.get("boilers") or []
    sitg = S.add("sitg", "SITG Geneva (cadastre, energy, boilers, building permits, establishments)", "official_registry",
                 "https://sitg.ge.ch") if ge else None
    client = S.add("client", "Declared by the client (industry type)", "client_input", None, "declared") if ind else None
    polluted = ge.get("polluted_sites") or []
    gas_permits, storage_permits = ge.get("gas_permits") or [], ge.get("storage_permits") or []

    cond, heat, rc = b.get("condition") or {}, b.get("heating") or {}, b.get("reconstruction_cost") or {}
    cons = cond.get("construction") or {}
    proc = {p: v for p, v in (h.get("cantonal_hazard_map") or {}).items()}
    cant_note = h.get("cantonal_hazard_map_note")

    def presence(*cands):
        """First non-unknown presence among (value, status, source) candidates."""
        for v, st, src in cands:
            if v and v != "unknown":
                return v, st, src
        return None, "unknown", None

    f = []
    # ---- building
    f.append(_rec("reconstruction_value_chf",
                  {k: rc.get(k) for k in ("best_estimate_chf", "low_chf", "high_chf")} if rc.get("best_estimate_chf") else None,
                  "estimated", [calc, regbl, av], rc.get("method"), verify=True))
    usage = USAGE.get(b.get("class_code"))
    if gb.get("destination"):
        usage = f"{gb['destination']} ({gb.get('nomen_classe')})"
    activity = web.get("activity_summary")
    f.append(_rec("building_usage", " — ".join(x for x in (usage, activity) if x) or None,
                  "verified" if usage else "inferred", [sitg if gb.get("destination") else regbl, webs if activity else None],
                  "mixed-use building: the company occupies only part of it" if gb.get("mixed_use") else None))
    # Wrong-building guard: the camera aims at the footprint centroid but a neighbour may fill the frame.
    known_floors = b.get("floors") or gb.get("niveaux_horsol")
    # A matching company sign proves it is the right building; otherwise reject only large floor mismatches
    # (industrial halls: the cadastre may count 3 levels where the street sees one tall storey).
    if (fac and fac.get("signage_matches_company") != "yes" and fac.get("floors_visible") and known_floors
            and abs(fac["floors_visible"] - known_floors) >= 3):
        fac_warning = (f"street photo shows {fac['floors_visible']} floors vs {known_floors} in the cadastre: "
                       "probably a neighbouring building, facade ignored")
        fac = {}
    fac_mat = fac.get("construction_material") if fac.get("construction_material") not in (None, "unknown") else None
    if fac_mat:
        detail = fac.get("construction_material_detail")
        f.append(_rec("construction_material", fac_mat.replace("_", " ") + (f" ({detail})" if detail else ""), "observed", [sv],
                      "seen on the street-level facade photo"))
    else:
        mat = web.get("construction_material") or vis.get("construction_material_hint")
        f.append(_rec("construction_material", mat, "inferred" if web.get("construction_material") else "observed",
                      [webs if web.get("construction_material") else img], fac_warning))
    year = cons.get("from") if cons.get("from") == cons.get("to") else (f"{cons.get('from') or '…'}–{cons.get('to') or '…'}" if cons.get("basis") else None)
    if not year and (gb.get("annee_construction") or gb.get("epoque_construction")):
        year, cons = gb.get("annee_construction") or gb.get("epoque_construction"), {"basis": "SITG cadastre"}
    f.append(_rec("construction_year", year, "verified", [sitg if cons.get("basis") == "SITG cadastre" else regbl], cons.get("basis")))
    heated = (ge.get("energy") or {}).get("heated_area_m2")
    fp_m2, lv = b.get("footprint_m2"), b.get("floors") or gb.get("niveaux_horsol")
    if b.get("floor_area_m2") and fp_m2 and b["floor_area_m2"] > fp_m2 * (lv or 3) * 1.3:
        b = dict(b, floor_area_m2=None)  # RegBL area covering several buildings -> not this building
    if b.get("floor_area_m2"):
        f.append(_rec("floor_area_m2", b["floor_area_m2"], "verified", [regbl], "RegBL energy reference area"))
    elif heated:
        f.append(_rec("floor_area_m2", heated, "verified", [sitg], "heated floor area (SRE) from the Geneva energy index"))
    elif b.get("footprint_m2") and b.get("floors"):
        f.append(_rec("floor_area_m2", round(b["footprint_m2"] * b["floors"]), "estimated", [av, regbl],
                      f"footprint {b['footprint_m2']} m² × {b['floors']} floors"))
    else:
        f.append(_rec("floor_area_m2", None, "unknown", note=f"footprint only: {b.get('footprint_m2')} m²" if b.get("footprint_m2") else None))
    floors_note = f"{gb['niveaux_ssol']} basement level(s) — water-damage relevant" if gb.get("niveaux_ssol") else None
    if b.get("floors") or gb.get("niveaux_horsol"):
        f.append(_rec("number_of_floors", b.get("floors") or gb.get("niveaux_horsol"), "verified",
                      [regbl if b.get("floors") else sitg], floors_note))
    elif gb.get("hauteur"):
        f.append(_rec("number_of_floors", max(1, round(gb["hauteur"] / 4)), "estimated", [sitg],
                      f"height {gb['hauteur']} m / ~4 m per level" + (f" · {floors_note}" if floors_note else "")))
    else:
        f.append(_rec("number_of_floors", None, "unknown"))
    groof = ge.get("roof") or {}
    if groof:
        roof = " / ".join(x for x in (f"{groof['type']} ({groof['slope_mean_deg']:.0f} deg)", vis.get("roof_material")) if x)
        f.append(_rec("roof_type_material", roof, "verified", [sitg, img if vis.get("roof_material") else None],
                      "type from 3D cadastre slope" + ("; material seen on the orthophoto" if vis.get("roof_material") else "")))
    else:
        roof = " / ".join(x for x in (vis.get("roof_type"), vis.get("roof_material")) if x)
        f.append(_rec("roof_type_material", roof or None, "observed", [img]))
    reno = list(cond.get("renovation_signals") or [])
    if gb.get("annee_transformation"):
        reno.insert(0, f"transformation recorded in {gb['annee_transformation']} (cadastre)")
    reno += [f"permit {(x.get('date') or '?')[:4]}: {x['description'][:90]}" for x in ge.get("renovation_permits", [])[:4]]
    verified_reno = bool(gb.get("annee_transformation") or ge.get("renovation_permits"))
    if not reno and ge.get("permits") is not None:
        # Geneva permit register searched, nothing found: say so (an informative answer, not "unknown").
        reno = ["no renovation recorded in the cadastre or in building permits"]
    f.append(_rec("building_renovations", "; ".join(reno) or None, "verified" if verified_reno else "inferred",
                  [sitg if (verified_reno or ge.get("permits") is not None) else None, regbl, img],
                  f"estimated condition: {cond.get('state')}" if cond.get("state") else None))

    # ---- industrial / fire
    if est.get("branch"):
        f.append(_rec("business_sector", f"{est['branch']} (NOGA {est.get('noga_code')})", "verified", [sitg, client],
                      "; ".join(x for x in (f"size: {est.get('size_class')}" if est.get("size_class") else None,
                                            f"declared: {ind['label']}" if ind else None) if x) or None))
    elif ind:
        f.append(_rec("business_sector", ind["label"], "declared", [client], "declared by the client"))
    else:
        sector = activity or c.get("purpose")
        f.append(_rec("business_sector", sector, "inferred" if activity else "verified", [webs if activity else zefix],
                      "registered purpose (Zefix)" if not activity else None))
    hz = est.get("sector_hazard") or {}
    processes = [f"permit {(x.get('date') or '?')[:4]}: {x['description'][:90]}" for x in ge.get("activity_permits", [])[:3]]
    processes += list(web.get("processes") or [])
    processes += [f"historical activity on the site (polluted-sites cadastre): {p['activity']}" for p in polluted[:2] if p.get("activity")]
    if not processes and ind.get("processes"):
        processes.append(f"typical for the declared industry: {ind['processes']}")
    if hz and not processes:
        processes.append(f"typical for the sector: {hz['process']}")
    if vis.get("outdoor_storage") in PRESENT and vis.get("outdoor_storage_detail"):
        processes.append(f"outdoor storage: {vis['outdoor_storage_detail']}")
    f.append(_rec("site_industrial_processes", processes or None, "verified" if ge.get("activity_permits") else "inferred",
                  [sitg if ge.get("activity_permits") or hz else None, webs, img if vis.get("outdoor_storage") in PRESENT else None]))
    hz_ht = f"possible: typical for the sector ({hz['process']})" if hz.get("high_temperature") else None
    ind_ht = f"possible: typical for the declared industry ({ind['processes']})" if ind.get("high_temperature") else None
    ht_permit = next((f"permit {(x.get('date') or '?')[:4]}: {x['description'][:90]}" for x in gas_permits
                      if re.search(r"four|fours|forge|cuisson|séchage|chaudière industrielle", x["description"], re.I)), None)
    v, st, src = presence((ht_permit, "verified", sitg), (web.get("high_temperature_processes"), "inferred", webs),
                          (ind_ht, "inferred", client), (hz_ht, "inferred", sitg))
    f.append(_rec("high_temperature_operations", v, st, [src]))
    active = [x for x in boilers if x.get("active")]
    gas_ge = [x for x in active if (x.get("fuel") or "").lower().startswith("gaz")]
    gas_regbl = "confirmed_present" if heat.get("energy_source") == "gas" else None
    ge_val = None
    if gas_ge:
        g0 = gas_ge[0]
        ge_val = (f"active gas boiler(s): {len(gas_ge)}" + (f", {g0['power_kw']} kW" if g0.get("power_kw") else "")
                  + (f", installed {g0['year']}" if g0.get("year") else ""))
    gp = next((x for x in gas_permits if re.search(r"gaz", x["description"], re.I)), None)
    gp_val = f"permit {(gp.get('date') or '?')[:4]}: {gp['description'][:90]}" if gp else None
    ind_gas = f"possible: typical for the declared industry ({ind['gas']})" if ind.get("gas") else None
    v, st, src = presence((ge_val, "verified", sitg), (gp_val, "verified", sitg), (gas_regbl, "verified", regbl),
                          (web.get("gas_installations"), "inferred", webs), (ind_gas, "inferred", client))
    note = f"heating: {heat.get('energy_source')} ({heat.get('generator')})" if heat.get("energy_source") else None
    if boilers and not gas_ge and any((x.get("fuel") or "").lower().startswith("gaz") for x in boilers):
        note = "gas boiler(s) registered but out of service"
    f.append(_rec("gas_installations", v, st, [src], note))
    fl = web.get("flammable_materials_detail") if web.get("flammable_materials") in PRESENT else None
    if vis.get("outdoor_storage") in PRESENT:
        fl = "; ".join(x for x in (fl, f"outdoor: {vis.get('outdoor_storage_detail') or 'storage visible'}") if x)
    if fac.get("outdoor_storage") in PRESENT:
        fl = "; ".join(x for x in (fl, f"along the facade: {fac.get('outdoor_storage_detail') or 'storage visible'}") if x)
    if heat.get("energy_source") in ("heating oil", "wood", "wood (logs)", "wood (chips)", "wood (pellets)"):
        fl = "; ".join(x for x in (fl, f"{heat['energy_source']} fuel for heating (RegBL)") if x)
    oil = [x for x in active if (x.get("fuel") or "").upper() in ("HEL", "MAZOUT") or "mazout" in (x.get("fuel") or "").lower()]
    if oil:
        kw = f", {oil[0]['power_kw']} kW" if oil[0].get("power_kw") else ""
        fl = "; ".join(x for x in (f"heating-oil tank (active oil boiler{kw})", fl) if x)
    strong = re.compile(r"citerne|réservoir|reservoir|hydrocarbure|mazout|solvant|produits chimiques|gaz liquéfié|propane", re.I)
    sp_strong = [x for x in storage_permits if strong.search(x["description"])]
    sp = [f"permit {(x.get('date') or '?')[:4]}: {x['description'][:90]}" for x in (sp_strong or storage_permits)[:2]]
    pol = [f"polluted site: {p.get('pollutants') or p.get('activity')}" for p in polluted[:1] if p.get("pollutants") or p.get("activity")]
    if sp or pol:
        fl = "; ".join(dict.fromkeys(x for x in (*sp, *pol, fl) if x))
    # "verified" only for a fuel/chemical evidence (oil boiler, tank permit); generic "storage area" stays inferred
    verified_fl = bool(oil or sp_strong)
    if not fl and ind.get("flammables"):
        fl = f"typical for the declared industry: {ind['flammables']}"
    f.append(_rec("flammable_material_storage", fl, "verified" if verified_fl else ("inferred" if fl else "unknown"),
                  [sitg if verified_fl else None, webs, img, client if ind else None, regbl if heat.get("fire_relevant") else None]))

    # ---- external hazards
    eq = h.get("seismic_zone_sia261")
    f.append(_rec("earthquake_exposure", {"sia261_zone": eq, "soil_class": h.get("seismic_soil_class")} if eq else None,
                  "verified", [nat], None if h.get("seismic_soil_class") else "soil class not mapped by the canton"))

    def cantonal(proc_key, label):
        if proc_key in proc:
            v = dict(proc[proc_key])
            v["level"] = LEVEL_EN.get(str(v.get("level", "")).lower(), v.get("level"))
            return _rec(label, v, "verified", [cant])
        if cant_note and "outside every hazard zone" in cant_note:
            return _rec(label, {"level": "none", "share": 0}, "verified", [cant], "mapped area, building outside hazard zones")
        return _rec(label, None, "unknown", note=cant_note)

    f.append(cantonal("flood", "flood_exposure"))
    rs = h.get("surface_runoff_perimeter_share")
    f.append(_rec("surface_runoff_exposure",
                  {"perimeter_share": rs, "max_depth": h.get("surface_runoff_max_depth"), "by_depth": h.get("surface_runoff_share_by_depth")}
                  if rs is not None else None, "verified", [nat],
                  "share of the perimeter in a runoff zone; depth read from the official map colours (image processing, no LLM)"))
    hail = h.get("hail_50y_cm")
    f.append(_rec("hail_exposure", {"hail_50y_cm": hail} if hail else None, "verified", [nat]))
    f.append(cantonal("landslide", "landslide_exposure"))

    # ---- maintenance & history
    repairs = list(vis.get("possible_roof_issues") or [])
    if fac.get("visible_condition") in ("fair", "poor"):
        repairs.append(f"facade condition looks {fac['visible_condition']} (street-level photo)")
    f.append(_rec("potential_repair_needs", repairs or None, "observed",
                  [img, sv if fac.get("visible_condition") in ("fair", "poor") else None], "to inspect, not confirmed damage"))

    ident = {
        "company_name": c.get("registered_names"),
        "company_uid": c.get("uid"),
        "company_register_status": c.get("register_status"),
        "bankruptcy_risk_signals": c.get("bankruptcy_risk"),
        "building_address": b.get("address"),
        "building_egid": b.get("egid"),
        "canton": b.get("canton"),
        "cantonal_insurance_regime": b.get("cantonal_insurance_regime"),
        "estimated_market_value_chf": None,
        "company_size_employees": est.get("size_class"),
        "noga_code": est.get("noga_code"),
        "industry_type_declared": ind.get("label"),
        "annual_revenue_chf": None,
        "annual_revenue_note": "not public for private companies — ask the client",
        "requested_coverages": None,
        "insurance_premium_estimate_chf": None,
        "insurance_premium_note": "only with a validated AXA tariff model",
    }
    # Output format per feature (team contract): {feature, value, status, requires_verification}.
    # Sources and notes go to a separate map so the feature records stay minimal.
    features = [{k: x[k] for k in ("feature", "value", "status", "requires_verification")} for x in f]
    evidence = {x["feature"]: {"source_ids": x["source_ids"], "note": x["note"]} for x in f if x["source_ids"] or x["note"]}
    return {"identification": ident, "features": features, "feature_evidence": evidence, "sources": S.items}


def coverage(features: list) -> dict:
    """Completeness per priority — the measurable output for the jury."""
    out = {}
    for p in ("P0", "P1", "P2"):
        fs = [x for x in features if CATALOG[x["feature"]][3] == p]
        out[p] = {"filled": sum(x["status"] != "unknown" for x in fs), "total": len(fs)}
    out["all"] = {"filled": sum(x["status"] != "unknown" for x in features), "total": len(features)}
    return out
