import type { RequestInput } from "./types"
import { DEMO_INDUSTRIES } from "./mock"

/** Explicit demo flow (?demo or ?autorun): fully simulated, no backend call. Every other submission is live. */
export const DEMO = typeof location !== "undefined" && /[?&](demo|autorun)\b/.test(location.search)

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

/** One live assessment per submission: POST /api/llm-input (full version, photos included; the LLM version is derived
 *  locally with forLlm()). The document is for the underwriter: never shown on the client screens, only in the team
 *  review panel. The endpoint gives no tracking reference. Never retried automatically. */
export async function runAssessment(i: RequestInput, accessCode?: string): Promise<LlmInput> {
  let r: Response
  try {
    r = await fetch("/api/llm-input", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(accessCode ? { "X-Access-Code": accessCode } : {}) },
      body: JSON.stringify({ client_name: i.contact, company_legal_name: i.company, address: i.address, industry_type: i.industry }),
    })
  } catch { throw new AssessError("service", "We could not reach the assessment service. Your details are kept, please try again.") }
  if (r.ok) return r.json()
  let detail = ""
  try { const j = await r.json(); detail = typeof j.detail === "string" ? j.detail : Array.isArray(j.detail) ? j.detail.map((d: { msg?: string }) => d.msg).filter(Boolean).join("; ") : "" } catch { /* no body */ }
  if (r.status === 401) throw new AssessError("code", "The access code is missing or not valid.")
  if (r.status === 422) throw new AssessError("input", detail || "Some details could not be matched. Please check them.")
  if (r.status === 503) throw new AssessError("service", "A public data service did not respond. Your details are kept, please try again.")
  throw new AssessError("service", "The assessment service had a problem. Your details are kept, please try again.")
}

/** llm_input.json as returned by the backend (schemas/llm_input.schema.json); only the parts the web app touches are typed */
export interface LlmInput { identification?: { company_name?: string }; images?: Record<string, { data_url?: string; label?: string }>; [k: string]: unknown }
/** Same document without the base64 photos: what the final-report LLM receives (= backend for_llm_text) */
export function forLlm(d: LlmInput): LlmInput {
  const c = structuredClone(d); Object.values(c.images || {}).forEach((i) => { delete i.data_url }); return c
}