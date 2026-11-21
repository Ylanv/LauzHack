"""Probe every public data source for one company + address. 0 LLM token.

Usage:
    python scripts/probe_sources.py "Victorinox AG" "Schmiedgasse 57, 6438 Ibach"
    python scripts/probe_sources.py "Victorinox AG" "Schmiedgasse 57, 6438 Ibach" --out probe_out

Writes <out>/<slug>/result.json + ortho.jpg (crop on the building footprint, outline in red).
Each source reports a status: ok | partial | empty | not_found | ambiguous | error.

Rules learned from tests (see README):
- Company name must be the EXACT registered name (legal-form language variants accepted: AG = SA = Ltd).
- National hazard layers are WMTS-only for the Identify API → use WMS GetFeatureInfo.
- Footprint = official survey (AV) via geodienste.ch: WFS, else WMS GetFeatureInfo GML (VD, LU, NE, JU, NW, OW).
- Cantonal hazard maps: WFS, else WMS GetFeatureInfo (VD, NW, OW, UR). BS publishes nothing.
- Runoff is measured on a ring OUTSIDE the walls (the model is unreliable inside footprints).
- Soil class is optional: cantons map it on their own initiative (ZH, BE, SZ, ZG, TG, GR… mostly absent).
"""

import argparse
import io
import json
import re
import sqlite3
import sys
import tempfile
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx
from shapely.geometry import Point, Polygon, shape

GEO = "https://api3.geo.admin.ch/rest/services"
WMS = "https://wms.geo.admin.ch/"
AV = "https://geodienste.ch/db/av_0/deu"
HAZ = "https://geodienste.ch/db/gefahrenkarten_v1_3_0/deu"
SPARQL = "https://ld.admin.ch/query"
STAC = "https://data.geo.admin.ch/api/stac/v0.9/collections"
UA = {"User-Agent": "axa-smart-property-probe/0.1"}

# Cantons without a cantonal building insurer (private market): GE, UR, SZ, TI, AI, VS, OW.
PRIVATE_MARKET_CANTONS = {"GE", "UR", "SZ", "TI", "AI", "VS", "OW"}
NO_CANTONAL_HAZARD_MAP = {"BS"}  # not published on geodienste.ch at all

client = httpx.Client(headers=UA, timeout=40, follow_redirects=True)


def step(fn):
    """Time a probe step and turn exceptions into status=error (a probe must never crash)."""
    def run(*a, **kw):
        t = time.perf_counter()
        try:
            out = fn(*a, **kw)
        except Exception as e:  # noqa: BLE001
            out = {"status": "error", "error": f"{type(e).__name__}: {e}"[:300]}
        out["ms"] = int((time.perf_counter() - t) * 1000)
        return out
    run.__name__ = fn.__name__
    return run


# ================================================================ company (Zefix)

# Same legal form in another language: AG = SA = Ltd = SpA ; GmbH = Sàrl = Sagl.
# Not fuzzy matching: "Bobst Mex SA" == "BOBST MEX AG", but "Swiss Re" != "Swiss Re Ltd".
LEGAL_FORMS = {"ag": "ag", "sa": "ag", "s.a.": "ag", "ltd": "ag", "ltd.": "ag", "spa": "ag", "s.p.a.": "ag",
               "gmbh": "gmbh", "sàrl": "gmbh", "sarl": "gmbh", "s.à r.l.": "gmbh", "sagl": "gmbh"}


# Zefix Linked Data sometimes spells the legal form out ("Rivella Société Anonyme | Rivella Limited Company").
LONG_FORMS = {"aktiengesellschaft": "ag", "société anonyme": "ag", "societe anonyme": "ag", "società anonima": "ag",
              "limited company": "ag", "company limited": "ag",
              "gesellschaft mit beschränkter haftung": "gmbh", "société à responsabilité limitée": "gmbh",
              "società a garanzia limitata": "gmbh", "limited liability company": "gmbh"}


