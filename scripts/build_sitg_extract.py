"""Build the bundled SITG extract for Geneva activity buildings (run from a machine SITG accepts — NOT from Vercel).

    python scripts/build_sitg_extract.py            # → data/sitg_ge_extract.json.gz

Why: vector.sitg.ge.ch resets connections from cloud IPs (Vercel/AWS). The pipeline reads this file first and only
queries SITG live for buildings that are not in it. Data is frozen at the generation date (stored in the file).

Content, keyed by EGID (buildings classified "Activité" in the Geneva cadastre), in the SAME attribute format as the
live ArcGIS queries, so geneva.py processes both identically:
  horsol, toit, idc, boilers (by EGID) · permits, polluted_sites, establishments (spatial join on the footprint)
plus establishments_by_uid for the company lookup.
"""

import gzip
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx
from shapely import STRtree
from shapely.geometry import Point, Polygon

SITG = "https://vector.sitg.ge.ch/arcgis/rest/services"
OUT = Path(__file__).resolve().parent.parent / "data" / "sitg_ge_extract.json.gz"
client = httpx.Client(timeout=120, headers={"User-Agent": "axa-smart-property/0.1", "Accept": "application/json"})

HORSOL_FIELDS = ("EGID,DESTINATION,NOMEN_CLASSE,EPOQUE_CONSTRUCTION,ANNEE_CONSTRUCTION,ANNEE_TRANSFORNATION,"
                 "NIVEAUX_HORSOL,NIVEAUX_SSOL,HAUTEUR,SURFACE")
REG_FIELDS = "NOM,RAISON_SOCIALE,NUM_IDE,CODE_NOGA,BRANCHE,ACTIVITE_DETAIL,TAILLE,SITE_INTERNET,ADRESSE"


def fetch_all(service, where="1=1", fields="*", geometry=False, page=4000):
    """All features of a layer (ArcGIS pagination)."""
    out, offset = [], 0
    while True:
        for attempt in range(3):
            try:
                r = client.get(f"{SITG}/{service}/FeatureServer/0/query", params={
                    "where": where, "outFields": fields, "returnGeometry": str(geometry).lower(), "outSR": 2056,
                    "orderByFields": "OBJECTID", "resultOffset": offset, "resultRecordCount": page, "f": "json"})
                r.raise_for_status()
                feats = r.json()["features"]
                break
            except Exception as e:  # noqa: BLE001
                if attempt == 2:
                    raise
                print(f"  retry {service} @{offset}: {e}")
                time.sleep(2)
        out += feats
        print(f"  {service}: {len(out)}", end="\r")
        if len(feats) < page:
            print()
            return out
        offset += page


def polygon(geom):
    rings = (geom or {}).get("rings")
    return Polygon(rings[0]).buffer(0) if rings else None


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    t0 = time.time()
    print("1/7 activity buildings")
    bld = fetch_all("CAD_BATIMENT_HORSOL", "NOMEN_CLASSE='Activité' AND EGID IS NOT NULL", HORSOL_FIELDS, geometry=True)
    shapes, egids, data = [], [], {}
    for f in bld:
        a, g = f["attributes"], polygon(f.get("geometry"))
        egid = str(int(a["EGID"]))
        if g is None or egid in data:
            continue
        data[egid] = {"horsol": [a], "toit": [], "idc": [], "boilers": [], "permits": [], "polluted_sites": [], "establishments": []}
        shapes.append(g)
        egids.append(egid)
    tree = STRtree(shapes)
    print(f"   {len(data)} buildings")

    def by_egid(service, fields, key):
        for f in fetch_all(service, "EGID IS NOT NULL", fields):
            e = str(int(f["attributes"]["EGID"]))
            if e in data:
                data[e][key].append(f["attributes"])

    print("2/7 roof slopes")
    by_egid("CAD_BATI3D_BASIC_TOIT", "EGID,PENTE_MIN,PENTE_MAX,PENTE_MOY", "toit")
    print("3/7 energy index")
    by_egid("OCEN_ETAT_IDC_PUBLIC", "EGID,SRE_M2,DERNIER_IDC,ANNEE_DERNIER_IDC,ETAT_IDC_GEN", "idc")
    print("4/7 boilers")
    by_egid("SCANE_CHAUDIERE", "*", "boilers")

    def join_points(service, fields, key, buffer_m=0.0):
        n = 0
        for f in fetch_all(service, "1=1", fields, geometry=True):
            g = f.get("geometry") or {}
            if "x" not in g:
                continue
            p = Point(g["x"], g["y"])
            for i in tree.query(p.buffer(buffer_m) if buffer_m else p):
                if (shapes[i].buffer(buffer_m) if buffer_m else shapes[i]).intersects(p):
                    data[egids[i]][key].append(f["attributes"])
                    n += 1
        print(f"   {n} {key} attached")

    print("5/7 building permits (spatial join)")
    join_points("SIT_AUTOR_DOSSIER", "TYPE_DOSSIER,DATE_DEPOT,STATUT,DESCRIPTION", "permits")
    print("6/7 establishments (spatial join, +5 m)")
    join_points("REG_ENTREPRISE_ETABLISSEMENT", REG_FIELDS, "establishments", buffer_m=5)
    print("7/7 polluted sites (spatial join)")
    n = 0
    for f in fetch_all("GOL_SITES_POLLUES", "1=1",
                       "TYPE_ACTIVITE_OU_TYPE_REMBLAI,LIBELLE_NOGA,TYPE_SITE,TYPE_POLLUANT,RAISON_SOCIALE", geometry=True):
        g = polygon(f.get("geometry"))
        if g is None:
            continue
        for i in tree.query(g):
            if shapes[i].intersects(g):
                data[egids[i]]["polluted_sites"].append(f["attributes"])
                n += 1
    print(f"   {n} polluted-site links")

    by_uid = {}
    for b in data.values():
        for a in b["establishments"]:
            if a.get("NUM_IDE"):
                by_uid.setdefault(a["NUM_IDE"], a)
    doc = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "source": "SITG (vector.sitg.ge.ch)",
           "scope": "Geneva cadastre buildings classified 'Activité'", "buildings": data, "establishments_by_uid": by_uid}
    OUT.parent.mkdir(exist_ok=True)
    raw = json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode()
    OUT.write_bytes(gzip.compress(raw, 9))
    print(f"→ {OUT}  {len(data)} buildings, {len(by_uid)} companies · raw {len(raw) / 1e6:.1f} MB, "
          f"gz {OUT.stat().st_size / 1e6:.1f} MB · {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()
