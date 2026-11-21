"""Facade photo from Google Street View Static API (hackathon DEMO) → vision → construction material.

Legal note (state it in the pitch): Google Maps Platform terms are restrictive on deriving data from Street View
imagery with AI. Demo use only: 1 image per report, not stored beyond the report, attribution shown, nothing
trained. In production: licensed street-level imagery or a facade photo provided by the client.

Flow: metadata (free: is there an outdoor panorama near the building?) → heading from the camera to the
building centroid → 640x640 image.
"""

import math

import httpx
from shapely.geometry import shape

from src import config

META = "https://maps.googleapis.com/maps/api/streetview/metadata"
IMG = "https://maps.googleapis.com/maps/api/streetview"
_client = httpx.Client(timeout=20)


def available() -> bool:
    return bool(config.GOOGLE_MAPS_API_KEY)


def _lv95_to_wgs84(e, n):
    r = _client.get("https://geodesy.geo.admin.ch/reframe/lv95towgs84",
                    params={"easting": e, "northing": n, "format": "json"}).json()
    return float(r["northing"]), float(r["easting"])  # lat, lon


def _bearing(lat1, lon1, lat2, lon2):
    dlon = math.radians(lon2 - lon1)
    p1, p2 = math.radians(lat1), math.radians(lat2)
    y = math.sin(dlon) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dlon)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def _dist_m(lat1, lon1, lat2, lon2):
    return math.hypot((lon2 - lon1) * math.cos(math.radians(lat1)) * 111320, (lat2 - lat1) * 110540)


def facade_photo(footprint_geojson, radius_m=80) -> dict:
    """{"status": ok|empty|skipped|error, "jpeg"?, "camera"?, "note"?} — never raises."""
    if not available():
        return {"status": "skipped", "note": "no GOOGLE_MAPS_API_KEY"}
    if not footprint_geojson:
        return {"status": "empty", "note": "no footprint"}
    try:
        c = shape(footprint_geojson).centroid
        lat, lon = _lv95_to_wgs84(c.x, c.y)
        key = config.GOOGLE_MAPS_API_KEY
        m = _client.get(META, params={"location": f"{lat},{lon}", "radius": radius_m, "source": "outdoor", "key": key}).json()
        if m.get("status") != "OK":
            return {"status": "empty" if m.get("status") == "ZERO_RESULTS" else "error",
                    "note": f"Street View metadata: {m.get('status')} {m.get('error_message', '')}".strip()}
        if "google" not in (m.get("copyright") or "").lower():
            return {"status": "empty", "note": f"nearest panorama is third-party ({m.get('copyright')}), often indoor -> skipped"}
        plat, plon = m["location"]["lat"], m["location"]["lng"]
        heading, dist = _bearing(plat, plon, lat, lon), _dist_m(plat, plon, lat, lon)
        r = _client.get(IMG, params={"pano": m["pano_id"], "size": "640x640", "heading": round(heading), "pitch": 5,
                                     "fov": 90 if dist < 40 else 70, "source": "outdoor", "key": key})
        if r.status_code != 200 or not r.headers.get("content-type", "").startswith("image/"):
            return {"status": "error", "note": f"image request failed ({r.status_code}) {r.text[:120]}"}
        return {"status": "ok", "jpeg": r.content, "credit": "© Google Street View (demo)",
                "camera": {"date": m.get("date"), "distance_m": round(dist), "heading_deg": round(heading)}}
    except Exception as e:  # noqa: BLE001 — optional source, never break the pipeline
        return {"status": "error", "note": f"{type(e).__name__}: {str(e)[:120]}"}
