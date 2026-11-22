import { useEffect, useRef, useState } from "react"
import AxolotlMascot, { mascotNow } from "../mascot/AxolotlMascot"
import { MascotEmotionController } from "../mascot/emotion"
import Diamond from "./Diamond"

/** What the companion feels, set together with the bubble text (App.say / FormScreen):
 *  idle (a hint), working (pipeline running), happy (good news), puzzled (check something), error (it failed), success (sent) */
export type Mood = "idle" | "working" | "happy" | "puzzled" | "error" | "success"
/** What the pipeline is doing right now: finished steps (last few) and the current one. */
export interface Status { done: string[]; now: string; complete?: boolean }

interface Props {
  mood?: Mood
  /** Short hint shown in the speech bubble. Change `bubbleKey` to re-show the same text. */
  bubble?: string
  bubbleKey?: number
  bubbleMs?: number
  /** While set, the bubble stays open and narrates the work in progress (instead of a short hint). */
  status?: Status | null
}

/**
 * Docked companion: the AXA axolotl (src/mascot). It follows the cursor and its emotion matches what the bubble says:
 *  - hint                → idle            - "Found it" / "Demo case filled in" → happy
 *  - "Check the field"   → concerned       - pipeline running → thinking, each finished step → happy
 *  - report ready / sent → success         - failure → error, then concerned
 */
export default function Companion({ mood = "idle", bubble, bubbleKey = 0, bubbleMs = 3200, status = null }: Props) {
  const [shown, setShown] = useState(false)
  const timer = useRef<number>()
  const ctl = useRef<MascotEmotionController>()
  ctl.current ??= new MascotEmotionController()
  const emo = ctl.current

  useEffect(() => {
    if (!bubble) return
    setShown(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setShown(false), bubbleMs)
    return () => window.clearTimeout(timer.current)
  }, [bubble, bubbleKey, bubbleMs])

  // lasting state: concerned while something needs fixing, thinking while the pipeline runs, idle otherwise
  const running = !!status && !status.complete
  useEffect(() => {
    emo.setBase(mood === "puzzled" || mood === "error" ? "concerned" : running || mood === "working" ? "thinking" : "idle")
  }, [emo, mood, running])

  // short reactions, played with the bubble that announces them (bubbleKey re-triggers the same mood)
  useEffect(() => {
    if (mood === "happy") emo.react("happy", mascotNow())
    else if (mood === "success") emo.react("success", mascotNow())
    else if (mood === "error") emo.react("error", mascotNow())
  }, [emo, mood, bubbleKey])

  // pipeline: a happy bounce for every newly finished step, success when the file is complete
  const lastDone = useRef("")
  const lastStep = status?.done[status.done.length - 1] || ""
  useEffect(() => {
    if (!status) { lastDone.current = ""; return }
    if (lastStep && lastStep !== lastDone.current) { lastDone.current = lastStep; emo.react("happy", mascotNow()) }
  }, [emo, status, lastStep])
  const wasComplete = useRef(false)
  useEffect(() => {
    if (status?.complete && !wasComplete.current) emo.react("success", mascotNow())
    wasComplete.current = !!status?.complete
  }, [emo, status?.complete])

  return (
    <aside className="companion">
      {status ? <StatusList status={status} /> : (
        <div className={"companion__bubble" + (shown ? " show" : "")} aria-hidden="true">{bubble}</div>
      )}
      <div className="companion__mascot" aria-hidden="true">
        <AxolotlMascot controller={emo} tracking />
      </div>
    </aside>
  )
}

/* The steps as an elevator: every step is a line, added AT THE BOTTOM the first time it shows up and never replaced.
   At most 3 lines are visible; when a new one arrives, the whole stack moves up one slot and the top line slides out
   through the top edge of the bubble (clipped), while the new one comes in from below. A line turns from loader to
   green check when its step is done. Steps that overlap (two running at once) both stay visible as running. */
const ROW = 30, VISIBLE = 3
const Check = () => <span className="st-check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5.5 12.5l4.3 4.3L18.5 8" /></svg></span>
const FINAL = "File complete"
function StatusList({ status }: { status: Status }) {
  const order = useRef<string[]>([])   // labels in the order they first appeared (reset when the bubble closes)
  const add = (l: string) => { if (l && !order.current.includes(l)) order.current.push(l) }
  const placeholder = /^(Starting|Finishing)$/.test(status.now)   // not real steps: shown only while nothing else is
  status.done.forEach(add)
  if (status.complete) add(FINAL); else if (!placeholder) add(status.now)
  const done = new Set(status.done)
  const rows = order.current.length
    ? order.current.map((label) => ({ label, kind: label === FINAL ? "final" as const : done.has(label) ? "done" as const : "now" as const }))
    : [{ label: status.now, kind: "now" as const }]
  const first = Math.max(0, rows.length - VISIBLE)
  return (
    <div className="companion__status" role="status" aria-live="polite">
      <div className="st-list" style={{ height: Math.min(rows.length, VISIBLE) * ROW }}>
        {rows.map((r, i) => {
          const slot = i - first
          if (slot < -1) return null   // already gone
          return (
            <div key={r.label} className={"st-row " + (r.kind === "done" ? "st-done" : "st-now") + (slot < 0 ? " st-out" : "")} aria-hidden={slot < 0}
              style={{ ["--y" as string]: `${slot * ROW}px` }}>
              {r.kind === "now" ? <Diamond className="st-diamond" /> : <Check />}
              {r.kind === "done" && <span className="st-sr">Done: </span>}
              <span className={r.kind === "now" ? "st-text" : r.kind === "final" ? "st-text st-still" : "st-label"}>{r.label}{r.kind === "now" && <span className="dots" aria-hidden="true" />}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}