// Light, palette-coloured map style (no photos): the world from Natural Earth outlines, Switzerland from the swisstopo
// vector basemap. Satellite imagery (SWISSIMAGE) only fades in for the last metres, so the building itself is clear.
import geo from "../data/geo.json"

type Ring = number[]   // flat [lon, lat, lon, lat, ...]
const ringCoords = (r: Ring) => {
  let jump = false
  for (let i = 2; i < r.length; i += 2) if (Math.abs(r[i] - r[i - 2]) > 180) jump = true
  const out: number[][] = []
  for (let i = 0; i < r.length; i += 2) out.push([jump && r[i] < -100 ? r[i] + 360 : r[i], r[i + 1]])
  const a = out[0], z = out[out.length - 1]
  if (a[0] !== z[0] || a[1] !== z[1]) out.push([a[0], a[1]])
  return out
}
const polys = (rings: Ring[]) => ({ type: "FeatureCollection", features: rings.map((r) => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ringCoords(r)] } })) })
const lines = (ls: Ring[]) => ({ type: "FeatureCollection", features: ls.map((r) => { const c = []; for (let i = 0; i < r.length; i += 2) c.push([r[i], r[i + 1]]); return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: c } } }) })

const g = geo as any
// drop Antarctica (its outline wraps the whole map and is not needed here)
const land = (g.land as Ring[]).filter((r) => { let mn = 90; for (let i = 1; i < r.length; i += 2) mn = Math.min(mn, r[i]); return mn > -60 })

const OCEAN = "#cdd7f2", LAND = "#f7f5fb", EDGE = "#adbbda", INDIGO = "#3d52a0", MIST = "#c9d1ec", ROAD_CASING = "#c3cce8"
const z = (...stops: (number | string)[]) => ["interpolate", ["linear"], ["zoom"], ...stops]

export const buildStyle = (): any => styleObject()

