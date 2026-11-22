import { useState } from "react"

export interface DemoActions {
  form: () => void; waiting: () => void; confirmation: () => void; error: () => void
  emotion: (k: "hint" | "happy" | "concerned" | "error" | "success") => void
}

/** /demo.html only: jump to every part of the client flow and play every companion emotion. No backend, no key. */
export default function DemoPanel({ a, screen }: { a: DemoActions; screen: string }) {
  const [open, setOpen] = useState(true)
  return (
    <div className={"demo" + (open ? "" : " closed")} role="region" aria-label="Demo controls">
      <button type="button" className="demo__head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <b>Demo</b><span>no backend · no key</span><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={open ? "M6 15l6-6 6 6" : "M6 9l6 6 6-6"} /></svg>
      </button>
      {open && <div className="demo__body">
        <p>Screens</p>
        <div className="demo__row">
          <button type="button" className={screen === "form" ? "on" : ""} onClick={a.form}>Form</button>
          <button type="button" className={screen === "proc" ? "on" : ""} onClick={a.waiting}>Waiting screen</button>
          <button type="button" className={screen === "done" ? "on" : ""} onClick={a.confirmation}>Confirmation</button>
          <button type="button" onClick={a.error}>Error</button>
        </div>
        <p>Companion</p>
        <div className="demo__row">
          {(["hint", "happy", "concerned", "error", "success"] as const).map((k) => <button key={k} type="button" onClick={() => a.emotion(k)}>{k[0].toUpperCase() + k.slice(1)}</button>)}
        </div>
      </div>}
    </div>
  )
}