def _norm(name):
    s = re.sub(r"\s+", " ", name.lower().replace("’", "'")).strip()
    for long, short in LONG_FORMS.items():
        if s.endswith(" " + long):
            return s[: -len(long)] + short
    tokens = s.split(" ")
    if tokens and tokens[-1] in LEGAL_FORMS:
        tokens[-1] = LEGAL_FORMS[tokens[-1]]
    return " ".join(tokens)


def _zefix_rows(prefix):
    esc = prefix.replace("\\", "\\\\").replace('"', '\\"')
    q = f"""PREFIX schema: <http://schema.org/> PREFIX admin: <https://schema.ld.admin.ch/>
    SELECT ?c (GROUP_CONCAT(DISTINCT ?name; separator=" | ") AS ?names) (SAMPLE(?uid) AS ?u) (SAMPLE(?type) AS ?t)
           (SAMPLE(?street) AS ?s) (SAMPLE(?zip) AS ?z) (SAMPLE(?loc) AS ?l) (SAMPLE(?desc) AS ?d) WHERE {{
      ?c a admin:ZefixOrganisation ; schema:name ?name .
      FILTER(STRSTARTS(LCASE(STR(?name)), "{esc}"))
      OPTIONAL {{ ?c schema:identifier ?id . ?id schema:value ?uid ; schema:name "CompanyUID" . }}
      OPTIONAL {{ ?c schema:additionalType ?type }}
      OPTIONAL {{ ?c schema:description ?desc }}
      OPTIONAL {{ ?c schema:address ?a . OPTIONAL {{ ?a schema:streetAddress ?street }}
                 OPTIONAL {{ ?a schema:postalCode ?zip }} OPTIONAL {{ ?a schema:addressLocality ?loc }} }}
    }} GROUP BY ?c LIMIT 200"""
    r = client.post(SPARQL, data={"query": q}, headers={"Accept": "application/sparql-results+json"}, timeout=60)
    return [{k: v["value"] for k, v in b.items()} for b in r.json()["results"]["bindings"]]


def _clean(s):
    """Zefix data contains soft hyphens (U+00AD) and line breaks inside street names."""
    return re.sub(r"\s+", " ", (s or "").replace("­", "")).strip()


def _addr(r):
    street = (r.get("s") or "").splitlines()[-1] if r.get("s") else ""  # drop "c/o ..." first lines
    return _clean(" ".join(filter(None, [street, r.get("z"), r.get("l")])))


IN_LIQUIDATION = re.compile(r"in liquidation|en liquidation|in liquidazione", re.I)


@step
def zefix(name, zip_code=None):
    """EXACT registered name only. not_found → the API returns an error to the user.
    Several entities with that exact name → the building's postcode decides, else ambiguous."""
    target = _norm(name)
    words = name.lower().split()
    prefix = " ".join(words[:-1]) if len(words) > 1 and words[-1] in LEGAL_FORMS else name.lower()
    rows = [r for r in _zefix_rows(prefix) if any(_norm(x) == target for x in r["names"].split(" | "))]
    if not rows:
        return {"status": "not_found", "error": f"No company registered under the exact name '{name}'."}
    if len(rows) > 1:
        same_zip = [r for r in rows if zip_code and r.get("z") == zip_code]
        if len(same_zip) != 1:
            return {"status": "ambiguous", "error": f"{len(rows)} companies named '{name}'",
                    "candidates": [{"names": r["names"], "address": _addr(r)} for r in rows[:5]]}
        rows = same_zip
    b = rows[0]
    uid = b.get("u", "")
    liquidation = bool(IN_LIQUIDATION.search(b["names"]))
    return {
        "status": "partial" if liquidation else "ok",
        "in_liquidation": liquidation,  # Linked Data also lists companies being wound up → warn the underwriter
        "names": b["names"][:150],
        "uid": f"CHE-{uid[3:6]}.{uid[6:9]}.{uid[9:12]}" if len(uid) == 12 else uid or None,
        "legal_form_code": b.get("t", "").rsplit("/", 1)[-1] or None,
        "seat_address": _addr(b),
        "seat_zip_matches_building": bool(zip_code and b.get("z") == zip_code),
        "purpose": (b.get("d") or "")[:200] or None,
    }


