import geo from "../data/geo.json"

const D = Math.PI / 180
const CANTON: Record<number, string[]> = { 1:["Zurich","ZH"],2:["Bern","BE"],3:["Lucerne","LU"],4:["Uri","UR"],5:["Schwyz","SZ"],6:["Obwalden","OW"],7:["Nidwalden","NW"],8:["Glarus","GL"],9:["Zug","ZG"],10:["Fribourg","FR"],11:["Solothurn","SO"],12:["Basel-Stadt","BS"],13:["Basel-Landschaft","BL"],14:["Schaffhausen","SH"],15:["Appenzell Ausserrhoden","AR"],16:["Appenzell Innerrhoden","AI"],17:["St. Gallen","SG"],18:["Graubünden","GR"],19:["Aargau","AG"],20:["Thurgau","TG"],21:["Ticino","TI"],22:["Vaud","VD"],23:["Valais","VS"],24:["Neuchâtel","NE"],25:["Geneva","GE"],26:["Jura","JU"] };

const rings = (geo as any).cantons.map((c: any) => ({ id: c.id as number, r: c.r.map((r: number[]) => { const a = new Float64Array(r.length); for (let i = 0; i < r.length; i += 2) { a[i] = r[i] * D; a[i + 1] = r[i + 1] * D } return a }) }))

const inRing = (r: Float64Array, x: number, y: number) => {
  let ins = false
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) ins = !ins
  }
  return ins
}

/** Canton containing a WGS84 point (point-in-polygon on the embedded swisstopo-derived outlines). */
export function cantonAt(lonDeg: number, latDeg: number) {
  const x = lonDeg * D, y = latDeg * D
  for (const c of rings) {
    let k = 0
    c.r.forEach((r: Float64Array) => { if (inRing(r, x, y)) k++ })
    if (k % 2) return { id: c.id, name: CANTON[c.id][0], abbr: CANTON[c.id][1] }
  }
  return null
}