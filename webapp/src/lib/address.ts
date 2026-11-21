import type { Coords } from "../pipeline/types"
import { cantonAt } from "./canton"

export interface AddressHit { text: string; lon: number; lat: number; live?: boolean }

// Offline fallback list (demo case works without network).
const MOCK_ADDR: AddressHit[] = ([
  ["Rue de l'Industrie 21", "1950", "Sion", 7.36333, 46.22724], ["Rue de la Dixence 10", "1950", "Sion", 7.364, 46.229], ["Avenue de France 12", "1950", "Sion", 7.359, 46.227],
  ["Bahnhofstrasse 10", "8001", "Zürich", 8.5391, 47.3769], ["Bahnhofstrasse 45", "8001", "Zürich", 8.538, 47.372], ["Rue du Rhône 14", "1204", "Genève", 6.147, 46.2043],
  ["Route de Meyrin 123", "1217", "Meyrin", 6.078, 46.233], ["Avenue de la Gare 5", "1003", "Lausanne", 6.629, 46.517], ["Route de Cossonay 2", "1008", "Prilly", 6.605, 46.533],
  ["Marktgasse 20", "3011", "Bern", 7.449, 46.948], ["Freie Strasse 30", "4001", "Basel", 7.589, 47.558], ["Via Nassa 5", "6900", "Lugano", 8.951, 46.003],
  ["Rue de Lausanne 40", "1700", "Fribourg", 7.15, 46.803], ["Industriestrasse 12", "6300", "Zug", 8.516, 47.166], ["Poststrasse 7", "9000", "St. Gallen", 9.377, 47.424], ["Rue de l'Hôpital 3", "2000", "Neuchâtel", 6.931, 46.992],
] as [string, string, string, number, number][]).map(([st, zip, town, lon, lat]) => ({ text: `${st}, ${zip} ${town}`, lon, lat }))

export const norm = (x: string) => x.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")

/** geo.admin.ch SearchServer first (1.2 s timeout), mock list as fallback. */
export async function searchAddress(q: string): Promise<AddressHit[]> {
  try {
    const c = new AbortController()
    const to = setTimeout(() => c.abort(), 1200)
    const r = await fetch("https://api3.geo.admin.ch/rest/services/ech/SearchServer?type=locations&origins=address&sr=4326&limit=6&searchText=" + encodeURIComponent(q), { signal: c.signal })
    clearTimeout(to)
    const j = await r.json()
    if (j.results?.length) return j.results.map((x: any) => ({ text: String(x.attrs.label).replace(/<[^>]+>/g, ""), lon: x.attrs.lon, lat: x.attrs.lat, live: true }))
  } catch { /* offline or blocked */ }
  const n = norm(q).trim()
  const a = MOCK_ADDR.filter((x) => norm(x.text).startsWith(n))
  const b = MOCK_ADDR.filter((x) => !a.includes(x) && norm(x.text).split(/[ ,]+/).some((w) => w.startsWith(n)))
  return a.concat(b).slice(0, 6)
}

/** Resolve the canton and build the coordinates handed to the globe. EGID lookup (RegBL) is a PLUG-IN. */
export function coordsFor(hit: AddressHit): Coords {
  const cn = cantonAt(hit.lon, hit.lat)
  return { lon: hit.lon, lat: hit.lat, cantonId: cn ? cn.id : 0, label: cn ? `${cn.name} (${cn.abbr})` : "Switzerland" }
}