# ================================================================ building

@step
def geocode(address):
    address = _clean(address)
    r = client.get(f"{GEO}/ech/SearchServer", params={"searchText": address, "type": "locations", "sr": "2056", "limit": 10})
    results = [x["attrs"] for x in r.json().get("results", []) if x["attrs"].get("origin") == "address"]
    if not results:
        return {"status": "not_found", "error": f"Address not found: '{address}'"}
    m = re.search(r"\b(\d+)[a-zA-Z]?\b(?=[^,]*,)", address)  # house number before the comma
    num = m.group(1) if m else None
    exact = [a for a in results if num and str(a.get("num")) == num]  # 57 ≠ 571 ("57.1")
    best = (exact or results)[0]
    link = next((l["href"] for l in best.get("links", []) if "gebaeude_wohnungs_register" in l["href"]), None)
    return {
        "status": "ok" if exact else "partial",
        "house_number_matched": bool(exact),
        "label": re.sub(r"<[^>]+>", "", best["label"]),
        "e": best["y"], "n": best["x"],  # SearchServer: x = northing, y = easting (!)
        "regbl_feature": link.rsplit("/", 1)[-1] if link else None,
    }


@step
def regbl(feature_id):
    if not feature_id:
        return {"status": "empty"}
    a = client.get(f"{GEO}/ech/MapServer/ch.bfs.gebaeude_wohnungs_register/{feature_id}",
                   params={"returnGeometry": "false"}).json()["feature"]["attributes"]
    f = {k: a.get(k) for k in ["egid", "gdekt", "ggdename", "gkat", "gklas", "gbauj", "gbaup", "gastw", "garea", "gvol", "gebf",
                                "genh1", "gwaerzh1", "gwaerdath1"]}
    key = ["gbauj", "gastw", "garea"]
    filled = sum(f[k] is not None for k in key)
    return {"status": "ok" if filled == 3 else "partial" if filled else "empty", "fields": f,
            "missing": [k for k in key if f[k] is None]}


def _pick(features, e, n, egid, source):
    """features: [(props, Polygon)] → prefer EGID, then polygon containing the point, then nearest."""
    bld = [(p, g) for p, g in features if p.get("Art") == "Gebaeude"]
    for how, cand in (("egid", [x for x in bld if egid and str(x[0].get("GWR_EGID")) == str(egid)]),
                      ("contains_point", [x for x in bld if x[1].contains(Point(e, n))]),
                      ("nearest", sorted(bld, key=lambda x: x[1].distance(Point(e, n)))[:1])):
        if cand:
            g = cand[0][1]
            return {"status": "ok" if how == "egid" else "partial", "source": source, "match": how,
                    "area_m2": round(g.area, 1), "geometry": g.__geo_interface__}
    return {"status": "empty"}


def _gml_polygons(text, layer):
    out = []
    for feat in re.findall(rf"<{layer}_feature>(.*?)</{layer}_feature>", text, re.S):
        body = re.sub(r"<gml:boundedBy>.*?</gml:boundedBy>", "", feat, flags=re.S)
        rings = re.findall(r"<gml:coordinates>([^<]+)</gml:coordinates>", body)
        if rings:
            props = dict(re.findall(r"<(\w+)>([^<]*)</\1>", body))
            out.append((props, Polygon([tuple(map(float, c.split(","))) for c in rings[0].split()])))
    return out


