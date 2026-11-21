import { useEffect, useRef, useState } from "react"
import MarbleSprite from "./CobaltSprite"
import Diamond from "./Diamond"

export type Mood = "idle" | "working" | "happy" | "puzzled"
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

/** Docked cobalt-sprite companion: follows the pointer, reacts to the pipeline mood, narrates what it is doing. */
export default function Companion({ mood = "idle", bubble, bubbleKey = 0, bubbleMs = 3200, status = null }: Props) {
  const [shown, setShown] = useState(false)
  const timer = useRef<number>()

  useEffect(() => {
    if (!bubble) return
    setShown(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setShown(false), bubbleMs)
    return () => window.clearTimeout(timer.current)
  }, [bubble, bubbleKey, bubbleMs])

  const working = mood === "working"
  return (
    <aside className="companion">
      {status ? (
        <div className="companion__status" role="status" aria-live="polite">
          {status.done.map((d) => (
            <div className="st-done" key={d}>
              <span className="st-check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5.5 12.5l4.3 4.3L18.5 8" /></svg></span>
              <span className="st-sr">Done: </span>{d}
            </div>
          ))}
          <div className="st-now" key={status.now}>
            {status.complete
              ? <span className="st-check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5.5 12.5l4.3 4.3L18.5 8" /></svg></span>
              : <Diamond className="st-diamond" />}
            <span className={status.complete ? "st-text st-still" : "st-text"}>{status.now}{!status.complete && <span className="dots" aria-hidden="true" />}</span>
          </div>
        </div>
      ) : (
        <div className={"companion__bubble" + (shown ? " show" : "")} aria-hidden="true">{bubble}</div>
      )}
      <div className="companion__orb" aria-hidden="true">
        <MarbleSprite
          background="#0b1033"
          spriteColor="#3d52a0"
          scale={128}
          follow="page"
          frost={5}
          float={working ? 15 : 10}
          blink={working ? 4 : 10}
          reach={mood === "puzzled" ? 4 : 10}
          happy={mood === "happy"}
          advanced={{ restX: 0, roll: mood === "puzzled" ? 25 : 0, grain: 60, followMs: working ? 160 : 90 }}
        />
      </div>
    </aside>
  )
}