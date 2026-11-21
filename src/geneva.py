"""Geneva-specific open data (SITG, ArcGIS REST, no key). 0 LLM token. Used when the building is in GE.

Tested on Geneva SMEs — what each layer adds to the 25 features:
- CAD_BATIMENT_HORSOL (by EGID)      → usage (destination), construction year/period, transformation year,
                                       floors above/below ground, height, surface
- CAD_BATI3D_BASIC_TOIT (by EGID)    → roof slope → flat / pitched (verified, not only "seen" by vision)
- OCEN_ETAT_IDC_PUBLIC (by EGID)     → heated floor area (SRE m²), heating energy index
- SCANE_CHAUDIERE (by EGID)          → boilers: fuel (gas / heating oil / wood), active or not, year, power
- SIT_AUTOR_DOSSIER (in footprint)   → building permits: renovations, transformations AND declared activities
                                       (e.g. "aménagement d'un atelier de galvanoplastie")
- REG_ENTREPRISE_ETABLISSEMENT (UID) → NOGA code, branch, size class (employees), WEBSITE
- REG_ENTREPRISE_ETABLISSEMENT (in footprint) → other companies in the same building (shared building)
"""

import gzip
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import httpx

SITG = "https://vector.sitg.ge.ch/arcgis/rest/services"
_client = httpx.Client(timeout=30, headers={"User-Agent": "axa-smart-property/0.1", "Accept": "application/json"})

RENOVATION_KW = re.compile(r"rénov|renov|transform|surélév|assainiss|isolation|toiture|façade|facade|réfection|remplacement", re.I)
GAS_KW = re.compile(r"gaz|four|fours|forge|chaufferie|brûleur|bruleur|cuisson|fumoir", re.I)
STORAGE_KW = re.compile(r"citerne|réservoir|reservoir|hydrocarbure|mazout|stockage|dépôt de|entreposage|solvant|produits chimiques", re.I)
ACTIVITY_KW = re.compile(r"atelier|garage|carrosserie|galvano|peinture|menuiserie|imprimerie|boulangerie|cuisine|restaurant|"
                         r"entrepôt|dépôt|stockage|laboratoire|four|forge|soudure|citerne|station-service|pressing", re.I)

# NOGA (2008, first digits) → typical fire-relevant process (inferred from the sector, not observed)
NOGA_HAZARDS = {
    "1071": ("bakery ovens", True), "1072": ("bakery ovens", True), "1013": ("smoking / cooking", True),
    "181": ("printing: inks, solvents, paper stock", False), "16": ("woodworking: dust, wood stock", False),
    "2511": ("metal construction: welding, cutting", True), "2562": ("metal machining: welding, oils", True),
    "2561": ("surface treatment / electroplating: chemicals, baths", True), "24": ("metallurgy: furnaces", True),
    "2229": ("plastics processing", True), "4520": ("car repair: fuels, oils, welding, paint", True),
    "4532": ("car parts", False), "5610": ("restaurant kitchen: cooking, fryers", True),
    "9601": ("dry cleaning: solvents", False), "4334": ("painting: paints, solvents", False),
    "4321": ("electrical installation", False), "4322": ("plumbing / heating installation: soldering", True),
}


EXTRACT = Path(__file__).resolve().parent.parent / "data" / "sitg_ge_extract.json.gz"
_extract_cache = None


def _extract() -> dict:
    """Bundled SITG extract (activity buildings), built by scripts/build_sitg_extract.py. SITG blocks cloud IPs
    (Vercel), so in production this file is the source; live queries are the fallback for buildings not in it."""
    global _extract_cache
    if _extract_cache is None:
        try:
            _extract_cache = json.loads(gzip.decompress(EXTRACT.read_bytes()))
        except (OSError, ValueError):
            _extract_cache = {}
    return _extract_cache


def _q(service, params, layer=0):
    """ArcGIS query via GET with short URLs. (POST is refused from cloud IPs — 406 on Vercel — and sending a large
    building's polygon in a GET URL is too long: spatial queries use _in_footprint() instead.)"""
    p = {"outFields": "*", "returnGeometry": "false", "f": "json"}
    p.update(params)
    r = _client.get(f"{SITG}/{service}/FeatureServer/{layer}/query", params=p)
    r.raise_for_status()
    return [f["attributes"] for f in r.json().get("features", [])]


def _in_footprint(service, footprint_geojson, out_fields="*", buffer_m=0.0):
    """Features intersecting the footprint: bounding-box query (short GET URL), exact filter in Python."""
    from shapely.geometry import Point, Polygon, shape
    zone = shape(footprint_geojson).buffer(buffer_m) if buffer_m else shape(footprint_geojson)
    x0, y0, x1, y1 = zone.bounds
    r = _client.get(f"{SITG}/{service}/FeatureServer/0/query",
                    params={"geometry": f"{x0},{y0},{x1},{y1}", "geometryType": "esriGeometryEnvelope", "inSR": 2056,
                            "spatialRel": "esriSpatialRelIntersects", "outSR": 2056, "returnGeometry": "true",
                            "outFields": out_fields, "f": "json"})
    r.raise_for_status()
    out = []
    for f in r.json().get("features", []):
        g = f.get("geometry") or {}
        if "x" in g:
            geom = Point(g["x"], g["y"])
        elif g.get("rings"):
            geom = Polygon(g["rings"][0]).buffer(0)
        else:
            continue
        if zone.intersects(geom):
            out.append(f["attributes"])
    return out