@step
def footprint(e, n, egid, garea=None):
    # 1) WFS (most cantons)
    feats = []
    for _ in range(2):  # geodienste.ch sometimes times out → one retry
        try:
            r = client.get(AV, params={"SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature", "TYPENAMES": "ms:LCSF",
                                       "BBOX": f"{e-30},{n-30},{e+30},{n+30},urn:ogc:def:crs:EPSG::2056", "OUTPUTFORMAT": "geojson"})
            feats = [(f["properties"], shape(f["geometry"])) for f in r.json().get("features", [])]
            break
        except (httpx.HTTPError, ValueError):
            continue
    out = _pick(feats, e, n, egid, "av_wfs")
    if out["status"] != "empty":
        return out
    # 2) WMS GetFeatureInfo GML (cantons with restricted WFS). Address point is often on the wall → probe around.
    feats = []
    for dx, dy in ((0, 0), (12, 0), (-12, 0), (0, 12), (0, -12), (12, 12), (-12, -12), (12, -12), (-12, 12)):
        x, y = e + dx, n + dy
        p = {"SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetFeatureInfo", "LAYERS": "LCSF", "QUERY_LAYERS": "LCSF",
             "CRS": "EPSG:2056", "STYLES": "", "BBOX": f"{x-2},{y-2},{x+2},{y+2}", "WIDTH": 5, "HEIGHT": 5, "I": 2, "J": 2,
             "INFO_FORMAT": "application/vnd.ogc.gml", "FEATURE_COUNT": 5}
        try:
            feats += _gml_polygons(client.get(AV, params=p).text, "LCSF")
        except httpx.HTTPError:  # service down → stop probing, fall through to the SITG cadastre
            break
        if any(egid and str(pr.get("GWR_EGID")) == str(egid) for pr, _ in feats):
            break
    out = _pick(feats, e, n, egid, "av_wms_gml")
    if out["status"] != "empty":
        return out
    # 3) Geneva cadastre (SITG) building polygon by EGID — official too, and independent from geodienste.ch.
    if egid:
        try:
            r = client.get("https://vector.sitg.ge.ch/arcgis/rest/services/CAD_BATIMENT_HORSOL/FeatureServer/0/query",
                           params={"where": f"EGID={int(egid)}", "outFields": "EGID", "returnGeometry": "true", "outSR": 2056,
                                   "f": "geojson"}, timeout=20).json()
            feats = r.get("features") or []
            if feats:
                g = shape(feats[0]["geometry"])
                return {"status": "ok", "source": "sitg_cadastre", "match": "egid", "area_m2": round(g.area, 1),
                        "geometry": g.__geo_interface__}
        except Exception:  # noqa: BLE001
            pass
    # 4) Last resort: square of the RegBL area around the address point.
    if garea:
        g = Point(e, n).buffer(garea ** 0.5 / 2, cap_style=3)
        return {"status": "partial", "source": "approx_square_from_regbl_garea", "area_m2": round(g.area, 1),
                "geometry": g.__geo_interface__}
    return {"status": "empty"}


@step
def height(e, n):
    return {"status": "ok", "altitude_m": float(client.get(f"{GEO}/height", params={"easting": e, "northing": n, "sr": 2056}).json()["height"])}


# ================================================================ hazards

def _gfi_json(layer, e, n, half=5):
    p = {"SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetFeatureInfo", "LAYERS": layer, "QUERY_LAYERS": layer,
         "CRS": "EPSG:2056", "BBOX": f"{e-half},{n-half},{e+half},{n+half}", "WIDTH": 11, "HEIGHT": 11, "I": 5, "J": 5,
         "INFO_FORMAT": "application/json", "FEATURE_COUNT": 5}
    return client.get(WMS, params=p).json().get("features", [])


def _ring_points(g, dist=2.5):
    """Points on a line ~2.5 m outside the walls (works for Polygon and MultiPolygon)."""
    line = g.buffer(dist).boundary
    k = max(12, min(40, int(line.length / 8)))
    return [line.interpolate(i / k, normalized=True).coords[0] for i in range(k)]


