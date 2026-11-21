// Insurance-relevant surroundings of an address, read from the swisstopo vector basemap (OpenMapTiles schema).
// No model and no tokens: plain geometry on features the map has already downloaded. Distances are in metres with a
// flat-earth approximation (good to a few metres at building scale).
const clampF = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
export type LL = [number, number]
export interface Feat { kind: "building" | "neighbour" | "road" | "water" | "forest"; d: number; name: string; geom: any; at: LL; t0: number }
/** q(layer, filter): the vector features of one source layer (MapLibre's querySourceFeatures, or decoded tiles in a test). */
export type Query = (layer: string, filter?: any[]) => any[]

const MAX = { neighbour: 80, road: 700, water: 900, forest: 600 }   // metres: beyond this it is not worth showing

export function analyseSurroundings(b: { lon: number; lat: number }, q: Query): { out: Feat[]; hasOwn: boolean } {
  const kx = 111320 * Math.cos((b.lat * Math.PI) / 180), ky = 110574
  const toM = (p: number[]) => [(p[0] - b.lon) * kx, (p[1] - b.lat) * ky]

  /** distance from the address to a geometry, the closest point on it, and whether the address is inside it (polygons) */
  function metrics(geom: any): { d: number; at: LL; inside: boolean } {
    let best = { d: Infinity, at: [b.lon, b.lat] as LL }, inside = false
    const lines: number[][][] = [], polys: number[][][][] = []
    if (geom.type === "Polygon") polys.push(geom.coordinates)
    else if (geom.type === "MultiPolygon") polys.push(...geom.coordinates)
    else if (geom.type === "LineString") lines.push(geom.coordinates)
    else if (geom.type === "MultiLineString") lines.push(...geom.coordinates)
    const edges = (pts: number[][]) => {
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = toM(pts[i]), c = toM(pts[i + 1]), dx = c[0] - a[0], dy = c[1] - a[1], l2 = dx * dx + dy * dy
        const t = l2 ? clampF(-(a[0] * dx + a[1] * dy) / l2, 0, 1) : 0, px = a[0] + t * dx, py = a[1] + t * dy, d = Math.hypot(px, py)
        if (d < best.d) best = { d, at: [b.lon + px / kx, b.lat + py / ky] }
      }
    }
    lines.forEach(edges)
    polys.forEach((rings) => {
      rings.forEach(edges)
      const o = rings[0].map(toM)
      let ins = false
      for (let i = 0, j = o.length - 1; i < o.length; j = i++) {
        if (o[i][1] > 0 !== o[j][1] > 0 && 0 < ((o[j][0] - o[i][0]) * (0 - o[i][1])) / (o[j][1] - o[i][1]) + o[i][0]) ins = !ins
      }
      if (ins) inside = true
    })
    return inside ? { d: 0, at: [b.lon, b.lat], inside: true } : { ...best, inside: false }
  }

  const nearest = (fs: any[], max: number) => {
    let r: { f: any; d: number; at: LL } | null = null
    for (const f of fs) { const g = metrics(f.geometry); if (g.d <= max && (!r || g.d < r.d)) r = { f, d: g.d, at: g.at } }
    return r
  }
  const name = (f: any, fallback: string) => f.properties?.name || f.properties?.["name:latin"] || fallback
  const out: Feat[] = []

  // the footprint that contains the address, and the nearest other building
  let own: { geom: any; at: LL } | null = null
  const others: any[] = []
  for (const f of q("building")) {
    if (!f.geometry || !f.geometry.type.includes("Polygon")) continue
    const g = metrics(f.geometry)
    if (g.inside && !own) own = { geom: f.geometry, at: g.at }
    else others.push(f)
  }
  if (own) out.push({ kind: "building", d: 0, name: "", geom: own.geom, at: own.at, t0: -1 })
  const ownKey = own ? JSON.stringify(own.geom) : ""
  const nb = nearest(others.filter((f) => JSON.stringify(f.geometry) !== ownKey), MAX.neighbour)
  if (nb) out.push({ kind: "neighbour", d: nb.d, name: "", geom: nb.f.geometry, at: nb.at, t0: -1 })

  const road = nearest(q("transportation", ["in", "class", "motorway", "trunk", "primary", "secondary", "tertiary"]).filter((f) => f.geometry?.type?.includes("LineString")), MAX.road)
  if (road) out.push({ kind: "road", d: road.d, name: name(road.f, ""), geom: road.f.geometry, at: road.at, t0: -1 })

  const water = nearest([...q("water", ["!=", "class", "pool"]), ...q("waterway", ["in", "class", "river", "canal", "stream"])].filter((f) => f.geometry), MAX.water)
  if (water) out.push({ kind: "water", d: water.d, name: name(water.f, ({ river: "River", lake: "Lake", stream: "Stream", canal: "Canal" } as Record<string, string>)[water.f.properties?.class] || "Water"), geom: water.f.geometry, at: water.at, t0: -1 })

  const wood = nearest(q("landcover", ["==", "subclass", "forest"]).filter((f) => f.geometry), MAX.forest)
  if (wood) out.push({ kind: "forest", d: wood.d, name: "", geom: wood.f.geometry, at: wood.at, t0: -1 })
  return { out, hasOwn: !!own }
}
