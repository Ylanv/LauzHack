export type Status = "verified" | "observed" | "inferred" | "unknown"

/** Evidence contract: one item per field, every item keeps its source. Never a numeric risk score. */
export interface Evidence {
  field: string
  label: string
  value: unknown
  status: Status
  building_confirmed: boolean
  source: { type: string; url?: string; retrieved_at: string }
  evidence?: string
  confidence?: number
  requires_verification: boolean
}

/** industry: key from GET /api/industries (sent as industry_type) */
export interface RequestInput { contact: string; company: string; address: string; industry: string }
export interface Coords { lon: number; lat: number; label: string; cantonId: number }
export type StepId = "identity" | "building" | "hazard" | "aerial" | "industry" | "file"
export interface StepDef { id: StepId; label: string; sub: string; start: number; dur: number }

export type FlightStep = "identity" | "identity_done" | "zoom" | "focus" | "scan" | "done"
export interface FlightInput { step: FlightStep; progress: number }

export interface Insight {
  id: string; at: [StepId, number]; kind: "building" | "road" | "river" | "forest" | "info"
  e?: number; n?: number; dx?: number; dy?: number
  kicker: string; title: string; note: string
}