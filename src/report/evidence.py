"""Deterministic, no-LLM adapter: FEATURE document (v2.0 llm_input.json) → COMBINED_FEATURE (evidence bundle v1.0).

    from src.report.evidence import to_bundle
    bundle = to_bundle(v2_dict, "cmds-sa", images_dir=out / "images", asset_root=out)

Works for real ETL output and for the synthetic dataset. Synthetic mode is detected from the sources
(every provider prefixed "SYNTHETIC"): synthetic bundles get the SYNTHETIC labels and null URLs required by
the report kit; real bundles keep the real providers, URLs and attributions.

Spec: reporting/INPUT_V2_ADAPTER.md; schema: schemas/COMBINED_FEATURE/combined_feature.v1.schema.json.
- one fact per v2 feature, id `feat.<feature>` (value kept with its JSON type, ranges preserved), src_N ids unchanged;
- context facts `ev.*` carrying the evidence blocks a report needs (register records, permits, polluted sites,
  website claims with building_specific flags, vision outputs) — so contradictions stay visible to the writer;
- missing protection facts (`feat.sprinklers`, …) appended as unknown and listed in unknown_feature_ids;
- visuals only for assets that exist on disk (dataset/images/<case_id>/), with the PUBLIC annotations sidecar;
- quality gates: schema, source resolution, verified provenance (repair = downgrade + flag), numeric ranges, asset existence.
The private ground truth is never read here.
"""

import json
import re
from pathlib import Path

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[2]
SCHEMA = json.loads((ROOT / "schemas" / "COMBINED_FEATURE" / "combined_feature.v1.schema.json").read_text(encoding="utf-8"))

UNITS = {"reconstruction_value_chf": "CHF", "floor_area_m2": "m2"}
HAZARDS = {"earthquake_exposure", "flood_exposure", "surface_runoff_exposure", "hail_exposure", "landslide_exposure"}
BUILDING = {"reconstruction_value_chf", "building_usage", "construction_material", "construction_year", "floor_area_m2",
            "number_of_floors", "roof_type_material", "building_renovations", "potential_repair_needs"}
OFFICIAL_KINDS = {"official_registry", "official_geodata"}
VISUAL_KINDS = {"aerial_image", "street_image"}
PROTECTION_FACTS = ["sprinklers", "fire_alarm_detection", "fire_compartmentation", "fire_protection_inspections",
                    "prior_losses", "pipe_condition", "electrical_installation_condition"]
# NOGA prefix → declared-industry key (to detect a declared-vs-register mismatch; deterministic, no LLM)
NOGA_TO_INDUSTRY = [("2561", "surface_treatment"), ("107", "bakery_food"), ("101", "meat_dairy"), ("105", "meat_dairy"),
                    ("452", "car_repair"), ("9601", "textile"), ("16", "woodworking"), ("31", "woodworking"),
                    ("25", "metalworking"), ("18", "printing"), ("22", "plastics_chemicals"), ("20", "plastics_chemicals"),
                    ("52", "warehouse_logistics"), ("49", "warehouse_logistics"), ("26", "precision_electronics"),
                    ("4322", "other"), ("3832", "other"), ("712", "other")]
PROTECTION_KW = {"sprinklers": "sprinkler", "fire_alarm_detection": "detect", "fire_compartmentation": "compartment",
                 "fire_protection_inspections": "inspection", "prior_losses": "loss", "pipe_condition": "pipe",
                 "electrical_installation_condition": "electric"}
SYNTH_USAGE = "SYNTHETIC benchmark record — fictional data, not usable for real underwriting"


def _noga_industry(code):
    return next((k for p, k in NOGA_TO_INDUSTRY if code and code.startswith(p)), None)


def _fact(fid, key, value, unit, status, scope, srcs, conf, method):
    return {"id": fid, "field_key": key, "value": value, "unit": unit, "evidence_status": status, "site_scope": scope,
            "source_ids": srcs, "valid_as_of": None, "confidence": conf, "method": method}


def is_synthetic(v2: dict) -> bool:
    provs = [s.get("provider") or "" for s in v2.get("sources") or []]
    return bool(provs) and all(p.startswith("SYNTHETIC") for p in provs)


