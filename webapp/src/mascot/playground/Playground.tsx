import { useEffect, useRef, useState } from "react"
import AxolotlMascot, { mascotNow } from "../AxolotlMascot"
import { MascotEmotionController, type BaseEmotion, type Emotion, type Reaction } from "../emotion"
import type { LoadingSnapshot, LoadingTask, MascotEvent, TaskStatus } from "../loadingAdapter"
import "./playground.css"

/** Dev-only page (/mascot.html): every emotion, size and background, and a simulated task list that goes through the
 *  same MascotLoadingAdapter as the real loading screen. No backend calls. */

const SIZES = [56, 80, 112, 160]
const TASKS = ["Checking the company", "Reading the building record", "Checking natural hazards", "Looking at the roof", "Putting the file together"]
type Bg = "light" | "map" | "satellite"

// SWISSIMAGE tiles around the demo address (Plan-les-Ouates), same imagery as the end of the waiting screen
const TILE = { z: 17, x: 67758, y: 46541 }

export default function Playground() {
  const [ctl] = useState(() => new MascotEmotionController())
  const [emotion, setEmotion] = useState<Emotion>("idle")
  const [tracking, setTracking] = useState(true)
  const [idle, setIdle] = useState(true)
  const [reduced, setReduced] = useState<boolean | undefined>(undefined)
  const [bg, setBg] = useState<Bg>("light")
  const [run, setRun] = useState(1)
  const [tasks, setTasks] = useState<LoadingTask[]>(() => TASKS.map((id) => ({ id, status: "pending" })))
  const [outcome, setOutcome] = useState<LoadingSnapshot["outcome"]>("running")
  const [log, setLog] = useState<string[]>([])
  const timers = useRef<number[]>([])

  useEffect(() => ctl.subscribe(setEmotion), [ctl])
  const note = (s: string) => setLog((l) => [`${(mascotNow() % 1000).toFixed(2)}s  ${s}`, ...l].slice(0, 40))
  const onEvents = (ev: MascotEvent[]) => ev.forEach((e) => note("event " + e.type + ("id" in e ? ` (${e.id})` : "")))

  const loading: LoadingSnapshot = { runId: run, tasks, outcome }
  const setStatus = (ids: string[], status: TaskStatus) => setTasks((ts) => ts.map((t) => (ids.includes(t.id) ? { ...t, status } : t)))
  const reset = () => { timers.current.forEach(clearTimeout); timers.current = []; setRun((r) => r + 1); setTasks(TASKS.map((id) => ({ id, status: "pending" }))); setOutcome("running"); note("new run") }
  const next = (status: TaskStatus) => {
    const t = tasks.find((x) => x.status === "running") ?? tasks.find((x) => x.status === "pending")
    if (t) setStatus([t.id], status)
  }
  const completeAll = () => { setTasks((ts) => ts.map((t) => ({ ...t, status: "done" }))); setOutcome("success") }
  const burst = () => { const ids = tasks.filter((t) => t.status !== "done").slice(0, 3).map((t) => t.id); setStatus(ids, "done"); note(`completed ${ids.length} at once`) }
  const sequence = () => {
    reset()
    let at = 300
    TASKS.forEach((id) => {
      timers.current.push(window.setTimeout(() => setStatus([id], "running"), at))
      at += 1400
      timers.current.push(window.setTimeout(() => setStatus([id], "done"), at))
      at += 250
    })
    timers.current.push(window.setTimeout(() => setOutcome("success"), at - 250))
  }
  const base = (b: BaseEmotion) => { ctl.setBase(b); note("base " + b) }
  const react = (r: Reaction) => note(`react ${r}: ${ctl.react(r, mascotNow()) ? "played/queued" : "dropped"}`)

  return (
    <div className={"pg pg--" + bg}>
      <header className="pg__bar">
        <b>Mascot playground</b>
        <span className="pg__state">emotion: <code>{emotion}</code></span>
      </header>
      <main className="pg__main">
        <section className="pg__stage" style={bg === "satellite" ? satellite() : undefined}>
          <div className="pg__hero"><AxolotlMascot controller={ctl} loading={loading} onEvents={onEvents} tracking={tracking} idleMotion={idle} reducedMotion={reduced} /></div>
          <div className="pg__sizes">
            {SIZES.map((s) => (
              <figure key={s} style={{ width: s, height: s }}>
                <AxolotlMascot controller={ctl} tracking={tracking} idleMotion={idle} reducedMotion={reduced} />
                <figcaption>{s}px</figcaption>
              </figure>
            ))}
          </div>
        </section>
        <aside className="pg__panel">
          <h2>Emotion</h2>
          <div className="pg__row">
            {(["idle", "thinking", "concerned"] as BaseEmotion[]).map((b) => <button key={b} onClick={() => base(b)}>{b}</button>)}
          </div>
          <div className="pg__row">
            {(["happy", "success", "error"] as Reaction[]).map((r) => <button key={r} onClick={() => react(r)}>{r}</button>)}
          </div>
          <h2>Options</h2>
          <label><input type="checkbox" checked={tracking} onChange={(e) => setTracking(e.target.checked)} /> Cursor tracking</label>
          <label><input type="checkbox" checked={idle} onChange={(e) => setIdle(e.target.checked)} /> Idle motion</label>
          <label><input type="checkbox" checked={reduced === true} onChange={(e) => setReduced(e.target.checked ? true : undefined)} /> Reduced motion</label>
          <div className="pg__row">
            {(["light", "map", "satellite"] as Bg[]).map((b) => <button key={b} className={bg === b ? "on" : ""} onClick={() => setBg(b)}>{b}</button>)}
          </div>
          <h2>Loading tasks <small>run {run}</small></h2>
          <ol className="pg__tasks">
            {tasks.map((t) => <li key={t.id} className={"st-" + t.status}>{t.id}<i>{t.status}</i></li>)}
          </ol>
          <div className="pg__row">
            <button onClick={() => next("running")}>Start next</button>
            <button onClick={() => next("done")}>Complete</button>
            <button onClick={() => next("warning")}>Warning</button>
            <button onClick={() => next("failed")}>Fail</button>
          </div>
          <div className="pg__row">
            <button onClick={burst}>3 completions at once</button>
            <button onClick={completeAll}>All complete</button>
            <button onClick={() => setOutcome("failed")}>Run failed</button>
          </div>
          <div className="pg__row">
            <button onClick={sequence}>Play full run</button>
            <button onClick={reset}>Reset run</button>
            <button onClick={() => setTasks((t) => [...t])}>Re-render (no replay)</button>
          </div>
          <h2>Log</h2>
          <pre className="pg__log">{log.join("\n")}</pre>
        </aside>
      </main>
    </div>
  )
}

function satellite() {
  const urls: string[] = []
  for (let dy = 0; dy < 4; dy++) for (let dx = 0; dx < 6; dx++)
    urls.push(`url(https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/${TILE.z}/${TILE.x + dx}/${TILE.y + dy}.jpeg) ${dx * 256}px ${dy * 256}px / 256px 256px no-repeat`)
  return { background: urls.join(",") + ", #4b5a3c" }
}
