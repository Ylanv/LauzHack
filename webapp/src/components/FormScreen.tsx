import { useEffect, useRef, useState } from "react"
import { esc } from "../lib/utils"
import { norm, searchAddress, coordsFor, type AddressHit } from "../lib/address"
import { MOCK } from "../pipeline/mock"
import type { Coords, RequestInput } from "../pipeline/types"

type Key = "contact" | "company" | "address"
interface Props { onSubmit: (i: RequestInput, c: Coords) => void; say: (t: string, mood?: "puzzled") => void }

const HINTS: Record<Key, string> = { contact: "Who should we get back to?", company: "The name as in the commercial register.", address: "An exact address lets us find the building." }

export default function FormScreen({ onSubmit, say }: Props) {
  const [v, setV] = useState<RequestInput>({ contact: "", company: "", address: "" })
  const [err, setErr] = useState<Partial<Record<Key, string>>>({})
  const [items, setItems] = useState<AddressHit[]>([])
  const [open, setOpen] = useState(false)
  const [idx, setIdx] = useState(-1)
  const coords = useRef<Coords>({ ...MOCK.coords })
  const seq = useRef(0)
  const timer = useRef<number>()
  const refs = { contact: useRef<HTMLInputElement>(null), company: useRef<HTMLInputElement>(null), address: useRef<HTMLInputElement>(null) }

  useEffect(() => { refs.contact.current?.focus({ preventScroll: true }) }, [])

  const set = (k: Key, val: string) => { setV((p) => ({ ...p, [k]: val })); setErr((p) => ({ ...p, [k]: "" })) }

  const onAddress = (val: string) => {
    set("address", val)
    coords.current = { ...MOCK.coords }
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
    coords.current = coordsFor(x)
    say("Found it. We will fly there.")
  }
  const onKey = (e: React.KeyboardEvent) => {
    const n = items.length
    if (e.key === "ArrowDown" && open && n) { e.preventDefault(); setIdx((idx + 1) % n) }
    else if (e.key === "ArrowUp" && open && n) { e.preventDefault(); setIdx((idx - 1 + n) % n) }
    else if (e.key === "Enter" && open && idx >= 0) { e.preventDefault(); pick(idx) }
    else if (e.key === "Escape" && open) { e.preventDefault(); setOpen(false) }
  }

  const validate = () => {
    const a = v.address
    const e: Partial<Record<Key, string>> = {
      contact: v.contact ? "" : "Please enter your name.",
      company: v.company ? "" : "Please enter the company's legal name.",
      address: !a ? "Please enter the building address." : /\b[1-9]\d{3}\b/.test(a) && /\d/.test(a.replace(/\b[1-9]\d{3}\b/, "")) ? "" : "Add the street number and the 4-digit postcode, for example 1950 Sion.",
    }
    setErr(e)
    const first = (["contact", "company", "address"] as Key[]).find((k) => e[k])
    if (first) { refs[first].current?.focus(); say("Check the highlighted field.", "puzzled") }
    return !first
  }
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault()
    const t = { contact: v.contact.trim(), company: v.company.trim(), address: v.address.trim() }
    setV(t)
    if (validate()) onSubmit(t, coords.current)
  }
  const demo = () => { setV({ ...MOCK.sample }); setErr({}); coords.current = { ...MOCK.coords }; say("Demo case filled in.") }

  const field = (k: Key, label: string, ph: string, ac: string) => (
    <div className={"fld" + (err[k] ? " bad" : "")} id={"f-" + k}>
      <label htmlFor={k}>{label}</label>
      <input id={k} ref={refs[k]} value={v[k]} autoComplete={ac} placeholder={ph} aria-invalid={!!err[k]} aria-describedby={"e-" + k}
        onChange={(e) => set(k, e.target.value)} onFocus={() => say(HINTS[k])} />
      <span className="ferr" id={"e-" + k}>{err[k]}</span>
    </div>
  )

  return (
    <section className="card" aria-labelledby="h-form">
      <p className="eyebrow">Commercial building insurance</p>
      <h1 id="h-form">Request a building pre-assessment</h1>
      <p className="lede">Tell us who you are and which building you want to insure. We prepare the file for you.</p>
      <form onSubmit={submit} noValidate>
        {field("contact", "Your name", "Claire Moret", "name")}
        {field("company", "Company legal name", "Valtherm Composants SA", "organization")}
        <div className={"fld" + (err.address ? " bad" : "")} id="f-address">
          <label htmlFor="address">Building address</label>
          <div className="cb">
            <input id="address" ref={refs.address} value={v.address} autoComplete="off" role="combobox" aria-autocomplete="list"
              aria-expanded={open} aria-controls="acList" aria-activedescendant={idx >= 0 ? "ac-" + idx : undefined}
              placeholder="Rue de l'Industrie 21, 1950 Sion" aria-describedby="h-address e-address" aria-invalid={!!err.address}
              onChange={(e) => onAddress(e.target.value)} onKeyDown={onKey} onFocus={() => say(HINTS.address)} onBlur={() => setTimeout(() => setOpen(false), 120)} />
            <ul id="acList" role="listbox" aria-label="Matching addresses" hidden={!open}>
              {!items.length ? <li className="acn" role="option" aria-disabled="true">No matching address. Keep typing the street, number and town.</li> :
                items.map((x, i) => {
                  const n = norm(v.address).trim(), pos = norm(x.text).indexOf(n)
                  return (
                    <li key={x.text} role="option" id={"ac-" + i} aria-selected={i === idx} onMouseDown={(e) => { e.preventDefault(); pick(i) }}>
                      <span>{pos === 0 ? <><b>{x.text.slice(0, n.length)}</b>{x.text.slice(n.length)}</> : x.text}</span>
                      <small>{x.live ? "geo.admin.ch" : "example"}</small>
                    </li>
                  )
                })}
            </ul>
          </div>
          <small id="h-address">Street, number, postcode and town, in Switzerland.</small>
          <span className="ferr" id="e-address">{err.address}</span>
        </div>
        <div className="actions">
          <button className="btn" type="submit">Send request</button>
          <button className="link" type="button" onClick={demo}>Fill with the demo case</button>
        </div>
      </form>
      <p className="fineprint">We only use public registers and the company's own public information.</p>
    </section>
  )
}
void esc