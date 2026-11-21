import { MOCK } from "./mock"
import type { Evidence, RequestInput } from "./types"

/** Pipeline adapter. Each branch returns Evidence[]. Stubs are marked PLUG-IN; all fall back to [] (= unknown). */
export const PIPELINE_ADAPTER = {
  /** PLUG-IN: Zefix (company), geo.admin.ch (address -> coordinates, canton), RegBL (EGID). Code only, 0 tokens. */
  async identity(_input: RequestInput): Promise<Evidence[]> { return [] },
  /** PLUG-IN: RegBL by EGID plus swissBUILDINGS3D. Unknown stays unknown. */
  async building(_ctx: Evidence[]): Promise<Evidence[]> { return [] },
  /** PLUG-IN: intersect coordinates with federal hazard layers. Never produce a numeric risk score. */
  async hazard(_ctx: Evidence[]): Promise<Evidence[]> { return [] },
  /** PLUG-IN: SWISSIMAGE tile, then ONE vision-model call for roof shape, panels, vegetation. */
  async aerial(_ctx: Evidence[]): Promise<Evidence[]> { return [] },
  /** PLUG-IN: crawl website and public docs, one small-model extraction. building_confirmed only if tied to the address. */
  async industry(_ctx: Evidence[]): Promise<Evidence[]> { return [] },
  /** Single synthesis call, done by the backend (POST /api/report). Offline: resolves with the mock reference. */
  async synthesis(evidence: Evidence[], input: RequestInput): Promise<{ ref: string; evidence: Evidence[]; offline: boolean }> {
    try {
      const c = new AbortController()
      const to = setTimeout(() => c.abort(), 4000)
      const r = await fetch("/api/report", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: c.signal,
        body: JSON.stringify({ client_name: input.contact, company_legal_name: input.company, address: input.address }),
      })
      clearTimeout(to)
      if (r.ok) { const j = await r.json(); return { ref: j.report_id ?? MOCK.ref, evidence, offline: false } }
    } catch { /* backend not running: demo stays fully offline */ }
    return { ref: MOCK.ref, evidence, offline: true }
  },
}

export async function collectEvidence(input: RequestInput) {
  const id = await PIPELINE_ADAPTER.identity(input)
  const parts = await Promise.all([PIPELINE_ADAPTER.building(id), PIPELINE_ADAPTER.hazard(id), PIPELINE_ADAPTER.aerial(id), PIPELINE_ADAPTER.industry(id)])
  return PIPELINE_ADAPTER.synthesis([id, ...parts].flat(), input)
}