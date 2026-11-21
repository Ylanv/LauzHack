import { useEffect, useRef } from "react"
import type { RequestInput } from "../pipeline/types"

export default function DoneScreen({ input, refId, onAgain }: { input: RequestInput; refId: string; onAgain: () => void }) {
  const h = useRef<HTMLHeadingElement>(null)
  useEffect(() => { h.current?.focus({ preventScroll: true }) }, [])
  const rows: [string, string][] = [["Reference", refId], ["Contact", input.contact], ["Company", input.company], ["Building", input.address]]
  return (
    <section className="card done" aria-labelledby="h-done">
      <div className="tick"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></div>
      <h1 id="h-done" tabIndex={-1} ref={h}>Your request has been sent</h1>
      <p className="lede">Thank you. Our team has received it and will contact you shortly to follow up.</p>
      <dl className="recap">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      <div className="actions" style={{ marginTop: 22 }}><button className="btn" type="button" onClick={onAgain}>Send another request</button></div>
    </section>
  )
}