def _grid_points(g, target=25):
    x0, y0, x1, y1 = g.bounds
    step_m = max(3.0, ((x1 - x0) * (y1 - y0) / target) ** 0.5)
    pts = [(x0 + (i + .5) * step_m, y0 + (j + .5) * step_m) for i in range(int((x1 - x0) / step_m) + 1)
           for j in range(int((y1 - y0) / step_m) + 1)]
    return [p for p in pts if g.contains(Point(p))] or [g.representative_point().coords[0]]


# Runoff depth is NOT available as data (WMS GetFeatureInfo returns no attribute): it only exists as the map colours.
# → read the rendered map as an IMAGE (no LLM): sample pixels on a line 2.5 m outside the walls, classify by colour.
# Colours measured on the official layer; blue (#00a6ff) = lakes/rivers, ignored.
RUNOFF_CLASSES = {"0-10 cm": (255, 189, 255), "10-25 cm": (223, 115, 255), ">25 cm": (132, 0, 168)}


def runoff_depth_from_map(geom, px_per_m=2):
    from PIL import Image
    g = shape(geom)
    x0, y0, x1, y1 = g.buffer(15).bounds
    w, h = max(64, int((x1 - x0) * px_per_m)), max(64, int((y1 - y0) * px_per_m))
    r = client.get(WMS, params={"SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetMap",
                                "LAYERS": "ch.bafu.gefaehrdungskarte-oberflaechenabfluss", "STYLES": "", "CRS": "EPSG:2056",
                                "BBOX": f"{x0},{y0},{x1},{y1}", "WIDTH": w, "HEIGHT": h, "FORMAT": "image/png", "TRANSPARENT": "TRUE"})
    im = Image.open(io.BytesIO(r.content)).convert("RGBA")
    line = g.buffer(2.5).boundary
    k = max(40, int(line.length))  # ~1 sample per metre of perimeter
    counts = {c: 0 for c in RUNOFF_CLASSES}
    for i in range(k):
        x, y = line.interpolate(i / k, normalized=True).coords[0]
        p = im.getpixel((min(w - 1, int((x - x0) / (x1 - x0) * w)), min(h - 1, int((y1 - y) / (y1 - y0) * h))))
        if p[3] < 128:
            continue
        cls, dist = min(((c, sum((a - b) ** 2 for a, b in zip(p[:3], rgb))) for c, rgb in RUNOFF_CLASSES.items()), key=lambda t: t[1])
        if dist < 3000:  # close enough to a legend colour (rejects water blue / antialiasing)
            counts[cls] += 1
    exposed = {c: round(v / k, 3) for c, v in counts.items() if v}
    worst = next((c for c in reversed(list(RUNOFF_CLASSES)) if counts[c]), None)
    return {"max_depth_class": worst, "perimeter_share_by_depth": exposed, "samples": k,
            "method": "map image read pixel by pixel (no LLM)"}


@step
def hazards_national(e, n, geom):
    out = {}
    seis = _gfi_json("ch.bafu.gefahren-gefaehrdungszonen", e, n)
    out["seismic_zone"] = next((v for f in seis for k, v in f["properties"].items() if "zone" in k.lower()), None)
    soil = _gfi_json("ch.bafu.gefahren-baugrundklassen", e, n)
    out["soil_class"] = next((v for f in soil for v in f["properties"].values() if isinstance(v, str)), None)
    if out["soil_class"] is None:
        out["soil_class_note"] = "not mapped by this canton"
    hail = _gfi_json("ch.meteoschweiz.hagelgefaehrdung-korngroesse_50_jahre", e, n)
    vals = [float(v) for f in hail for v in f["properties"].values() if re.fullmatch(r"\d+(\.\d+)?", str(v))]
    out["hail_50y_cm"] = max(vals) if vals else None  # at a class boundary several values come back → worst case
    if geom:
        # 1 map image instead of ~40 GetFeatureInfo calls, and it also gives the DEPTH class.
        rd = runoff_depth_from_map(geom)
        out["runoff_perimeter_share"] = round(sum(rd["perimeter_share_by_depth"].values()), 3)
        out["runoff_max_depth"] = rd["max_depth_class"]
        out["runoff_share_by_depth"] = rd["perimeter_share_by_depth"]
    core = sum(out.get(k) is not None for k in ["seismic_zone", "hail_50y_cm"])  # soil class optional by design
    return {"status": "ok" if core == 2 else "partial" if core else "empty", **out}


