import { useEffect, useRef, useState } from "react"
import { norm, searchAddress, coordsFor, type AddressHit } from "../lib/address"
import { MOCK } from "../pipeline/mock"
import { DEMO, getIndustries, accessCodeRequired, type Industry, type AssessErrorKind } from "../pipeline"
import type { Coords, RequestInput } from "../pipeline/types"

type Key = "contact" | "company" | "address" | "industry" | "code"
export interface ServerError { kind: AssessErrorKind; message: string }
interface Props {
  onSubmit: (i: RequestInput, c: Coords, accessCode: string) => void
  say: (t: string, mood?: "puzzled") => void
  /** values of the previous attempt: kept after an error */
  initial?: { input: RequestInput; coords: Coords; picked: string } | null
  serverError?: ServerError | null
}

const GE = 25   // canton of Geneva: the only scope of the assessment for now
const HINTS: Record<Key, string> = { contact: "Who should we get back to?", company: "Exactly as in the commercial register.", address: "Pick the address in the list.", industry: "What does the business mainly do?", code: "Your team gave you this code." }

export default function FormScreen({ onSubmit, say, initial, serverError }: Props) {
  const [v, setV] = useState<RequestInput>(initial?.input ?? { contact: "", company: "", address: "", industry: "" })
  const [code, setCode] = useState("")
  const [err, setErr] = useState<Partial<Record<Key, string>>>({})
  const [items, setItems] = useState<AddressHit[]>([])
  const [open, setOpen] = useState(false)
  const [idx, setIdx] = useState(-1)
  const [inds, setInds] = useState<Industry[] | null>(null)
  const [indsFailed, setIndsFailed] = useState(false)
  const [needCode, setNeedCode] = useState(serverError?.kind === "code")
  const coords = useRef<Coords | null>(initial?.coords ?? null)
  const picked = useRef<string>(initial?.picked ?? "")   // the address text chosen from the list (a free-typed text is not accepted)
  const seq = useRef(0)
  const timer = useRef<number>()
  const refs = { contact: useRef<HTMLInputElement>(null), company: useRef<HTMLInputElement>(null), address: useRef<HTMLInputElement>(null), industry: useRef<HTMLSelectElement>(null), code: useRef<HTMLInputElement>(null) }

  const loadIndustries = () => { setIndsFailed(false); getIndustries().then(setInds).catch(() => setIndsFailed(true)) }
  useEffect(() => {
    loadIndustries()
    accessCodeRequired().then((x) => setNeedCode((p) => p || x)).catch(() => { /* unknown: the server answers 401 if a code is needed */ })
    const k: Key = serverError?.kind === "code" ? "code" : serverError?.kind === "input" ? "address" : "contact"
    setTimeout(() => refs[k].current?.focus({ preventScroll: true }), 0)
  }, []) // eslint-disable-line

  const set = (k: Key, val: string) => { setV((p) => ({ ...p, [k]: val })); setErr((p) => ({ ...p, [k]: "" })) }

  const outOfScope = (c: Coords | null) => !!c && c.cantonId !== GE
  const onAddress = (val: string) => {
    set("address", val)
    coords.current = null; picked.current = ""
    window.clearTimeout(timer.current)
    if (val.trim().length < 2) { setOpen(false); return }
    const my = ++seq.current
    timer.current = window.setTimeout(async () => {
      const r = await searchAddress(val)
      if (my !== seq.current) return
      setItems(r); setIdx(-1); setOpen(true)
    }, 140)
  }
  const pick = (i: number) => {
    const x = items[i]; if (!x) return
    set("address", x.text); setOpen(false)
    coords.current = coordsFor(x); picked.current = x.text
    if (outOfScope(coords.current)) { setErr((p) => ({ ...p, address: `This building is in ${coords.current!.label}. We can only assess buildings in the canton of Geneva for now.` })); say("That one is outside Geneva.", "puzzled") }
    else say("Found it. We will fly there.")
  }
  const onKey = (e: React.KeyboardEvent) => {
    const n = items.length
    if (e.key === "ArrowDown" && open && n) { e.preventDefault(); setIdx((idx + 1) % n) }
    else if (e.key === "ArrowUp" && open && n) { e.preventDefault(); setIdx((idx - 1 + n) % n) }
    else if (e.key === "Enter" && open && idx >= 0) { e.preventDefault(); pick(idx) }
    else if (e.key === "Escape" && open) { e.preventDefault(); setOpen(false) }
  }

  const validate = (t: RequestInput) => {
    const e: Partial<Record<Key, string>> = {
      contact: t.contact ? "" : "Please enter your name.",
      company: t.company ? "" : "Please enter the company's exact registered name.",
      address: !t.address ? "Please enter the building address."
        : !picked.current || picked.current !== t.address || !coords.current ? "Choose the exact address (street, number, postcode, town) in the list."
        : outOfScope(coords.current) ? "We can only assess buildings in the canton of Geneva for now." : "",
      industry: t.industry ? "" : "Please choose the main activity of the business.",
      code: needCode && !code.trim() ? "Please enter the access code." : "",
    }
    setErr(e)
    const first = (["contact", "company", "address", "industry", "code"] as Key[]).find((k) => e[k])
    if (first) { refs[first].current?.focus(); say("Check the highlighted field.", "puzzled") }
    return !first
  }
  const submit = (ev?: React.FormEvent) => {
    ev?.preventDefault()
    const t = { contact: v.contact.trim(), company: v.company.trim(), address: v.address.trim(), industry: v.industry }
    setV(t)
    if (validate(t)) onSubmit(t, coords.current!, code.trim())
  }
  const demo = () => {
    setV({ ...MOCK.sample }); setErr({})
    coords.current = { ...MOCK.coords }; picked.current = MOCK.sample.address
    say("Demo case filled in.")
  }

  const field = (k: "contact" | "company", label: string, ph: string, ac: string, help?: string) => (
    <div className={"fld" + (err[k] ? " bad" : "")} id={"f-" + k}>
      <label htmlFor={k}>{label}</label>
      <input id={k} ref={refs[k]} value={v[k]} autoComplete={ac} placeholder={ph} aria-invalid={!!err[k]} aria-describedby={(help ? "h-" + k + " " : "") + "e-" + k}
        onChange={(e) => set(k, e.target.value)} onFocus={() => say(HINTS[k])} />
      {help && <small id={"h-" + k}>{help}</small>}
      <span className="ferr" id={"e-" + k}>{err[k]}</span>
    </div>
  )

  return (
    <section className="card" aria-labelledby="h-form">
      <header className="card-h">
        <h1 id="h-form">Request a building pre-assessment</h1>
        <p className="lede">Commercial buildings in the canton of Geneva.</p>
      </header>
      <form onSubmit={submit} noValidate>
      <div className="card-b">
      {serverError && (
        <div className={"banner" + (serverError.kind === "service" ? " retry" : "")} role="alert">
          <span>{serverError.message}</span>
          {serverError.kind === "service" && <button type="button" className="btn small" onClick={() => submit()}>Try again</button>}
        </div>
      )}
        {field("contact", "Your name", "Marie Dupont", "name")}
        {field("company", "Company legal name", "CMDS SA", "organization")}
        <div className={"fld" + (err.address ? " bad" : "")} id="f-address">
          <label htmlFor="address">Address of the business premises</label>
          <div className="cb">
            <input id="address" ref={refs.address} value={v.address} autoComplete="off" role="combobox" aria-autocomplete="list"
              aria-expanded={open} aria-controls="acList" aria-activedescendant={idx >= 0 ? "ac-" + idx : undefined}
              placeholder="Rue du Champ-Blanchod 7, 1228 Plan-les-Ouates" aria-describedby="e-address" aria-invalid={!!err.address}
              onChange={(e) => onAddress(e.target.value)} onKeyDown={onKey} onFocus={() => say(HINTS.address)} onBlur={() => setTimeout(() => setOpen(false), 120)} />
            <ul id="acList" role="listbox" aria-label="Matching addresses" hidden={!open}>
              {!items.length ? <li className="acn" role="option" aria-disabled="true">No matching address. Keep typing the street, number and town.</li> :
                items.map((x, i) => {
                  const n = norm(v.address).trim(), pos = norm(x.text).indexOf(n)
                  return (
                    <li key={x.text} role="option" id={"ac-" + i} aria-selected={i === idx} onMouseDown={(e) => { e.preventDefault(); pick(i) }}>
                      <span>{pos === 0 ? <><b>{x.text.slice(0, n.length)}</b>{x.text.slice(n.length)}</> : x.text}</span>
                    </li>
                  )
                })}
            </ul>
          </div>
          <span className="ferr" id="e-address">{err.address}</span>
        </div>
        <div className={"fld" + (err.industry ? " bad" : "")} id="f-industry">
          <label htmlFor="industry">Main activity of the business</label>
          <select id="industry" ref={refs.industry} value={v.industry} required aria-invalid={!!err.industry} aria-describedby="e-industry"
            disabled={!inds} onChange={(e) => set("industry", e.target.value)} onFocus={() => say(HINTS.industry)}>
            <option value="">{inds ? "Choose an activity" : indsFailed ? "Activities could not be loaded" : "Loading activities…"}</option>
            {inds?.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
          {indsFailed && <button type="button" className="link small" onClick={loadIndustries}>Load the activities again</button>}
          <span className="ferr" id="e-industry">{err.industry}</span>
        </div>
        {needCode && (
          <div className={"fld" + (err.code ? " bad" : "")} id="f-code">
            <label htmlFor="code">Access code</label>
            <input id="code" ref={refs.code} type="password" value={code} autoComplete="off" aria-invalid={!!err.code} aria-describedby="e-code"
              onChange={(e) => { setCode(e.target.value); setErr((p) => ({ ...p, code: "" })) }} onFocus={() => say(HINTS.code)} />
            <span className="ferr" id="e-code">{err.code}</span>
          </div>
        )}
        {DEMO && <p className="desc">Demo mode: nothing is sent, the assessment is simulated.</p>}
      </div>
      <footer className="card-f">
        <button className="btn outline" type="button" onClick={demo}>Fill with the demo case</button>
        <button className="btn" type="submit">Send request</button>
      </footer>
      </form>
    </section>
  )
}