def _result(future, default):
    """One failing SITG layer must not lose the others."""
    if future is None:
        return default
    try:
        return future.result()
    except Exception:  # noqa: BLE001
        return default


def _date(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).date().isoformat() if isinstance(ms, (int, float)) else None


def noga_hazard(code):
    for n in (4, 3, 2):
        if code and code[:n] in NOGA_HAZARDS:
            return NOGA_HAZARDS[code[:n]]
    return None


# Establishments that do not physically occupy premises (pension funds, holdings, investment companies).
NON_OCCUPANT_NOGA = ("653", "642", "6499")
LEGAL_SUFFIX = re.compile(r"\b(sa|s\.a\.|sàrl|sarl|sagl|ag|gmbh|ltd|société coopérative|societe cooperative|"
                          r"en liquidation|in liquidation)\b\.?", re.I)


def norm_company(name: str) -> str:
    """'Nutrifrais SA' and 'Nutrifrais' are the same establishment listed twice in the register."""
    return re.sub(r"[^a-z0-9à-ÿ]+", " ", LEGAL_SUFFIX.sub(" ", (name or "").lower())).strip()


def _occupants(footprint_geojson) -> list[dict]:
    """Companies registered inside the building footprint (+5 m: register points sit on the address/entrance)."""
    return _dedupe_occupants(_in_footprint("REG_ENTREPRISE_ETABLISSEMENT", footprint_geojson,
                                           "NOM,RAISON_SOCIALE,NUM_IDE,CODE_NOGA,BRANCHE,TAILLE", buffer_m=5))


def _dedupe_occupants(rows) -> list[dict]:
    seen, out = set(), []
    for a in rows:
        name = a.get("RAISON_SOCIALE") or a.get("NOM")
        key = norm_company(name)
        if not key or key in seen or str(a.get("CODE_NOGA") or "").startswith(NON_OCCUPANT_NOGA):
            continue
        seen.add(key)
        out.append({"name": name, "uid": a.get("NUM_IDE"), "branch": a.get("BRANCHE"), "size": a.get("TAILLE")})
    return out


def building(egid, footprint_geojson=None) -> dict:
    rec = (_extract().get("buildings") or {}).get(str(int(egid))) if egid else None
    if rec:  # bundled extract: 0 network call, works on Vercel
        out = {"status": "ok", "source": f"sitg_extract ({_extract().get('generated_at', '?')[:10]})"}
        out["occupants"] = _dedupe_occupants(rec["establishments"])
        return _process(out, rec["horsol"], rec["toit"], rec["idc"], rec["boilers"], rec["permits"], rec["polluted_sites"])
    out = {"status": "ok", "source": "sitg_live"}
    # The 7 SITG layers are independent → query them in parallel.
    from concurrent.futures import ThreadPoolExecutor
    w = f"EGID={int(egid)}" if egid else "1=0"
    with ThreadPoolExecutor(7) as ex:
        fh = ex.submit(_q, "CAD_BATIMENT_HORSOL", {"where": w})
        ft = ex.submit(_q, "CAD_BATI3D_BASIC_TOIT", {"where": w, "outFields": "PENTE_MIN,PENTE_MAX,PENTE_MOY"})
        fi = ex.submit(_q, "OCEN_ETAT_IDC_PUBLIC", {"where": w, "outFields": "SRE_M2,DERNIER_IDC,ANNEE_DERNIER_IDC,ETAT_IDC_GEN"})
        fb = ex.submit(_q, "SCANE_CHAUDIERE", {"where": w})
        fp = ex.submit(_in_footprint, "SIT_AUTOR_DOSSIER", footprint_geojson) if footprint_geojson else None
        fpol = ex.submit(_in_footprint, "GOL_SITES_POLLUES", footprint_geojson) if footprint_geojson else None
        focc = ex.submit(_occupants, footprint_geojson) if footprint_geojson else None
        h, t, i, b = _result(fh, []), _result(ft, []), _result(fi, []), _result(fb, [])
        pol, p = _result(fpol, []), _result(fp, None)
        out["occupants"] = _result(focc, [])
    return _process(out, h, t, i, b, p, pol)