# Per-process layers are filled by every canton (the synoptic layer is NOT: FR, VS leave it empty).
# Note the typo in the official layer name "gefahrengebiet_ruschtung".
PROCESS_LAYERS = {"flood": "gefahrengebiet_wasser", "landslide": "gefahrengebiet_ruschtung",
                  "rockfall": "gefahrengebiet_sturz", "avalanche": "gefahrengebiet_lawine"}
LEVELS = ["nicht_gefaehrdet", "restgefaehrdung", "gering", "mittel", "erheblich"]


def _lvl(v):
    v = (v or "").lower()
    return LEVELS.index(v) if v in LEVELS else -1


def _wfs_features(typename, bbox):
    x0, y0, x1, y1 = bbox
    r = client.get(HAZ, params={"SERVICE": "WFS", "VERSION": "2.0.0", "REQUEST": "GetFeature", "TYPENAMES": f"ms:{typename}",
                                "BBOX": f"{x0},{y0},{x1},{y1},urn:ogc:def:crs:EPSG::2056", "OUTPUTFORMAT": "geojson"})
    try:
        return r.json().get("features", [])
    except ValueError:
        return None  # WFS refused (restricted canton) → caller falls back to WMS


def _wms_level(layer, x, y):
    p = {"SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetFeatureInfo", "LAYERS": layer, "QUERY_LAYERS": layer,
         "CRS": "EPSG:2056", "STYLES": "", "BBOX": f"{x-1},{y-1},{x+1},{y+1}", "WIDTH": 3, "HEIGHT": 3, "I": 1, "J": 1,
         "INFO_FORMAT": "text/plain", "FEATURE_COUNT": 5}
    vals = re.findall(r"(?i)gefahrenstufe\s*=\s*'([^']*)'", client.get(HAZ, params=p).text)
    return max(vals, key=_lvl) if vals else None


@step
def hazards_cantonal(geom, canton):
    """Per process: worst level touching the footprint + share of the footprint at that level."""
    if canton in NO_CANTONAL_HAZARD_MAP:
        return {"status": "empty", "note": f"{canton} does not publish its hazard map on geodienste.ch"}
    if not geom:
        return {"status": "empty", "note": "no footprint"}
    g = shape(geom)
    bbox = g.buffer(20).bounds
    out, source = {}, "wfs"
    feats = {k: _wfs_features(layer, bbox) for k, layer in PROCESS_LAYERS.items()}
    if all(v is None or v == [] for v in feats.values()):
        # 1) nothing via WFS → 2) WMS GetFeatureInfo sampled on a grid inside the footprint
        source, pts = "wms_sampled", _grid_points(g)
        for k, layer in PROCESS_LAYERS.items():
            with ThreadPoolExecutor(8) as ex:
                levels = [lv for lv in ex.map(lambda p: _wms_level(layer, *p), pts) if lv]
            if levels:
                worst = max(levels, key=_lvl)
                out[k] = {"level": worst, "share": round(levels.count(worst) / len(pts), 3)}
    else:
        for k, fs in feats.items():
            hits = [(f["properties"].get("gefahrenstufe"), shape(f["geometry"]).intersection(g).area) for f in fs or []]
            hits = [(lv, a) for lv, a in hits if a > 0]
            if hits:
                worst = max((lv for lv, _ in hits), key=_lvl)
                out[k] = {"level": worst, "share": round(sum(a for lv, a in hits if lv == worst) / g.area, 3)}
    if out:
        return {"status": "ok", "source": source, "processes": out}
    # Empty on the footprint: is it "outside every hazard zone" (= information) or "no data here"?
    # → look for any flood/landslide zone within 1 km. Zones nearby ⇒ the area is mapped ⇒ building not exposed.
    ctx = g.buffer(1000).bounds
    nearby = any(_wfs_features(PROCESS_LAYERS[k], ctx) for k in ("flood", "landslide"))
    if not nearby:  # WFS may be restricted → probe the WMS on a coarse grid around the building
        cx, cy = g.centroid.x, g.centroid.y
        grid = [(cx + dx, cy + dy) for dx in (-600, -200, 200, 600) for dy in (-600, -200, 200, 600)]
        with ThreadPoolExecutor(8) as ex:
            nearby = any(ex.map(lambda p: _wms_level(PROCESS_LAYERS["flood"], *p), grid)) or \
                     any(ex.map(lambda p: _wms_level(PROCESS_LAYERS["landslide"], *p), grid))
    if nearby:
        return {"status": "ok", "source": source, "processes": {},
                "note": "mapped area, footprint outside every hazard zone (no known hazard)"}
    return {"status": "empty", "source": source, "note": "no hazard-map data around this location"}


