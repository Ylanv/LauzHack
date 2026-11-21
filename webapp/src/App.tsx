import { useCallback, useEffect, useRef, useState } from "react"
import Companion, { type Mood } from "./components/Companion"
import FormScreen, { type ServerError } from "./components/FormScreen"
import Flight from "./components/Flight"
import DoneScreen from "./components/DoneScreen"
import ReviewBar from "./components/ReviewBar"
import { MapFlight } from "./lib/mapFlight"
import { paintBackground, paintFish } from "./lib/background"
import { clamp, reducedMotion } from "./lib/utils"
import { MOCK, INSIGHTS } from "./pipeline/mock"
import { DEMO, getIndustries, startReport, reportStatus, progressError, AssessError, type ReportProgress } from "./pipeline"
import type { Coords, FlightInput, RequestInput, StepId } from "./pipeline/types"

const STAGE_LABEL: Record<string, string> = {
  etl: "Collecting building and company data",
  features: "Putting the file together",
  llm: "Writing the report",
  validate: "Checking the report",
}

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
  const [activity, setActivity] = useState("")
  const [formInit, setFormInit] = useState<{ input: RequestInput; coords: Coords; picked: string } | null>(null)
  const [serverError, setServerError] = useState<ServerError | null>(null)
  const [formKey, setFormKey] = useState(0)
  const [mood, setMood] = useState<Mood>("idle")
  const [bubble, setBubble] = useState<{ t: string; n: number }>({ t: "", n: 0 })
  const [live, setLive] = useState("")
  const [stepState, setStepState] = useState<Record<string, string>>({})
  const [current, setCurrent] = useState("Starting")
  const [progress, setProgress] = useState<ReportProgress | null>(null)
  const [fade, setFade] = useState(false)
  const [skipped, setSkipped] = useState(reducedMotion())
  const qp = new URLSearchParams(location.search)
  const [variant, setVariant] = useState<"A" | "B">(qp.get("ui") === "A" ? "A" : "B")   // B chosen by the team; ?ui=A keeps the satellite-window layout for comparison
  const [pause, setPause] = useState(qp.get("pause") !== "0")   // review mode: hold the map when it has finished processing
  const [held, setHeld] = useState(false)
  const [job, setJob] = useState<string | null>(null)   // report job id: link to the underwriter dashboard (team review only)
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
    if (!run.current) return
    setTimeout(() => { setFade(true); setTimeout(finish, 650) }, 900)
  }, [finish])

  const start = (i: RequestInput, c: Coords, accessCode: string, activityLabel: string) => {
    coords.current = c; setServerError(null)
    setInput(i); setScreen("proc"); setMood("working"); setStepState({}); setCurrent("Starting"); setFade(false); setHeld(false); setJob(null)
    setActivity(activityLabel); setProgress(null)
    ;MapFlight.reset(); MapFlight.update({ step: "identity", progress: 0, coords: c })
    setLive("Preparing your file")
    const r = run.current = { tv: Number(new URLSearchParams(location.search).get("at")) || 0, last: performance.now(), done: false, ins: {}, st: {}, live: DEMO ? "ok" : "pending", etlDone: false, err: null as AssessError | null, input: i, coords: c }
    // live: one report job per submission (ETL → LLM report → validation); the waiting screen follows its real stages
    // and only completes once the report has been generated and stored for the team (demo flow: simulated)
    if (!DEMO) {
      const fail = (e: unknown) => { if (run.current === r) { r.live = "error"; r.err = e instanceof AssessError ? e : new AssessError("service", "The assessment service had a problem. Your details are kept, please try again.") } }
      let misses = 0
      const poll = (id: string) => {
        if (run.current !== r) return
        reportStatus(id).then((p) => {
          if (run.current !== r) return
          misses = 0
          setProgress(p)
          r.etlDone = p.done_stages.includes("etl")
          if (p.status === "succeeded") { r.live = "ok"; setJob(id) }
          else if (p.status === "running") setTimeout(() => poll(id), 1500)
          else fail(progressError(p))
        }).catch(() => { if (++misses >= 5) fail(new AssessError("service", "We lost the connection to the assessment service. Your details are kept, please try again.")); else setTimeout(() => poll(id), 2500) })
      }
      startReport(i, accessCode).then(poll).catch(fail)
    }
    scrollTo(0, 0)
  }

  // dev helper: /?autorun starts the demo case immediately (optionally /?autorun&at=14 to jump ahead in the sequence)
  useEffect(() => {
    if (!new URLSearchParams(location.search).has("autorun")) return
    getIndustries().catch(() => []).then((list) => {
      const label = list.find((x) => x.key === MOCK.sample.industry)?.label ?? MOCK.sample.industry
      if (screenRef.current === "form" && !run.current) start({ ...MOCK.sample }, { ...MOCK.coords }, "", label)
    })
  }, []) // eslint-disable-line

  useEffect(() => {
    if (progress?.status === "running" && progress.stage && STAGE_LABEL[progress.stage]) {
      setLive(STAGE_LABEL[progress.stage])
    }
  }, [progress?.status, progress?.stage])

  // single animation loop: pipeline simulation + globe on the waiting screen, background otherwise
  useEffect(() => {
    let raf = 0, lastBg = 0
    const reduced = reducedMotion()
    MapFlight.setStatic(reduced)
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop)
      if (screenRef.current === "proc") {
        const r = run.current
        if (r && !r.done && r.live === "error") {   // back to the form, values kept, with what went wrong
          r.done = true; run.current = null
          setFormInit({ input: r.input, coords: r.coords, picked: r.input.address }); setServerError({ kind: r.err.kind, message: r.err.message }); setFormKey((k) => k + 1)
          setScreen("form"); setMood("puzzled"); setLive(r.err.message)
          window.clearTimeout(moodTimer.current); moodTimer.current = window.setTimeout(() => setMood("idle"), 2500)
        } else if (r && !r.done) {
          // the timeline never runs ahead of the backend: while the ETL runs it waits before the last step; once the ETL
          // is done it waits inside "Putting the file together" (report writing); it ends only when the report is valid
          const cap = r.live === "ok" ? TOTAL : r.etlDone ? STEP("file").start + STEP("file").dur * 0.6 : STEP("file").start - 0.3
          const hold = (() => { const h = location.search.match(/hold=?([\d.]*)/); return h ? (h[1] ? +h[1] : 15) : TOTAL })()
          r.tv = Math.min(hold, cap, r.tv + clamp((now - r.last) / 1000, 0, 0.25) * (r.live === "ok" && !DEMO ? 2.5 : 1)); r.last = now
          if (DEMO) {
            let changed = false
            for (const s of MOCK.steps) {
              const st = r.tv < s.start ? "wait" : r.tv < s.start + s.dur ? "run" : "done"
              if (r.st[s.id] !== st) {
                r.st[s.id] = st; changed = true
                if (st === "done") setLive(s.label + " done")
              }
            }
            if (changed) setStepState({ ...r.st })
            INSIGHTS.forEach((d) => { if (!r.ins[d.id] && prog(d.at[0], r.tv) >= d.at[1]) { r.ins[d.id] = 1; MapFlight.pushInsight(d) } })
            const cur = MOCK.steps.filter((s) => r.tv >= s.start && r.tv < s.start + s.dur).pop()
            setCurrent(cur ? cur.label : "Finishing")
          }
          MapFlight.update({ ...flightInput(r.tv), coords: coords.current })
          if (r.tv >= TOTAL) {
            r.done = true
            if (pauseRef.current) setHeld(true); else complete()
          }
        }
        MapFlight.frame(now)
      } else { if (!reduced && now - lastBg > 45) { lastBg = now; paintBackground(now / 1000) } paintFish(reduced) }
    }
    paintBackground(14)
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [say, finish, complete])

  const doneSteps = DEMO
    ? MOCK.steps.filter((s) => stepState[s.id] === "done").map((s) => s.label)
    : (progress?.done_stages ?? []).map((stage) => STAGE_LABEL[stage]).filter(Boolean)
  const runningStep = DEMO ? current : STAGE_LABEL[progress?.stage ?? ""] ?? "Starting"
  const completeReport = held || progress?.status === "succeeded"
  const status = screen === "proc" ? { done: doneSteps.slice(-2), now: completeReport ? "File complete" : runningStep, complete: completeReport } : null
  const skip = () => { MapFlight.setStatic(true); setSkipped(true) }
  const again = () => { setFormInit(null); setServerError(null); setFormKey((k) => k + 1); setScreen("form"); setMood("idle") }

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
          {screen === "form" && <FormScreen key={formKey} onSubmit={start} say={say} initial={formInit} serverError={serverError} />}
          {screen === "done" && input && <DoneScreen input={input} activity={activity} onAgain={again} />}
        </main>
      </div>
      <Flight hidden={screen !== "proc"} fade={fade} skipped={skipped} onSkip={skip}>
        <ReviewBar variant={variant} onVariant={setVariant} pause={pause} onPause={(v) => { setPause(v); if (!v && held) complete() }} held={held} onContinue={complete} reportHref={job ? `/dashboard.html?case=${encodeURIComponent(job)}` : undefined} />
      </Flight>
      <Companion mood={mood} bubble={bubble.t} bubbleKey={bubble.n} status={status} />
    </>
  )
}
