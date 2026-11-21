// Ticket workflow of the underwriter dashboard (Jira-like). The backend only produces reports; who works on a case and
// where it stands is a dashboard decision (docs/FRONTEND_INTEGRATION.md §2). Kept in localStorage for now.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { CaseData } from "./data"

export type Status = "generating" | "failed" | "to_review" | "in_progress" | "waiting_client" | "resolved"
export const STATUS_LABEL: Record<Status, string> = {
  generating: "Generating", failed: "Failed", to_review: "To review", in_progress: "In progress", waiting_client: "Waiting for client", resolved: "Resolved",
}
/** lozenge colour, Jira style: grey = to do, blue = in progress, yellow = waiting, green = done, red = problem */
export const STATUS_TONE: Record<Status, string> = { generating: "blue", failed: "red", to_review: "grey", in_progress: "blue", waiting_client: "yellow", resolved: "green" }
export const WORKFLOW: Status[] = ["to_review", "in_progress", "waiting_client", "resolved"]

export interface Ticket { status?: Status; assignee?: string; answered?: string[]; updated?: string }
const KEY = "uw.tickets.v1"
const read = (): Record<string, Ticket> => { try { return JSON.parse(localStorage.getItem(KEY) || "{}") } catch { return {} } }
export const getTicket = (id: string): Ticket => read()[id] || {}
export function saveTicket(id: string, patch: Partial<Ticket>) {
  const all = read(); all[id] = { ...all[id], ...patch, updated: new Date().toISOString() }; localStorage.setItem(KEY, JSON.stringify(all))
}

/** the pipeline decides first (still generating / failed); then the workflow the underwriter set */
export function statusOf(c: CaseData, t: Ticket): Status {
  const st = c.metrics?.status
  if (st === "running") return "generating"
  if (st === "failed" || st === "invalid_report" || (!c.output && st !== "succeeded")) return "failed"
  return t.status && WORKFLOW.includes(t.status) ? t.status : "to_review"
}
export type Queue = "open" | "mine" | "pending" | "resolved" | "all"
export const QUEUES: [Queue, string][] = [["open", "All open"], ["mine", "Assigned to me"], ["pending", "Waiting for client"], ["resolved", "Resolved"], ["all", "All cases"]]
export function inQueue(q: Queue, s: Status, t: Ticket) {
  if (q === "all") return true
  if (q === "resolved") return s === "resolved"
  if (q === "pending") return s === "waiting_client"
  if (q === "mine") return t.assignee === "me" && s !== "resolved"
  return s !== "resolved"
}
/** highest priority among the findings (Jira-like priority column) */
export function topPriority(r: any): string | null {
  const order = ["critical", "high", "medium", "low"]
  const ps = (r?.priority_findings || []).map((f: any) => f.priority)
  return order.find((p) => ps.includes(p)) || null
}
