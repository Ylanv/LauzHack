// Insurance-relevant surroundings of an address, read from the swisstopo vector basemap (OpenMapTiles schema).
// No model and no tokens: plain geometry on features the map has already downloaded. Distances are in metres with a
// flat-earth approximation (good to a few metres at building scale).
const clampF = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
export type LL = [number, number]
export interface Feat { kind: "building" | "neighbour" | "road" | "water" | "forest"; d: number; name: string; geom: any; at: LL; t0: number }
/** q(layer, filter): the vector features of one source layer (MapLibre's querySourceFeatures, or decoded tiles in a test). */
export type Query = (layer: string, filter?: any[]) => any[]

const MAX = { neighbour: 50, road: 250, water: 300, forest: 200 }   // metres: beyond this it is not worth showing
const KEEP = 300   // metres: how much of a road / river is drawn around the address

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
  /** Vector tiles cut a road into pieces (per tile, per junction): gather every piece of the same road (same name, or
   *  connected to it end to end with the same class) within KEEP metres, so the whole stretch is framed, not one fragment. */
  function wholeLine(seed: any, all: any[]) {
    const lines = (f: any): number[][][] => (f.geometry.type === "LineString" ? [f.geometry.coordinates] : f.geometry.coordinates)
    const segNear = (a: number[], c: number[]) => { const dx = c[0] - a[0], dy = c[1] - a[1], l2 = dx * dx + dy * dy, k = l2 ? clampF(-(a[0] * dx + a[1] * dy) / l2, 0, 1) : 0; return Math.hypot(a[0] + k * dx, a[1] + k * dy) <= KEEP }
    const near = (f: any) => lines(f).some((l) => l.some((p, i) => i > 0 && segNear(toM(l[i - 1]), toM(p))))   // any segment passing within KEEP, not only a vertex
    const key = (p: number[]) => p[0].toFixed(5) + "," + p[1].toFixed(5)
    const nm = seed.properties?.name
    // any main-road class: a road often changes class (tertiary -> secondary) along its length
    const pool = all.filter((f) => near(f))
    // the ends of every piece, with the direction the road leaves in (unit vector), in metres
    const endsOf = (f: any) => lines(f).filter((l) => l.length > 1).flatMap((l) => {
      const a = toM(l[0]), a2 = toM(l[1]), z = toM(l[l.length - 1]), z2 = toM(l[l.length - 2])
      const u = (p: number[], q: number[]) => { const dx = p[0] - q[0], dy = p[1] - q[1], n = Math.hypot(dx, dy) || 1; return [dx / n, dy / n] }
      return [{ p: a, d: u(a, a2) }, { p: z, d: u(z, z2) }]
    })
    const picked = new Set<any>([seed]), open: { p: number[]; d: number[] }[] = []
    // a piece continues the road when one of its ends meets an open end (4 m: tile seams do not line up exactly) and keeps
    // going roughly straight on (< 50°): a crossing street at a junction is not taken
    const continues = (f: any) => endsOf(f).some((e) => open.some((o) => Math.hypot(e.p[0] - o.p[0], e.p[1] - o.p[1]) < 4 && -(e.d[0] * o.d[0] + e.d[1] * o.d[1]) > Math.cos((50 * Math.PI) / 180)))
    if (nm) pool.forEach((f) => { if (f.properties?.name === nm) picked.add(f) })
    picked.forEach((f) => open.push(...endsOf(f)))
    for (let grew = true; grew; ) {   // follow the road piece by piece
      grew = false
      for (const f of pool) if (!picked.has(f) && continues(f)) { picked.add(f); open.push(...endsOf(f)); grew = true }
    }
    const seen = new Set<string>(), coords: number[][][] = []
    picked.forEach((f) => lines(f).forEach((l) => { const k = key(l[0]) + key(l[l.length - 1]) + l.length; if (!seen.has(k)) { seen.add(k); coords.push(l) } }))
    return { type: "MultiLineString", coordinates: coords }
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

  const roads = q("transportation", ["in", "class", "motorway", "trunk", "primary", "secondary", "tertiary"]).filter((f) => f.geometry?.type?.includes("LineString"))
  const road = nearest(roads, MAX.road)
  if (road) out.push({ kind: "road", d: road.d, name: name(road.f, ""), geom: wholeLine(road.f, roads), at: road.at, t0: -1 })

  const water = nearest([...q("water", ["!=", "class", "pool"]), ...q("waterway", ["in", "class", "river", "canal", "stream"])].filter((f) => f.geometry), MAX.water)
  const wgeom = water && water.f.geometry.type.includes("LineString") ? wholeLine(water.f, q("waterway", ["in", "class", "river", "canal", "stream"]).filter((f) => f.geometry?.type?.includes("LineString"))) : water?.f.geometry
  if (water) out.push({ kind: "water", d: water.d, name: name(water.f, ({ river: "River", lake: "Lake", stream: "Stream", canal: "Canal" } as Record<string, string>)[water.f.properties?.class] || "Water"), geom: wgeom, at: water.at, t0: -1 })

  const wood = nearest(q("landcover", ["==", "subclass", "forest"]).filter((f) => f.geometry), MAX.forest)
  if (wood) out.push({ kind: "forest", d: wood.d, name: "", geom: wood.f.geometry, at: wood.at, t0: -1 })
  return { out, hasOwn: !!own }
}