def to_bundle(v2: dict, case_id: str, images_dir: Path | None = None, asset_root: Path = ROOT,
              synthetic: bool | None = None) -> dict:
    """images_dir: folder holding the image files named as in v2["images"] (None = no visuals);
    asset_root: visuals' asset_uri is written relative to this folder."""
    synthetic = is_synthetic(v2) if synthetic is None else synthetic
    sx = " (synthetic)" if synthetic else ""
    flags = ["SYNTHETIC case: fictional company, building and evidence — not usable for real underwriting"] if synthetic else []
    src_kind = {s["id"]: s["kind"] for s in v2["sources"]}
    by_kind = {}
    for s in v2["sources"]:
        by_kind.setdefault(s["kind"], []).append(s["id"])
    fe = v2.get("feature_evidence") or {}
    ev = v2["evidence"]
    pub = ev["public_data"]
    ge = pub.get("geneva") or {}
    created = v2["generated_at"][:10]
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", created):
        raise ValueError(f"{case_id}: generated_at has no valid date")

    facts = []
    feats = {f["feature"]: f for f in v2["features"]}
    for f in v2["features"]:
        name, st, val = f["feature"], f["status"], f["value"]
        e = fe.get(name) or {}
        srcs = [s for s in e.get("source_ids", []) if s in src_kind]
        if len(srcs) != len(e.get("source_ids", [])):
            flags.append(f"feat.{name}: unresolved source id(s) dropped")
        kinds = {src_kind[s] for s in srcs}
        note = e.get("note")
        method = f"upstream status: {st}" + (f"; {note}" if note else "")
        if st == "verified":
            if kinds & OFFICIAL_KINDS:
                es, conf = "official_record", "high" if not f["requires_verification"] else "medium"
            elif "company_website" in kinds:
                es, conf = "company_level_document", "medium"
            else:  # quality gate 2: verified without an official/document source → repair (downgrade) + flag
                es, conf = "derived_estimate", "low"
                flags.append(f"REPAIRED feat.{name}: 'verified' without a supporting official source → derived_estimate")
        elif st == "observed":
            es, conf = ("visual_observation", "medium") if kinds & VISUAL_KINDS else ("derived_estimate", "low")
            if not kinds & VISUAL_KINDS:
                flags.append(f"feat.{name}: 'observed' without an image source → not treated as a visual observation")
        elif st == "estimated":
            es, conf = "derived_estimate", "medium"
            if not note:
                flags.append(f"feat.{name}: estimate without documented method")
        elif st in ("inferred", "declared"):
            es, conf = "derived_estimate", "low"
            method = f"{'INFERRED' if st == 'inferred' else 'DECLARED by the client'} — not confirmed; " + method
            if st == "declared":
                flags.append(f"feat.{name}: upstream status 'declared' mapped to derived_estimate (client declaration)")
        else:
            es, conf, srcs = "unknown", "low", []
        # site scope
        if name in HAZARDS or name in BUILDING:
            scope = "building"
        elif es == "unknown":
            scope = "unknown"
        elif kinds & {"company_website", "client_input"}:
            scope = "company"
        elif name == "business_sector":
            scope = "industrial_site"
        else:
            scope = "building"
        facts.append(_fact(f"feat.{name}", name, val, UNITS.get(name), es, scope, srcs, conf, method))

    def setf(name, **kw):
        for x in facts:
            if x["id"] == f"feat.{name}":
                x.update(kw)

    # ---- deterministic contradiction checks (kept visible, never resolved silently)
    gb = ge.get("building") or {}
    y = feats["construction_year"]["value"]
    m = re.search(r"(\d{4})\D+(\d{4})", str(gb.get("epoque_construction") or ""))
    if isinstance(y, int) and m and not int(m.group(1)) <= y <= int(m.group(2)):
        setf("construction_year", evidence_status="conflicting", confidence="low")
        flags.append(f"CONFLICT feat.construction_year: building register year {y} vs cadastre epoch '{gb['epoque_construction']}'")
    gas = str(feats["gas_installations"]["value"] or "")
    hp = [p for p in ge.get("permits") or [] if re.search(r"pompe à chaleur", p.get("description") or "", re.I)]
    if gas.startswith("active gas boiler") and hp:
        setf("gas_installations", evidence_status="conflicting", confidence="low")
        flags.append(f"CONFLICT feat.gas_installations: boiler register shows an active gas boiler but permit {hp[0]['date'][:4]} "
                     f"documents '{hp[0]['description']}'")
    declared = v2["request"].get("industry_type")
    est = ge.get("establishment") or {}
    reg_ind = _noga_industry(est.get("noga_code"))
    if declared and reg_ind and declared != reg_ind:
        flags.append(f"CONFLICT declared industry '{declared}' differs from the cantonal register (NOGA {est.get('noga_code')}: "
                     f"{est.get('branch')}); inferences based on the declared industry are unreliable")
    mat_note = (fe.get("construction_material") or {}).get("note") or ""
    facade_rejected = "neighbouring building" in mat_note
    if facade_rejected:
        flags.append("street-level photo rejected upstream (probably a neighbouring building): facade observations do not describe the insured building")
    flags.append("natural-hazard exposures are for underwriting/prevention only — not an individual premium surcharge (regulated cover)")

    # ---- context facts (evidence the writer needs to see contradictions and scope)
    def first(kind):
        return (by_kind.get(kind) or [None])[0]
    sitg, regbl, zefix = None, first("official_registry"), None
    for s in v2["sources"]:
        p = s["provider"].lower()
        if "sitg" in p or "cantonal registers" in p:
            sitg = s["id"]
        if "commercial register" in p:
            zefix = s["id"]
        if "building register" in p:
            regbl = s["id"]
    c = pub.get("company") or {}
    facts.append(_fact("ev.declared_industry", "declared_industry_type",
                       {"key": declared, "label": v2["identification"].get("industry_type_declared")} if declared else None,
                       None, "derived_estimate" if declared else "unknown", "company" if declared else "unknown",
                       [s for s in by_kind.get("client_input", [])] if declared else [], "low",
                       "declared by the client in the request form (not verified)" if declared else None))
    facts.append(_fact("ev.company_register", "company_register_record",
                       {"uid": c.get("uid"), "legal_form_code": c.get("legal_form_code"), "purpose": c.get("purpose"),
                        "register_status": c.get("register_status"), "registered_since": c.get("registered_since"),
                        "noga_code": est.get("noga_code"), "branch": est.get("branch"), "size_class": est.get("size_class"),
                        "establishment_address": est.get("address")},
                       None, "official_record", "company", [s for s in (zefix, sitg if est.get("status") == "ok" else None) if s], "high",
                       "commercial register + cantonal establishment register" + sx))
    b = pub.get("building") or {}
    cad = {"egid": b.get("egid"), "class_code": b.get("class_code"), "register_construction_year": b.get("construction_year"),
           "register_floors": b.get("floors"), "footprint_m2": b.get("footprint_m2"), "register_floor_area_m2": b.get("floor_area_m2"),
           "volume_m3": b.get("volume_m3"), "altitude_m": b.get("altitude_m"), "condition_estimate": b.get("condition"),
           "cadastre": gb or None, "roof_3d": ge.get("roof"), "energy_index": ge.get("energy")}
    facts.append(_fact("ev.building_records", "building_register_and_cadastre", cad, None, "official_record", "building",
                       [s for s in (regbl, sitg if gb else None) if s], "high", "building register + cantonal cadastre" + sx))
    facts.append(_fact("ev.heating_register", "heating_and_boiler_register",
                       {"heating": b.get("heating"), "boilers": ge.get("boilers")}, None, "official_record", "building",
                       [s for s in (regbl, sitg) if s], "medium", "registers may be outdated (check info_updated / permits)"))
    if "permits" in ge:
        facts.append(_fact("ev.building_permits", "building_permits", ge["permits"], None, "official_record", "building",
                           [sitg] if sitg else [], "high", "building-permit register, permits whose point falls in the footprint"))
    else:
        facts.append(_fact("ev.building_permits", "building_permits", None, None, "unknown", "unknown", [], "low",
                           "permit register not available for this case"))
    if ge.get("polluted_sites"):
        facts.append(_fact("ev.polluted_sites", "polluted_sites_cadastre", ge["polluted_sites"], None, "official_record", "building",
                           [sitg] if sitg else [], "high", "polluted-sites cadastre: activity of the listed company (may be a former occupant)"))
    w = ev.get("website") or {}
    if w.get("status") == "ok" and w.get("extraction"):
        x = w["extraction"]
        facts.append(_fact("ev.website_extraction", "company_website_claims",
                           {k: x.get(k) for k in ("activity_summary", "processes", "gas_installations", "high_temperature_processes",
                                                  "flammable_materials", "flammable_materials_detail", "protections_mentioned", "evidence")},
                           None, "company_level_document", "company", by_kind.get("company_website", []), "medium",
                           "website text extraction; claims with building_specific=false are company-wide, not proof for this building"))
    a = ev.get("aerial_image") or {}
    if a.get("vision"):
        facts.append(_fact("ev.aerial_vision", "orthophoto_vision_observations", a["vision"], None, "visual_observation", "building",
                           by_kind.get("aerial_image", []), "medium", "vision model on the orthophoto: candidates to verify"))
    fcd = ev.get("facade") or {}
    if fcd.get("vision"):
        facts.append(_fact("ev.facade_vision", "street_photo_vision_observations", {"camera": fcd.get("camera"), **fcd["vision"]}, None,
                           "visual_observation", "unknown" if facade_rejected else "building", by_kind.get("street_image", []),
                           "low" if facade_rejected else "medium",
                           "REJECTED: probably a neighbouring building" if facade_rejected else "vision model on a street-level photo"))
    nh = pub.get("natural_hazards") or {}
    if nh.get("cantonal_hazard_map_note"):
        cant = next((s["id"] for s in v2["sources"] if "cantonal hazard" in s["provider"].lower()), None)
        facts.append(_fact("ev.cantonal_hazard_map_note", "cantonal_hazard_map_status", nh["cantonal_hazard_map_note"], None,
                           "official_record", "building", [cant] if cant else [], "high", "status of the cantonal flood/landslide map"))

    # ---- missing protection facts (never infer absence from not found)
    prot = [p.lower() for p in ((w.get("extraction") or {}).get("protections_mentioned") or [])]
    unknown_ids = [x["id"] for x in facts if x["id"].startswith("feat.") and x["evidence_status"] == "unknown"]
    for p in PROTECTION_FACTS:
        hit = [q for q in prot if PROTECTION_KW[p] in q]
        if hit:
            facts.append(_fact(f"feat.{p}", p, f"mentioned on the company website: {hit[0]} (company-level, not verified on site)", None,
                               "company_level_document", "company", by_kind.get("company_website", []), "low", "website mention only"))
        else:
            facts.append(_fact(f"feat.{p}", p, None, None, "unknown", "unknown", [], "low", None))
            unknown_ids.append(f"feat.{p}")

    # ---- visuals (only existing assets)
    sidecar = images_dir / "annotations.json" if images_dir else None
    pub_ann = json.loads(sidecar.read_text(encoding="utf-8"))["images"] if sidecar and sidecar.exists() else {}
    visuals = []
    fact_ids = {x["id"] for x in facts}
    for name, img in (v2.get("images") or {}).items():
        path = images_dir / name if images_dir else None
        if not path or not path.exists():
            flags.append(f"image {name} listed but asset missing → not exposed as a visual")
            continue
        is_ortho = name.startswith("orthophoto")
        anns = [dict(a, linked_fact_ids=[i for i in a["linked_fact_ids"] if i in fact_ids]) for a in pub_ann.get(name, [])]
        rejected = (not is_ortho) and facade_rejected
        visuals.append({
            "id": f"vis.{name.rsplit('.', 1)[0]}",
            "kind": "aerial_orthophoto" if is_ortho else "company_photo",
            "asset_uri": path.resolve().relative_to(Path(asset_root).resolve()).as_posix(),
            "source_ids": by_kind.get("aerial_image" if is_ortho else "street_image", []),
            "captured_or_published_at": None if is_ortho else ((fcd.get("camera") or {}).get("date")),
            "annotation_ids": [a["id"] for a in anns],
            "annotations": anns,
            "alt_text": f"{img['label']}. Vision summary: {img.get('shows')}" + (" — REJECTED: probably not the insured building" if rejected else ""),
            "building_egid": None if rejected else v2["identification"].get("building_egid"),
        })
    if not visuals:
        flags.append("no image asset attached to this case: visual evidence limited to the vision-model text (ev.aerial_vision / ev.facade_vision)")
    flags.append("valid_as_of unknown for most sources (" + ("synthetic snapshot)" if synthetic else "retrieval snapshot)"))

    if synthetic:
        sources = [{"id": s["id"], "provider": s["provider"] if s["provider"].startswith("SYNTHETIC") else f"SYNTHETIC {s['provider']}",
                    "title": f"{s['kind'].replace('_', ' ')} record (synthetic)", "url": None, "publication_date": None,
                    "retrieved_at": created, "usage_or_attribution": SYNTH_USAGE} for s in v2["sources"]]
    else:
        credits = {img.get("credit") for img in (v2.get("images") or {}).values() if img.get("credit")}
        sources = [{"id": s["id"], "provider": s["provider"], "title": f"{s['kind'].replace('_', ' ')} record",
                    "url": s.get("url"), "publication_date": None, "retrieved_at": created,
                    "usage_or_attribution": s.get("license") or s.get("attribution")
                    or next((c for c in credits if s["provider"].split()[0].lower() in c.lower()), None)} for s in v2["sources"]]

    ident = v2["identification"]
    bundle = {
        "schema_version": "1.0",
        "case": {"case_id": case_id, "client_name": v2["request"]["client_name"],
                 "legal_company_name": v2["request"]["company_legal_name"], "building_address": v2["request"]["building_address"],
                 "created_at": created},
        "building": {"egid": ident.get("building_egid"), "company_uid": ident.get("company_uid"), "canton": ident.get("canton"),
                     "identity_resolution": "unique" if ident.get("building_egid") else "not_found"},
        "coverage_context": {"jurisdiction": "CH-GE",
                             "candidate_components": ["fire", "regulated_natural_hazards", "earthquake_optional", "water_optional"]},
        "facts": facts,
        "visuals": visuals,
        "sources": sources,
        "unknown_feature_ids": unknown_ids[:25],
        "quality_flags": flags,
    }
    errs = check_bundle(bundle, asset_root, synthetic)
    if errs:
        raise ValueError(f"{case_id}: evidence bundle failed quality gates: {errs[:5]}")
    return bundle


