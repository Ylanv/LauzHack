import { useEffect, useLayoutEffect, useRef } from "react"
import { MascotEmotionController } from "./emotion"
import { MascotGazeController } from "./gaze"
import { MascotAnimator } from "./animator"
import { MascotLoadingAdapter, type LoadingSnapshot, type MascotEvent } from "./loadingAdapter"
import { faceKey } from "./face"
import type { AxolotlScene } from "./AxolotlModel"

/** Clock shared by the renderer and whoever triggers reactions (seconds). */
export const mascotNow = () => performance.now() / 1000

const prefersReduced = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches

export interface AxolotlMascotProps {
  /** Drive emotions yourself (playground, other screens). One is created internally otherwise. */
  controller?: MascotEmotionController
  /** Real loading state; events are derived from it once per run (see MascotLoadingAdapter) */
  loading?: LoadingSnapshot | null
  onEvents?: (events: MascotEvent[]) => void
  /** Follow the cursor (default true) */
  tracking?: boolean
  /** Idle floating, breathing, gills and tail (default true) */
  idleMotion?: boolean
  /** Forces reduced motion on/off; follows prefers-reduced-motion when undefined */
  reducedMotion?: boolean
  className?: string
}

/**
 * AXA axolotl mascot: a transparent WebGL canvas that fills its container. three.js and the model load lazily in their
 * own chunk; one requestAnimationFrame loop composes every layer, paused while the page is hidden.
 */
export default function AxolotlMascot({ controller, loading, onEvents, tracking = true, idleMotion = true, reducedMotion, className }: AxolotlMascotProps) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const own = useRef<MascotEmotionController>()
  const ctl = controller ?? (own.current ??= new MascotEmotionController())
  const adapter = useRef<{ ctl: MascotEmotionController; a: MascotLoadingAdapter }>()
  if (adapter.current?.ctl !== ctl) adapter.current = { ctl, a: new MascotLoadingAdapter(ctl) }
  const opts = useRef({ tracking, idleMotion, reducedMotion, ctl })
  opts.current = { tracking, idleMotion, reducedMotion, ctl }
  const onEv = useRef(onEvents)
  onEv.current = onEvents

  // loading snapshot -> one-shot events (the adapter remembers what it consumed, so re-renders replay nothing).
  // Layout effect: the reaction starts in the same commit as the status text that announces it.
  useLayoutEffect(() => {
    const ev = adapter.current!.a.sync(loading, mascotNow())
    if (ev.length) onEv.current?.(ev)
  }, [loading])

  useEffect(() => {
    const cv = canvas.current!
    let scene: AxolotlScene | null = null, raf = 0, disposed = false, last = mascotNow(), lastKey = ""
    const gaze = new MascotGazeController()
    const anim = new MascotAnimator()
    gaze.attach(() => { const r = cv.getBoundingClientRect(); return r.width ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null })

    const size = () => { const r = cv.getBoundingClientRect(); scene?.resize(Math.max(1, r.width), Math.max(1, r.height)) }
    const ro = new ResizeObserver(() => { size(); lastKey = "" })
    ro.observe(cv)

    const loop = () => {
      raf = 0
      if (disposed || !scene || document.hidden) return
      raf = requestAnimationFrame(loop)
      const o = opts.current, now = mascotNow(), dt = Math.min(0.1, now - last)
      last = now
      const reduced = o.reducedMotion ?? prefersReduced()
      anim.reducedMotion = reduced
      anim.idleMotion = o.idleMotion
      gaze.enabled = o.tracking && !reduced
      const pose = anim.frame(now, dt, o.ctl.frame(now), gaze.step(dt))
      // reduced motion: nothing moves, so only draw when the expression changes
      const key = reduced ? faceKey(pose.face) : ""
      if (reduced && key === lastKey) return
      lastKey = key
      if (import.meta.env.DEV) (cv as unknown as { pose: unknown }).pose = pose   // inspected by browser checks
      scene.render(pose)
    }
    const wake = () => { if (!raf && !document.hidden) { last = mascotNow(); raf = requestAnimationFrame(loop) } }
    document.addEventListener("visibilitychange", wake)

    import("./AxolotlModel")
      .then((m) => m.createAxolotlScene(cv))
      .then((s) => { if (disposed) { s.dispose(); return } scene = s; size(); cv.dataset.ready = "1"; wake() })
      .catch((e) => { console.warn("Mascot could not start (WebGL unavailable?)", e); cv.dataset.ready = "error" })

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      document.removeEventListener("visibilitychange", wake)
      ro.disconnect()
      gaze.dispose()
      scene?.dispose()
    }
  }, [])

  return <canvas ref={canvas} className={className} aria-hidden="true" style={{ width: "100%", height: "100%", display: "block" }} />
}