_prtr = None


@step
def swissprtr(e, n, radius=1000):
    global _prtr
    if _prtr is None:
        items = client.get(f"{STAC}/ch.bafu.swissprtr/items").json()["features"]
        href = next(a["href"] for f in items for k, a in f["assets"].items() if k.endswith("gpkg.zip"))
        z = zipfile.ZipFile(io.BytesIO(client.get(href).content))
        p = Path(tempfile.mkdtemp()) / "prtr.gpkg"
        p.write_bytes(z.read(next(x for x in z.namelist() if x.endswith(".gpkg"))))
        _prtr = sqlite3.connect(p).execute("SELECT Betrieb, Ort, Ostkoordin, Nordkoordi FROM swissprtr").fetchall()
    near = sorted({(b, o, round(((x - e) ** 2 + (y - n) ** 2) ** 0.5)) for b, o, x, y in _prtr
                   if x and y and ((x - e) ** 2 + (y - n) ** 2) ** 0.5 <= radius}, key=lambda t: t[2])
    return {"status": "ok", "within_m": radius, "nearby": [{"site": b, "place": o, "distance_m": d} for b, o, d in near[:5]]}


# ================================================================ image

@step
def swissimage(geom, e, n, out_dir, px=768):
    g = shape(geom) if geom else Point(e, n).buffer(40)
    x0, y0, x1, y1 = g.buffer(10).bounds
    s = max(x1 - x0, y1 - y0)
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    bb = (cx - s / 2, cy - s / 2, cx + s / 2, cy + s / 2)
    r = client.get(WMS, params={"SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetMap", "LAYERS": "ch.swisstopo.swissimage",
                                "STYLES": "", "CRS": "EPSG:2056", "BBOX": ",".join(map(str, bb)), "WIDTH": px, "HEIGHT": px,
                                "FORMAT": "image/jpeg"})
    if not r.headers.get("content-type", "").startswith("image/"):
        return {"status": "error", "error": r.text[:200]}
    from PIL import Image, ImageDraw
    im = Image.open(io.BytesIO(r.content)).convert("RGB")
    if geom:  # red outline = tells the vision model WHICH building to describe
        for poly in getattr(g, "geoms", [g]):  # Polygon or MultiPolygon
            pts = [((x - bb[0]) / s * px, (bb[3] - y) / s * px) for x, y in poly.exterior.coords]
            ImageDraw.Draw(im).line(pts + [pts[0]], fill=(255, 0, 0), width=3)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=85)
    out = {"status": "ok", "bytes": buf.tell(), "m_per_px": round(s / px, 3), "side_m": round(s),
           "attribution": "© swisstopo (SWISSIMAGE)", "jpeg": buf.getvalue()}
    if out_dir:
        (Path(out_dir) / "ortho.jpg").write_bytes(out["jpeg"])
        out["file"] = str(Path(out_dir) / "ortho.jpg")
    return out