def _process(out, h, t, i, b, p, pol) -> dict:
    """Same processing for the bundled extract and live queries (same ArcGIS attribute format)."""
    if h:
        a = h[0]
        out["building"] = {k.lower(): a.get(k) for k in ("DESTINATION", "NOMEN_CLASSE", "EPOQUE_CONSTRUCTION", "ANNEE_CONSTRUCTION",
                                                         "NIVEAUX_HORSOL", "NIVEAUX_SSOL", "HAUTEUR", "SURFACE")}
        out["building"]["annee_transformation"] = a.get("ANNEE_TRANSFORNATION")  # sic, official field name
        out["building"]["mixed_use"] = "Mixte" in (a.get("NOMEN_CLASSE") or "")
    if t:
        slope = t[0].get("PENTE_MOY") or 0
        out["roof"] = {"slope_mean_deg": slope, "type": "flat" if slope < 5 else "low-pitched" if slope < 15 else "pitched"}
    if i:
        out["energy"] = {"heated_area_m2": i[0].get("SRE_M2"), "idc_mj_m2": i[0].get("DERNIER_IDC"),
                         "idc_year": i[0].get("ANNEE_DERNIER_IDC"), "idc_status": i[0].get("ETAT_IDC_GEN")}
    out["boilers"] = [{"fuel": x.get("LIBELLE_COMBUSTIBLE"), "active": x.get("ETAT_INSTALLATION") == "Active",
                       "year": int(x["ANNEE_CHAUDIERE"]) if x.get("ANNEE_CHAUDIERE") and x["ANNEE_CHAUDIERE"] > 1900 else None,
                       "power_kw": x.get("PUISS_NOM_CHAUDIERE"), "use": x.get("TYPE_INSTALLATION")} for x in b]
    if p is not None:  # permits whose point falls inside the official footprint
        permits = [{"type": x.get("TYPE_DOSSIER"), "date": _date(x.get("DATE_DEPOT")), "status": x.get("STATUT"),
                    "description": x.get("DESCRIPTION")} for x in p if x.get("DESCRIPTION") and x["DESCRIPTION"] != "non renseigné"]
        permits = sorted(permits, key=lambda x: x["date"] or "", reverse=True)
        out["permits"] = permits[:15]
        out["renovation_permits"] = [x for x in out["permits"] if RENOVATION_KW.search(x["description"])]
        out["activity_permits"] = [x for x in out["permits"] if ACTIVITY_KW.search(x["description"])]
        out["gas_permits"] = [x for x in permits if GAS_KW.search(x["description"])]
        out["storage_permits"] = [x for x in permits if STORAGE_KW.search(x["description"])]
    out["polluted_sites"] = [{"activity": x.get("TYPE_ACTIVITE_OU_TYPE_REMBLAI") or x.get("LIBELLE_NOGA"), "site_type": x.get("TYPE_SITE"),
                              "pollutants": x.get("TYPE_POLLUANT"), "company": x.get("RAISON_SOCIALE")} for x in pol]
    return out


def establishment(uid, egid=None) -> dict:
    """Cantonal register of establishments, by UID (stored without punctuation: CHE143634449)."""
    if not uid:
        return {"status": "empty"}
    key = re.sub(r"[^A-Z0-9]", "", uid.upper())
    a = dict((_extract().get("establishments_by_uid") or {}).get(key) or {})
    if a:
        if not a.get("SITE_INTERNET") and egid:  # website often on the twin row (same name, no UID) in the same building
            rec = (_extract().get("buildings") or {}).get(str(int(egid))) or {}
            me = norm_company(a.get("RAISON_SOCIALE") or a.get("NOM"))
            a["SITE_INTERNET"] = next((x["SITE_INTERNET"] for x in rec.get("establishments", [])
                                       if x.get("SITE_INTERNET") and norm_company(x.get("RAISON_SOCIALE") or x.get("NOM")) == me), None)
        return _establishment_out(a)
    rows = _q("REG_ENTREPRISE_ETABLISSEMENT", {"where": f"NUM_IDE='{key}'"})
    if not rows:
        return {"status": "empty"}
    a = rows[0]
    if not a.get("SITE_INTERNET") and a.get("ADRESSE"):
        # The same establishment is often listed twice (with / without UID); the website sits on the other row.
        first = re.sub(r"[^A-Za-zÀ-ÿ0-9 ]", " ", a.get("NOM") or "").split()[:1]
        if first:
            addr = a["ADRESSE"].replace("'", "''")
            twins = _q("REG_ENTREPRISE_ETABLISSEMENT", {"where": f"ADRESSE='{addr}' AND UPPER(NOM) LIKE '{first[0].upper()}%'",
                                                         "outFields": "SITE_INTERNET"})
            a["SITE_INTERNET"] = next((t["SITE_INTERNET"] for t in twins if t.get("SITE_INTERNET")), None)
    return _establishment_out(a)


def _establishment_out(a) -> dict:
    noga = a.get("CODE_NOGA")
    hz = noga_hazard(noga)
    return {"status": "ok", "noga_code": noga, "branch": a.get("BRANCHE"), "activity_detail": a.get("ACTIVITE_DETAIL"),
            "size_class": a.get("TAILLE"), "website": a.get("SITE_INTERNET"), "address": a.get("ADRESSE"),
            "sector_hazard": {"process": hz[0], "high_temperature": hz[1]} if hz else None}