def check_bundle(bundle: dict, asset_root: Path = ROOT, synthetic: bool | None = None) -> list[str]:
    """Quality gates 1, 3-6 (gate 2 is applied/repaired in to_bundle). Returns error messages."""
    if synthetic is None:
        synthetic = any((s.get("provider") or "").startswith("SYNTHETIC") for s in bundle.get("sources", []))
    errs = [f"schema: {'/'.join(map(str, e.absolute_path))}: {e.message}" for e in Draft202012Validator(SCHEMA).iter_errors(bundle)]
    sids = {s["id"] for s in bundle["sources"]}
    fids = [f["id"] for f in bundle["facts"]]
    if len(set(fids)) != len(fids):
        errs.append("duplicate fact ids")
    for f in bundle["facts"]:
        errs += [f"{f['id']}: unknown source {s}" for s in f["source_ids"] if s not in sids]
        if f["evidence_status"] in ("official_record", "site_specific_document", "company_level_document") and not f["source_ids"]:
            errs.append(f"{f['id']}: {f['evidence_status']} without source")
        v = f["value"]
        if f["field_key"] == "reconstruction_value_chf" and isinstance(v, dict):
            if not v["low_chf"] <= v["best_estimate_chf"] <= v["high_chf"]:
                errs.append(f"{f['id']}: range not ordered")
        if f["field_key"] in ("flood_exposure", "landslide_exposure", "surface_runoff_exposure") and isinstance(v, dict):
            for k in ("share", "perimeter_share"):
                if k in v and not 0 <= v[k] <= 1:
                    errs.append(f"{f['id']}: {k} outside [0,1]")
    fidset = set(fids)
    for vis in bundle["visuals"]:
        if not (Path(asset_root) / vis["asset_uri"]).exists():
            errs.append(f"{vis['id']}: asset missing")
        errs += [f"{vis['id']}: source {s} unknown" for s in vis["source_ids"] if s not in sids]
        if [a["id"] for a in vis["annotations"]] != vis["annotation_ids"]:
            errs.append(f"{vis['id']}: annotation_ids mismatch")
        for a in vis["annotations"]:
            errs += [f"{a['id']}: linked fact {i} unknown" for i in a["linked_fact_ids"] if i not in fidset]
    errs += [f"unknown_feature_ids: {i} not a fact" for i in bundle["unknown_feature_ids"] if i not in fidset]
    if synthetic and (any(s["url"] for s in bundle["sources"]) or not all(s["provider"].startswith("SYNTHETIC") for s in bundle["sources"])):
        errs.append("synthetic-source rule violated (non-null URL or provider not prefixed SYNTHETIC)")
    return errs

