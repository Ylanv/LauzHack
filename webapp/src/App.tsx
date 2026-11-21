import { useCallback, useEffect, useRef, useState } from "react"
import Companion, { type Mood } from "./components/Companion"
import FormScreen from "./components/FormScreen"
import Flight from "./components/Flight"
import DoneScreen from "./components/DoneScreen"
import ReviewBar from "./components/ReviewBar"
import { MapFlight } from "./lib/mapFlight"
import { paintBackground, paintFish } from "./lib/background"
import { clamp, reducedMotion } from "./lib/utils"
import { MOCK, INSIGHTS } from "./pipeline/mock"
import { collectEvidence } from "./pipeline"
import type { Coords, FlightInput, RequestInput, StepId } from "./pipeline/types"

type Screen = "form" | "proc" | "done"
const TOTAL = Math.max(...MOCK.steps.map((s) => s.start + s.dur))
const STEP = (id: StepId) => MOCK.steps.find((s) => s.id === id)!
const prog = (id: StepId, tv: number) => clamp((tv - STEP(id).start) / STEP(id).dur, 0, 1)

function flightInput(tv: number): FlightInput {
  const p = (id: StepId) => prog(id, tv)
  if (p("identity") < 1) return { step: "identity", progress: p("identity") }
  if (tv < STEP("building").start) return { step: "identity_done", progress: 0 }
  if (p("building") < 1 || p("hazard") < 1) return { step: "zoom", progress: (p("building") + p("hazard")) / 2 }
  if (p("aerial") < 1) return { step: "focus", progress: p("aerial") }
  if (p("file") < 1 || p("industry") < 1) return { step: "scan", progress: p("file") }
  return { step: "done", progress: 1 }
}

