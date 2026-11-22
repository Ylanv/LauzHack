import type { RequestInput } from "./types"
import { DEMO_INDUSTRIES } from "./mock"

/** Explicit demo flow (/demo.html, ?demo, or ?autorun without &live): fully simulated, no backend call, no access code,
 *  no API key. Every other submission is live. */
export const DEMO = typeof location !== "undefined" && (/\/demo(\.html)?$/.test(location.pathname) || /[?&]demo\b/.test(location.search) || (/[?&]autorun\b/.test(location.search) && !/[?&]live\b/.test(location.search)))

export interface Industry { key: string; label: string }

/** Activities the client picks from (GET /api/industries). Never inferred from the company name. */
export async function getIndustries(): Promise<Industry[]> {
  if (DEMO) return DEMO_INDUSTRIES
  const r = await fetch("/api/industries")
  if (!r.ok) throw new Error("industries " + r.status)
  return r.json()
}

/** Whether the backend asks for the team's access code (GET /api/health). The code itself is never in the bundle. */
export async function accessCodeRequired(): Promise<boolean> {
  if (DEMO) return false
  const r = await fetch("/api/health")
  if (!r.ok) throw new Error("health " + r.status)
  return !!(await r.json()).access_code_required
}

/** Official footprint (WGS84 GeoJSON) of the building at this address, for the map (GET /api/footprint, public data, no code).
 *  null when unavailable: the map then keeps its vector-tile fallback. */
export async function getFootprint(address: string): Promise<any | null> {
  if (DEMO) return null
  try {
    const r = await fetch("/api/footprint?address=" + encodeURIComponent(address))
    return r.ok ? (await r.json()).geometry ?? null : null
  } catch { return null }
}

export type AssessErrorKind = "code" | "input" | "service"
export class AssessError extends Error { constructor(public kind: AssessErrorKind, message: string) { super(message) } }

/** One live report per submission: POST /api/reports starts the full pipeline (ETL → LLM report → validation) on the
 *  backend and returns a job id. The client never receives the report: underwriters read it in the dashboard.
 *  Never retried automatically. */
export async function startReport(i: RequestInput, accessCode?: string): Promise<string> {
  let r: Response
  try {
    r = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(accessCode ? { "X-Access-Code": accessCode } : {}) },
      body: JSON.stringify({ client_name: i.contact, company_legal_name: i.company, address: i.address, industry_type: i.industry }),
    })
  } catch { throw new AssessError("service", "We could not reach the assessment service. Your details are kept, please try again.") }
  if (r.ok) return (await r.json()).job_id
  let detail = ""
  try { const j = await r.json(); detail = typeof j.detail === "string" ? j.detail : Array.isArray(j.detail) ? j.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join("; ") : "" } catch { /* no body */ }
  if (r.status === 401) throw new AssessError("code", "The access code is missing or not valid.")
  if (r.status === 422) throw new AssessError("input", detail || "Some details could not be matched. Please check them.")
  throw new AssessError("service", "The assessment service had a problem. Your details are kept, please try again.")
}

/** One live report per submission, with live progress: POST /api/reports/stream runs the full pipeline while the
 *  request stays open (needed on Vercel, where a background job would be suspended) and streams one JSON line per
 *  progress change (same shape as GET /api/reports/{id}). Resolves with the last status. Never retried automatically. */
export async function streamReport(i: RequestInput, accessCode: string | undefined, onProgress: (p: ReportProgress) => void): Promise<ReportProgress> {
  let r: Response
  try {
    r = await fetch("/api/reports/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(accessCode ? { "X-Access-Code": accessCode } : {}) },
      body: JSON.stringify({ client_name: i.contact, company_legal_name: i.company, address: i.address, industry_type: i.industry }),
    })
  } catch { throw new AssessError("service", "We could not reach the assessment service. Your details are kept, please try again.") }
  if (!r.ok || !r.body) {
    let detail = ""
    try { const j = await r.json(); detail = typeof j.detail === "string" ? j.detail : Array.isArray(j.detail) ? j.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join("; ") : "" } catch { /* no body */ }
    if (r.status === 401) throw new AssessError("code", "The access code is missing or not valid.")
    if (r.status === 422) throw new AssessError("input", detail || "Some details could not be matched. Please check them.")
    throw new AssessError("service", "The assessment service had a problem. Your details are kept, please try again.")
  }
  const reader = r.body.getReader(), dec = new TextDecoder()
  let buf = "", last: ReportProgress | null = null
  const lost = () => new AssessError("service", "We lost the connection to the assessment service. Your details are kept, please try again.")
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>
    try { chunk = await reader.read() } catch { throw lost() }
    if (chunk.done) break
    buf += dec.decode(chunk.value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1)
      if (!line) continue
      const msg = JSON.parse(line)
      if (msg.heartbeat) continue
      last = msg as ReportProgress
      onProgress(last)
    }
  }
  if (!last || last.status === "running") throw lost()
  return last
}

/** Progress of a report job (GET /api/reports/{id}): status and the stage running now (etl, features, llm, validate). */
export interface ReportProgress { job_id: string; status: "running" | "succeeded" | "invalid_report" | "failed"; stage: string | null; done_stages: string[]; error: { stage?: string; message?: string } | null }
export async function reportStatus(job: string): Promise<ReportProgress> {
  const r = await fetch(`/api/reports/${encodeURIComponent(job)}`, { cache: "no-store" })
  if (!r.ok) throw new Error("status " + r.status)
  return r.json()
}
/** What to tell the client when the job ended without a valid report */
export function progressError(p: ReportProgress): AssessError {
  const m = p.error?.message || ""
  if (p.status === "failed" && /^input rejected: /i.test(m)) return new AssessError("input", m.replace(/^input rejected: /i, ""))
  if (p.status === "failed" && /^public service unavailable/i.test(m)) return new AssessError("service", "A public data service did not respond. Your details are kept, please try again.")
  return new AssessError("service", "We could not finish your file. Your details are kept, please try again.")
}