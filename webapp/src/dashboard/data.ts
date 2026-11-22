// Underwriter dashboard: data access and evidence resolution (docs/FRONTEND_INTEGRATION.md §2, §4, §6).
// A case = one folder written by `python -m src.report`: output.json, features_combined.json, metrics.json, images/…
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface CaseData {
  id: string                                   // folder name
  output: any | null                           // OUTPUT (report_output.v1), only when the report is valid
  bundle: any | null                           // COMBINED_FEATURE (features_combined.json)
  metrics: any | null                          // metrics.json
  validation: any | null                       // validation.json, when present
  url: (path: string) => string | null         // asset path relative to the folder -> URL
  files: string[]                              // known files (folder picker) — [] for the dev API
}


const CODE_KEY = "axalotl_access_code"
let asked = false
const storedCode = () => { try { return localStorage.getItem(CODE_KEY) || "" } catch { return "" } }

/** Online (Vercel): reports stored by the backend (GET /api/cases, private Blob store), behind the team's access code.
 *  The code is asked once and kept in this browser; the backend also sets a cookie so that case photos load. */
async function caseIds(): Promise<{ ids: string[]; base: "dev" | "api" } | null> {
  try { const r = await fetch("/reports-api/cases", { cache: "no-store" }); if (r.ok) return { ids: await r.json(), base: "dev" } } catch { /* not the dev server */ }
  for (let attempt = 0; attempt < 2; attempt++) {
    let code = storedCode()
    if (!code && !asked) { asked = true; code = (prompt("Access code of the underwriting team") || "").trim(); try { localStorage.setItem(CODE_KEY, code) } catch { /* private mode */ } }
    if (!code) return null
    let r: Response
    try { r = await fetch("/api/cases", { cache: "no-store", headers: { "X-Access-Code": code } }) } catch { return null }
    if (r.ok) return { ids: await r.json(), base: "api" }
    if (r.status !== 401) return null
    try { localStorage.removeItem(CODE_KEY) } catch { /* ignore */ }
    if (asked) return null
  }
  return null
}

const loaded = new Map<string, CaseData>()   // finished cases do not change: fetched once per page load

/** Report folders: dev → Vite plugin (webapp/vite.config.ts, ../reports + ../examples/reports); online → backend API */
export async function loadFromApi(): Promise<CaseData[] | null> {
  const found = await caseIds()
  if (!found) return null
  const prefix = found.base === "dev" ? "/reports-api/files" : "/api/cases"
  const mid = found.base === "dev" ? "" : "/files"
  const headers: Record<string, string> = found.base === "api" ? { "X-Access-Code": storedCode() } : {}
  const getCase = async (u: string) => { try { const r = await fetch(u, found.base === "dev" ? { cache: "no-store" } : { headers }); return r.ok ? await r.json() : null } catch { return null } }
  return Promise.all(found.ids.map(async (id) => {
    const cached = loaded.get(id)
    if (cached) return cached
    const f = (p: string) => `${prefix}/${encodeURIComponent(id)}${mid}/${p.split("/").map(encodeURIComponent).join("/")}`
    const [output, bundle, metrics, validation] = await Promise.all(["output.json", "features_combined.json", "metrics.json", "validation.json"].map((p) => getCase(f(p))))
    const c: CaseData = { id, output, bundle, metrics, validation, url: f, files: [] }
    if (found.base === "api" && metrics && metrics.status !== "running") loaded.set(id, c)
    return c
  }))
}

/** Anywhere: a folder chosen from disk (one case folder, or a parent folder holding several) */
export async function loadFromFiles(list: FileList): Promise<CaseData[]> {
  const byCase = new Map<string, Map<string, File>>()
  Array.from(list).forEach((file) => {
    const parts = (file.webkitRelativePath || file.name).split("/")
    // <picked>/<case>/<file…> or <picked>/<file…> (picked folder is itself a case)
    const isNested = parts.length > 2 && !["output.json", "features_combined.json", "metrics.json"].includes(parts[1])
    const id = isNested ? parts[1] : parts[0], rel = parts.slice(isNested ? 2 : 1).join("/")
    if (!byCase.has(id)) byCase.set(id, new Map()); byCase.get(id)!.set(rel, file)
  })
  const out: CaseData[] = []
  for (const [id, files] of byCase) {
    if (!files.has("output.json") && !files.has("features_combined.json") && !files.has("metrics.json")) continue
    const js = async (n: string) => { const f = files.get(n); if (!f) return null; try { return JSON.parse(await f.text()) } catch { return null } }
    const urls = new Map<string, string>()
    out.push({
      id, output: await js("output.json"), bundle: await js("features_combined.json"), metrics: await js("metrics.json"), validation: await js("validation.json"),
      url: (p) => { const f = files.get(p); if (!f) return null; if (!urls.has(p)) urls.set(p, URL.createObjectURL(f)); return urls.get(p)! },
      files: [...files.keys()],
    })
  }
  return out
}

