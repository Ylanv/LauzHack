"""Official building footprint for the map animation: address -> EGID -> cadastre polygon, in WGS84 (lon/lat).

Same source as the red outline of the report's orthophoto (public_data.footprint: AV via geodienste.ch matched by EGID,
then the Geneva cadastre by EGID), so the web app frames the insured building and never a neighbour. Public data only:
no LLM, no credits.
"""
from functools import lru_cache

from shapely.geometry import mapping, shape
from shapely.ops import transform

from src import public_data as pd


def lv95_to_wgs84(e: float, n: float) -> tuple[float, float]:
    """swisstopo approximate formulas (about 1 m accuracy): LV95 (E, N) -> (lon, lat)."""
    y, x = (e - 2600000) / 1e6, (n - 1200000) / 1e6
    lon = 2.6779094 + 4.728982 * y + 0.791484 * y * x + 0.1306 * y * x ** 2 - 0.0436 * y ** 3
    lat = 16.9023892 + 3.238272 * x - 0.270978 * y ** 2 - 0.002528 * x ** 2 - 0.0447 * y ** 2 * x - 0.0140 * x ** 3
    return lon * 100 / 36, lat * 100 / 36


@lru_cache(maxsize=256)
def building_footprint(address: str) -> dict | None:
    """GeoJSON polygon (WGS84) of the building at this address, or None when it cannot be pinned to one building."""
    geo = pd.geocode(address)
    if geo.get("status") != "ok" or not geo.get("house_number_matched"):
        return None   # never frame a neighbour: an unmatched house number gives no footprint
    fields = pd.regbl(geo.get("regbl_feature")).get("fields") or {}
    fp = pd.footprint(geo["e"], geo["n"], fields.get("egid"), fields.get("garea"))
    if fp.get("status") not in ("ok", "partial") or not fp.get("geometry"):
        return None
    if fp.get("match") == "nearest" or fp.get("source") == "approx_square_from_regbl_garea":
        return None   # a guess is worse than the vector-tile fallback
    g = transform(lambda e, n, z=None: lv95_to_wgs84(e, n), shape(fp["geometry"]))
    return {"geometry": mapping(g), "source": fp.get("source"), "match": fp.get("match"), "area_m2": fp.get("area_m2")}