# ================================================================ main

def strip_binary(obj):
    """Replace bytes (images) by a short marker so the result can be dumped as JSON."""
    if isinstance(obj, bytes):
        return f"<{len(obj)} bytes>"
    if isinstance(obj, dict):
        return {k: strip_binary(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [strip_binary(v) for v in obj]
    return obj


def probe(company, address, out_root="probe_out"):
    """Collect every public source. out_root=None → nothing written to disk (Vercel)."""
    out_dir = None
    if out_root:
        out_dir = Path(out_root) / re.sub(r"[^a-z0-9]+", "-", company.lower()).strip("-")
        out_dir.mkdir(parents=True, exist_ok=True)
    t0 = time.perf_counter()
    res = {"company": company, "address": address}
    m = re.search(r"\b(\d{4})\b", address.split(",")[-1])
    zip_code = m.group(1) if m else None

    with ThreadPoolExecutor(2) as ex:  # company and building are resolved in parallel
        fz, fg = ex.submit(zefix, company, zip_code), ex.submit(geocode, address)
        res["zefix"], res["geocode"] = fz.result(), fg.result()

    # Hard stops: the user gets an error instead of a report on the wrong company / building.
    for k in ("zefix", "geocode"):
        if res[k]["status"] in ("not_found", "ambiguous", "error"):
            res["error"] = res[k].get("error")
            res["error_kind"] = "service" if res[k]["status"] == "error" else "input"
            res["total_ms"] = int((time.perf_counter() - t0) * 1000)
            return res, out_dir

    e, n = res["geocode"]["e"], res["geocode"]["n"]
    res["regbl"] = regbl(res["geocode"]["regbl_feature"])
    f = res["regbl"].get("fields", {})
    res["footprint"] = footprint(e, n, f.get("egid"), f.get("garea"))
    geom = res["footprint"].get("geometry")
    canton = f.get("gdekt")

    with ThreadPoolExecutor(5) as ex:  # enrichment branches in parallel
        jobs = {"height": ex.submit(height, e, n), "hazards_national": ex.submit(hazards_national, e, n, geom),
                "hazards_cantonal": ex.submit(hazards_cantonal, geom, canton), "swissprtr": ex.submit(swissprtr, e, n),
                "swissimage": ex.submit(swissimage, geom, e, n, out_dir)}
        for k, fut in jobs.items():
            res[k] = fut.result()

    res["cantonal_insurance_regime"] = ("private_market" if canton in PRIVATE_MARKET_CANTONS else "cantonal_monopoly") if canton else "unknown"
    res["total_ms"] = int((time.perf_counter() - t0) * 1000)
    return res, out_dir


STEPS = ["zefix", "geocode", "regbl", "footprint", "height", "hazards_national", "hazards_cantonal", "swissprtr", "swissimage"]


def summary(res):
    lines = [f"\n=== {res['company']} — {res['address']}  ({res.get('total_ms')} ms)"]
    if res.get("error"):
        lines.append(f"  ERROR → {res['error']}")
    for k in STEPS:
        v = res.get(k)
        if v:
            d = {kk: vv for kk, vv in strip_binary(v).items() if kk not in ("status", "ms", "geometry", "file", "jpeg")}
            lines.append(f"  [{v['status']:>9}] {k:<16} {json.dumps(d, ensure_ascii=False)[:220]}")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("company")
    ap.add_argument("address")
    ap.add_argument("--out", default="probe_out")
    a = ap.parse_args()
    res, out_dir = probe(a.company, a.address, a.out)
    (out_dir / "result.json").write_text(json.dumps(strip_binary(res), ensure_ascii=False, indent=2), encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    print(summary(res))


if __name__ == "__main__":
    main()
