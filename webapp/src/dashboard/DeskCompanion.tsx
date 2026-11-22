import { useEffect, useRef, useState } from "react"
import AxolotlMascot, { mascotNow } from "../mascot/AxolotlMascot"
import { MascotEmotionController, type BaseEmotion, type Reaction } from "../mascot/emotion"

/** One line said by the ticket-desk companion, with the emotion that goes with it. `n` re-plays the same line. */
export interface DeskLine { text: string; base?: BaseEmotion; react?: Reaction; n: number }

/** The AXA axolotl docked on the ticket desk: follows the cursor, and its face matches what its bubble says. */
export default function DeskCompanion({ line }: { line: DeskLine | null }) {
  const ctl = useRef<MascotEmotionController>()
  ctl.current ??= new MascotEmotionController()
  const emo = ctl.current
  const [shown, setShown] = useState(false)
  const timer = useRef<number>()

  useEffect(() => {
    if (!line) return
    emo.setBase(line.base ?? "idle")
    if (line.react) emo.react(line.react, mascotNow())
    setShown(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setShown(false), 4200)
    return () => window.clearTimeout(timer.current)
  }, [emo, line])

  return (
    <aside className="jr-buddy no-print" aria-live="polite">
      <div className={"jr-buddy__bubble" + (shown && line ? " show" : "")}>{line?.text}</div>
      <div className="jr-buddy__mascot" aria-hidden="true"><AxolotlMascot controller={emo} tracking /></div>
    </aside>
  )
}
