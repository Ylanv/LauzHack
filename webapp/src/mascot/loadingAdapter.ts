import type { MascotEmotionController } from "./emotion"

export type TaskStatus = "pending" | "running" | "done" | "warning" | "failed"
export interface LoadingTask { id: string; status: TaskStatus }
/**
 * What the mascot needs to know about a loading process, independent of the backend's own objects.
 * `runId` identifies one loading run: events are consumed once per run, so re-renders never replay them.
 * `outcome` is the overall result once known (a failure without a specific task can be reported here).
 */
export interface LoadingSnapshot {
  runId: string | number | null
  tasks: LoadingTask[]
  outcome?: "running" | "success" | "failed"
}

export type MascotEvent =
  | { type: "loadingStarted" }
  | { type: "taskStarted"; id: string }
  | { type: "taskCompleted"; id: string }
  | { type: "taskWarning"; id: string }
  | { type: "taskFailed"; id: string }
  | { type: "allCompleted" }

/**
 * Turns loading snapshots into one-shot mascot events and applies them to an emotion controller.
 * Feed it the latest snapshot as often as you like: it diffs against what it has already consumed.
 *
 *   task starts            -> THINKING (base)
 *   task completes         -> HAPPY reaction (once per task and run)
 *   task warning           -> CONCERNED (base, while that task is unfinished)
 *   task / run fails       -> ERROR reaction, then calm IDLE
 *   run succeeds           -> SUCCESS reaction (replaces the happy of the last task), then IDLE
 *
 * The first snapshot seen for a run only records tasks that are already finished, so mounting the mascot in the
 * middle of a run does not replay old completions.
 */
export class MascotLoadingAdapter {
  private runId: string | number | null = null
  private seen = new Set<string>()
  private ended = false
  private failedRun = false

  constructor(private emotion: MascotEmotionController) {}

  sync(s: LoadingSnapshot | null | undefined, now: number): MascotEvent[] {
    const events: MascotEvent[] = []
    if (!s || s.runId === null) {
      if (this.runId !== null) { this.runId = null; this.seen.clear(); this.ended = false; this.failedRun = false }
      return events
    }
    const fresh = s.runId !== this.runId
    if (fresh) {
      this.runId = s.runId; this.seen.clear(); this.ended = false; this.failedRun = false
      events.push({ type: "loadingStarted" })
    }
    const once = (key: string) => (this.seen.has(key) ? false : (this.seen.add(key), true))
    const failedTasks = s.tasks.filter((t) => t.status === "failed")
    const failed = (this.failedRun ||= s.outcome === "failed" || failedTasks.length > 0)   // a failed run never succeeds
    const success = !failed && s.outcome === "success"
    // the first snapshot of a run that is already under way: remember history silently
    const silent = fresh && s.tasks.some((t) => t.status === "done" || t.status === "failed")

    for (const t of s.tasks) {
      if (t.status === "running" && once("run:" + t.id)) events.push({ type: "taskStarted", id: t.id })
      if (t.status === "warning" && once("warn:" + t.id)) events.push({ type: "taskWarning", id: t.id })
      if (t.status === "done" && once("done:" + t.id)) events.push({ type: "taskCompleted", id: t.id })
      if (t.status === "failed" && once("fail:" + t.id)) events.push({ type: "taskFailed", id: t.id })
    }
    if (s.outcome === "failed" && !failedTasks.length && once("fail:*")) events.push({ type: "taskFailed", id: "*" })
    if (success && once("success")) events.push({ type: "allCompleted" })

    // apply: final outcome first, so SUCCESS wins over the last task's HAPPY and a failure never celebrates
    const e = this.emotion
    if (fresh) e.clearReactions()
    if (silent) events.splice(fresh ? 1 : 0)   // keep only loadingStarted: nothing to react to
    if (failed) {
      if (!this.ended && events.some((x) => x.type === "taskFailed")) e.react("error", now)
      this.ended = true
      e.setBase("idle")
    } else if (success) {
      if (!this.ended && events.some((x) => x.type === "allCompleted")) e.react("success", now)
      this.ended = true
      e.setBase("idle")
    } else {
      for (const x of events) if (x.type === "taskCompleted") e.react("happy", now)
      // idle until the first task starts, thinking while work is in progress (also between two tasks)
      const warning = s.tasks.some((t) => t.status === "warning")
      const started = s.tasks.some((t) => t.status !== "pending")
      e.setBase(warning ? "concerned" : started ? "thinking" : "idle")
    }
    return events
  }
}