/* ---------- §4 evidence resolution ---------- */
export interface Index { facts: Map<string, any>; sources: Map<string, any>; visuals: Map<string, any>; annotations: Map<string, any>; findings: Map<string, any>; questions: Map<string, any>; byKey: Map<string, any> }
export function buildIndex(bundle: any, report: any): Index {
  const facts = new Map<string, any>((bundle?.facts || []).map((f: any) => [f.id, f]))
  return {
    facts,
    sources: new Map((bundle?.sources || []).map((s: any) => [s.id, s])),
    visuals: new Map((bundle?.visuals || []).map((v: any) => [v.id, v])),
    annotations: new Map((bundle?.visuals || []).flatMap((v: any) => (v.annotations || []).map((a: any) => [a.id, { ...a, visual_id: v.id }]))),
    findings: new Map((report?.priority_findings || []).map((f: any) => [f.id, f])),
    questions: new Map((report?.open_questions || []).map((q: any) => [q.id, q])),
    byKey: new Map((bundle?.facts || []).map((f: any) => [f.field_key, f])),
  }
}
export type Resolved = { kind: "fact" | "source" | "visual" | "annotation"; item: any } | { kind: "unresolved"; id: string }
export function resolve(ix: Index, id: string): Resolved {
  if (ix.facts.has(id)) return { kind: "fact", item: ix.facts.get(id) }
  if (ix.sources.has(id)) return { kind: "source", item: ix.sources.get(id) }
  if (ix.visuals.has(id)) return { kind: "visual", item: ix.visuals.get(id) }
  if (ix.annotations.has(id)) return { kind: "annotation", item: ix.annotations.get(id) }
  return { kind: "unresolved", id }
}

/* ---------- labels (§3, §6) ---------- */
export const humanise = (k: string) => { const s = String(k || "").replace(/^(feat|ev)\./, "").replace(/_/g, " ").trim(); return s ? s[0].toUpperCase() + s.slice(1) : "" }
export const READINESS: Record<string, [string, string]> = {
  ready_for_initial_review: ["Ready for initial review", "ok"], requires_clarification: ["Requires clarification", "amber"],
  specialist_review_recommended: ["Specialist review recommended", "orange"], building_identity_unresolved: ["Building identity unresolved", "red"],
}
export const STATUS: Record<string, [string, string]> = {
  official_record: ["Verified — official record", "ok"], site_specific_document: ["Verified — site document", "ok"],
  company_level_document: ["Company-level document (not proof for this building)", "blue"], visual_observation: ["Observed in imagery (to verify)", "sky"],
  derived_estimate: ["Estimated / inferred / declared", "amber"], unknown: ["Unknown — not absent", "grey"], conflicting: ["Conflicting evidence", "conflict"],
}
export const PRICING: Record<string, string> = {
  regulated_component_underwriting_only: "Regulated cover — underwriting/prevention only", coverage_dependent: "Depends on cover selected",
  potential_individual_pricing_input: "Individually assessable", not_assessed: "Not assessed",
}
export const TARGET: Record<string, string> = { client: "Client", internal_axa: "AXA internal", risk_engineer: "Risk engineer", valuation_expert: "Valuation expert" }
export const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
export const FINDING_TYPE: Record<string, string> = { confirmed_exposure: "Confirmed exposure", potential_exposure: "Potential exposure", protective_factor: "Protective factor", data_gap: "Data gap", source_conflict: "Source conflict" }

/* ---------- §4.3 value formatting ---------- */
const swiss = (n: number) => { const [i, d] = Math.abs(n).toFixed(Number.isInteger(n) ? 0 : 2).split("."); return (n < 0 ? "-" : "") + i.replace(/\B(?=(\d{3})+(?!\d))/g, "'") + (d ? "." + d : "") }
export const fmtNumber = (n: number, unit?: string | null) => (unit === "CHF" ? `${swiss(n)} CHF` : unit === "m2" ? `${swiss(n)} m²` : unit ? `${swiss(n)} ${unit}` : swiss(n))
export const isRange = (v: any) => v && typeof v === "object" && "best_estimate_chf" in v
export const fmtRange = (v: any) => v.best_estimate_chf == null ? "Unknown" : `CHF ${swiss(v.best_estimate_chf)}` + (v.low_chf != null && v.high_chf != null ? ` (range ${swiss(v.low_chf)} – ${swiss(v.high_chf)})` : "")
/** short one-line text, or null when the value needs a structured view */
export function fmtInline(v: any, unit?: string | null): string | null {
  if (v === null || v === undefined) return "Unknown"
  if (typeof v === "number") return fmtNumber(v, unit)
  if (typeof v === "boolean") return v ? "Yes" : "No"
  if (typeof v === "string") return v
  if (isRange(v)) return fmtRange(v)
  return null
}
export const fmtShare = (k: string, x: any) => (typeof x === "number" && x >= 0 && x <= 1 && /share|ratio|fraction|pct/i.test(k) ? `${Math.round(x * 100)}%` : x)

export const isSynthetic = (c: CaseData) =>
  !!c.metrics?.synthetic || (!!c.bundle?.sources?.length && c.bundle.sources.every((s: any) => String(s.provider || "").startsWith("SYNTHETIC"))) || String(c.bundle?.quality_flags?.[0] || "").startsWith("SYNTHETIC case")

/** hazard facts as one readable line (real ETL shapes: {level, share}, {perimeter_share, max_depth, by_depth},
 *  {hail_50y_cm}, {sia261_zone, soil_class}); null when the shape is not recognised */
export function fmtHazard(key: string, v: any): string | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null
  const pct = (x: number) => `${Math.round(x * 100)}%`
  if ("level" in v && "share" in v) return v.level === "none" || !v.share ? "No hazard zone" : `${humanise(String(v.level))} · ${pct(v.share)} of footprint`
  if ("perimeter_share" in v) return v.perimeter_share ? `${pct(v.perimeter_share)} of perimeter${v.max_depth ? ` · max ${v.max_depth}` : ""}` : "No runoff zone"
  if ("hail_50y_cm" in v) return v.hail_50y_cm == null ? "Unknown" : `${v.hail_50y_cm} cm hail (50-year)`
  if ("sia261_zone" in v) return `Zone ${v.sia261_zone}${v.soil_class ? ` · soil class ${v.soil_class}` : ""}`
  void key
  return null
}
