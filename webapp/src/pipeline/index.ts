import type { RequestInput } from "./types"
import { DEMO_INDUSTRIES } from "./mock"

/** Explicit demo flow (?demo, or ?autorun without &live): fully simulated, no backend call. Every other submission is live. */
export const DEMO = typeof location !== "undefined" && (/[?&]demo\b/.test(location.search) || (/[?&]autorun\b/.test(location.search) && !/[?&]live\b/.test(location.search)))

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