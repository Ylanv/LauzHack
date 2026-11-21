import type { Coords } from "../pipeline/types"
import { cantonAt } from "./canton"

export interface AddressHit { text: string; lon: number; lat: number; live?: boolean }

// Offline fallback list (the demo case works without network). Mostly Geneva; Sion stays to show the out-of-canton message.
const MOCK_ADDR: AddressHit[] = ([
  ["Rue du Champ-Blanchod 7", "1228", "Plan-les-Ouates", 6.109486, 46.166565], ["Rue du Rhône 14", "1204", "Genève", 6.147, 46.2043],
  ["Route de Meyrin 123", "1217", "Meyrin", 6.078, 46.233], ["Chemin du Pont-du-Centenaire 109", "1228", "Plan-les-Ouates", 6.123, 46.169],
  ["Route des Jeunes 12", "1227", "Carouge", 6.133, 46.183], ["Rue de l'Industrie 21", "1950", "Sion", 7.36333, 46.22724],
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
    // labels become "Street N, NPA Town", the format the backend expects
    if (j.results?.length) return j.results.map((x: any) => ({ text: String(x.attrs.label).replace(/<[^>]+>/g, "").replace(/\s+(\d{4}\s)/, ", $1"), lon: x.attrs.lon, lat: x.attrs.lat, live: true }))
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