export default function App() {
  const [screen, setScreen] = useState<Screen>("form")
  const [input, setInput] = useState<RequestInput | null>(null)
  const [refId, setRefId] = useState(MOCK.ref)
  const [mood, setMood] = useState<Mood>("idle")
  const [bubble, setBubble] = useState<{ t: string; n: number }>({ t: "", n: 0 })
  const [live, setLive] = useState("")
  const [stepState, setStepState] = useState<Record<string, string>>({})
  const [current, setCurrent] = useState("Starting")
  const [fade, setFade] = useState(false)
  const [skipped, setSkipped] = useState(reducedMotion())
  const qp = new URLSearchParams(location.search)
  const [variant, setVariant] = useState<"A" | "B">(qp.get("ui") === "B" ? "B" : "A")
  const [pause, setPause] = useState(qp.get("pause") !== "0")   // review mode: hold the map when it has finished processing
  const [held, setHeld] = useState(false)
  const pauseRef = useRef(pause); pauseRef.current = pause
  const run = useRef<any>(null)
  const coords = useRef<Coords>({ ...MOCK.coords })
  const screenRef = useRef<Screen>("form")
  screenRef.current = screen
  const moodTimer = useRef<number>()

  const say = useCallback((t: string, m?: Mood) => {
    setBubble((b) => ({ t, n: b.n + 1 }))
    if (m) { setMood(m); window.clearTimeout(moodTimer.current); moodTimer.current = window.setTimeout(() => setMood(screenRef.current === "proc" ? "working" : "idle"), 1800) }
  }, [])

  const finish = useCallback(() => {
    setScreen("done"); setMood("happy"); say(MOCK.speech.done!)
    window.clearTimeout(moodTimer.current); moodTimer.current = window.setTimeout(() => setMood("idle"), 5000)
    setLive("Your request has been sent")
  }, [say])

  useEffect(() => { MapFlight.setVariant(variant) }, [variant])
  useEffect(() => { MapFlight.setFree(held) }, [held])

  // send the file on (end of the waiting screen)
  const complete = useCallback(() => {
    setHeld(false)
    const r = run.current; if (!r) return
    r.data.then((d: { ref: string }) => { setRefId(d.ref) }).finally(() => setTimeout(() => { setFade(true); setTimeout(finish, 650) }, 900))
  }, [finish])

  const start = (i: RequestInput, c: Coords) => {
    coords.current = c
    setInput(i); setScreen("proc"); setMood("working"); setStepState({}); setCurrent("Starting"); setFade(false); setHeld(false)
    ;MapFlight.reset(); MapFlight.update({ step: "identity", progress: 0, coords: c })
    setLive("Preparing your file")
    run.current = { tv: Number(new URLSearchParams(location.search).get("at")) || 0, last: performance.now(), done: false, said: {}, ins: {}, st: {}, data: collectEvidence(i) }
    scrollTo(0, 0)
  }

  // dev helper: /?autorun starts the demo case immediately (optionally /?autorun&at=14 to jump ahead in the sequence)
  useEffect(() => { if (new URLSearchParams(location.search).has("autorun")) start({ ...MOCK.sample }, { ...MOCK.coords }) }, []) // eslint-disable-line

  // single animation loop: pipeline simulation + globe on the waiting screen, background otherwise
  useEffect(() => {
    let raf = 0, lastBg = 0
    const reduced = reducedMotion()
    MapFlight.setStatic(reduced)
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (screenRef.current === "proc") {
        const r = run.current
        if (r && !r.done) {
          r.tv = Math.min((() => { const h = location.search.match(/hold=?([\d.]*)/); return h ? (h[1] ? +h[1] : 15) : TOTAL })(), r.tv + clamp((now - r.last) / 1000, 0, 0.25)); r.last = now
          let changed = false
          MOCK.steps.forEach((s) => {
            const st = r.tv < s.start ? "wait" : r.tv < s.start + s.dur ? "run" : "done"
            if (r.st[s.id] !== st) {
              r.st[s.id] = st; changed = true
              if (st === "run") r.said[s.id] = 1
              if (st === "done") setLive(s.label + " done")
            }
          })
          if (changed) setStepState({ ...r.st })
          INSIGHTS.forEach((d) => { if (!r.ins[d.id] && prog(d.at[0], r.tv) >= d.at[1]) { r.ins[d.id] = 1; MapFlight.pushInsight(d) } })
          MapFlight.update({ ...flightInput(r.tv), coords: coords.current })
          const cur = MOCK.steps.filter((s) => r.tv >= s.start && r.tv < s.start + s.dur).pop()
          setCurrent(cur ? cur.label : "Finishing")
          if (r.tv >= TOTAL) {
            r.done = true
            if (pauseRef.current) setHeld(true); else complete()
          }
        }
        MapFlight.frame(now)
      } else if (!reduced) { if (now - lastBg > 45) { lastBg = now; paintBackground(now / 1000) } paintFish(now / 1000) }
    }
    paintBackground(14)
    if (reduced) paintFish(2)
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [say, finish, complete])

  // the companion narrates the pipeline: last finished steps, then the one running now
  const status = screen === "proc" ? { done: MOCK.steps.filter((s) => stepState[s.id] === "done").map((s) => s.label).slice(-2), now: held ? "File complete" : current, complete: held } : null
  const skip = () => { MapFlight.setStatic(true); setSkipped(true) }
  const again = () => { setScreen("form"); setMood("idle") }

  return (
    <>
      <canvas id="bg" width={200} height={112} aria-hidden="true" />
      <canvas id="fish" aria-hidden="true" />
      <div className="vh" aria-live="polite">{live}</div>
      <div className="shell" style={{ visibility: screen === "proc" ? "hidden" : undefined }}>
        <header className="brand">
          <i><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round"><path d="M3 11l9-7 9 7v9H3z" /><path d="M9 20v-6h6v6" /></svg></i>
          Alpenmark<span>Building insurance</span>
        </header>
        <main>
          {screen === "form" && <FormScreen onSubmit={start} say={say} />}
          {screen === "done" && input && <DoneScreen input={input} refId={refId} onAgain={again} />}
        </main>
        <footer className="foot">Background fish: the ASCII betta by @dwcminh.ascii (github.com/dwcminh/ascii-art), recoloured, used for a personal, non-commercial prototype. All companies and people shown are fictional.</footer>
      </div>
      <Flight hidden={screen !== "proc"} fade={fade} skipped={skipped} onSkip={skip}>
        <ReviewBar variant={variant} onVariant={setVariant} pause={pause} onPause={(v) => { setPause(v); if (!v && held) complete() }} held={held} onContinue={complete} />
      </Flight>
      <Companion mood={mood} bubble={bubble.t} bubbleKey={bubble.n} status={status} />
    </>
  )
}