function styleObject(): any {
  return {
    version: 8,
    projection: { type: "globe" },
    sky: { "sky-color": "#adbbda", "horizon-color": "#ede8f5", "fog-color": "#ede8f5", "atmosphere-blend": z(0, 1, 7, 1, 11, 0) },
    sources: {
      land: { type: "geojson", data: polys(land) },
      eu: { type: "geojson", data: polys(g.eu as Ring[]) },
      ch: { type: "geojson", data: polys(g.ch as Ring[]) },
      cantons: { type: "geojson", data: lines((g.cantons as { r: Ring[] }[]).flatMap((c) => c.r)) },
      borders: { type: "geojson", data: lines(g.borders as Ring[]) },
      vt: { type: "vector", url: "https://vectortiles.geo.admin.ch/tiles/ch.swisstopo.base.vt/v1.0.0/tiles.json", attribution: "© swisstopo" },
      swiss: { type: "raster", tileSize: 256, maxzoom: 19, bounds: [5.9, 45.7, 10.6, 47.9], tiles: ["https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/{z}/{x}/{y}.jpeg"], attribution: "© swisstopo" },
    },
    layers: [
      { id: "ocean", type: "background", paint: { "background-color": OCEAN } },
      // the world
      { id: "land", type: "fill", source: "land", paint: { "fill-color": LAND, "fill-outline-color": EDGE } },
      { id: "eu", type: "fill", source: "eu", paint: { "fill-color": LAND, "fill-outline-color": EDGE } },
      { id: "borders", type: "line", source: "borders", paint: { "line-color": EDGE, "line-width": z(2, 0.4, 8, 1), "line-opacity": z(3, 0, 5, 0.8, 9, 0.8, 11, 0) } },
      { id: "ch-fill", type: "fill", source: "ch", paint: { "fill-color": INDIGO, "fill-opacity": z(3, 0.0, 5, 0.2, 9, 0.12, 11, 0) } },
      { id: "ch-line", type: "line", source: "ch", paint: { "line-color": INDIGO, "line-width": z(3, 0.8, 8, 1.6), "line-opacity": z(3, 0, 5, 0.8, 9, 0.7, 11, 0) } },
      { id: "cantons", type: "line", source: "cantons", paint: { "line-color": "#8697c4", "line-width": 0.8, "line-opacity": z(5, 0, 6.5, 0.7, 10, 0.5, 11.5, 0) } },
      // Switzerland in detail: swisstopo vector basemap restyled in the app palette
      { id: "v-water", type: "fill", source: "vt", "source-layer": "water", minzoom: 6, paint: { "fill-color": OCEAN, "fill-opacity": z(6, 0, 7.5, 1) } },
      { id: "v-landcover", type: "fill", source: "vt", "source-layer": "landcover", minzoom: 8, filter: ["in", "subclass", "forest", "woody_plant", "park", "scrub", "glacier"], paint: { "fill-color": ["match", ["get", "subclass"], "glacier", "#ffffff", "#e1e5f4"], "fill-opacity": z(8, 0, 10, 1) } },
      { id: "v-waterway", type: "line", source: "vt", "source-layer": "waterway", minzoom: 8, filter: ["!in", "class", "riverbank", "shoreline", "shoreline_changing_level"], paint: { "line-color": "#b4c3ea", "line-width": z(8, 0.6, 14, 2.5, 17, 6), "line-opacity": z(8, 0, 10, 1) } },
      { id: "v-rail", type: "line", source: "vt", "source-layer": "transportation", minzoom: 12, filter: ["==", "class", "rail"], paint: { "line-color": EDGE, "line-width": z(12, 0.6, 17, 2), "line-dasharray": [3, 3], "line-opacity": z(12, 0, 14, 1) } },
      { id: "v-road-casing", type: "line", source: "vt", "source-layer": "transportation", minzoom: 9, filter: ["in", "class", "motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": ROAD_CASING, "line-width": ["interpolate", ["linear"], ["zoom"], 9, ["match", ["get", "class"], ["motorway", "trunk", "primary"], 1.6, 0], 13, ["match", ["get", "class"], ["motorway", "trunk", "primary"], 5, ["secondary", "tertiary"], 3.5, 1.6], 17, ["match", ["get", "class"], ["motorway", "trunk", "primary"], 18, ["secondary", "tertiary"], 13, 8]], "line-opacity": z(9, 0, 11, 1) } },
      { id: "v-road", type: "line", source: "vt", "source-layer": "transportation", minzoom: 9, filter: ["in", "class", "motorway", "trunk", "primary", "secondary", "tertiary", "minor", "service"], layout: { "line-cap": "round", "line-join": "round" }, paint: { "line-color": "#ffffff", "line-width": ["interpolate", ["linear"], ["zoom"], 9, ["match", ["get", "class"], ["motorway", "trunk", "primary"], 0.8, 0], 13, ["match", ["get", "class"], ["motorway", "trunk", "primary"], 3.2, ["secondary", "tertiary"], 2, 0.8], 17, ["match", ["get", "class"], ["motorway", "trunk", "primary"], 14, ["secondary", "tertiary"], 10, 6]], "line-opacity": z(9, 0, 11, 1) } },
      { id: "v-building", type: "fill", source: "vt", "source-layer": "building", minzoom: 13, filter: ["!in", "class", "covered_bridge", "underground", "coverage"], paint: { "fill-color": MIST, "fill-outline-color": "#9aa9d6", "fill-opacity": z(13, 0, 14.2, 1) } },
      // satellite only for the last metres
      { id: "swiss", type: "raster", source: "swiss", minzoom: 13, paint: { "raster-opacity": z(14.8, 0, 16.6, 1), "raster-fade-duration": 0 } },
      // invisible layers: they only make the vector tiles load for the surroundings analysis (from zoom 13)
      { id: "q-water", type: "fill", source: "vt", "source-layer": "water", minzoom: 13, paint: { "fill-opacity": 0 } },
      { id: "q-waterway", type: "line", source: "vt", "source-layer": "waterway", minzoom: 13, paint: { "line-opacity": 0 } },
      { id: "q-wood", type: "fill", source: "vt", "source-layer": "landcover", minzoom: 13, filter: ["==", "subclass", "forest"], paint: { "fill-opacity": 0 } },
      { id: "q-road", type: "line", source: "vt", "source-layer": "transportation", minzoom: 13, filter: ["in", "class", "motorway", "trunk", "primary", "secondary", "tertiary"], paint: { "line-opacity": 0 } },
      { id: "q-bld", type: "fill", source: "vt", "source-layer": "building", minzoom: 13, paint: { "fill-opacity": 0 } },
    ],
  }
}
