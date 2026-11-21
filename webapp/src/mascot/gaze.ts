import { MASCOT } from "./params"

const DEG = Math.PI / 180

/** Critically damped spring step: moves `x` (with velocity `v`) toward `target`. Stable for any dt. */
export function spring(x: number, v: number, target: number, omega: number, dt: number): [number, number] {
  const e = Math.exp(-omega * dt)
  const d = x - target
  const t = (v + omega * d) * dt
  return [target + (d + t) * e, (v - omega * t) * e]
}

/**
 * Where the mascot should look, from the pointer position relative to the mascot (both in CSS pixels).
 * Returns normalised -1..1 values (+x = to the viewer's right, +y = up); a soft curve keeps far pointers
 * from hitting the limit abruptly.
 */
export function gazeTarget(px: number, py: number, cx: number, cy: number, vw: number, vh: number) {
  const r = MASCOT.gaze.reach
  const nx = (px - cx) / (Math.max(vw, 1) * 0.5 * r)
  const ny = (cy - py) / (Math.max(vh, 1) * 0.5 * r)
  return { x: Math.tanh(nx), y: Math.tanh(ny) }
}

export interface GazeFrame {
  /** head rotation, radians (+yaw turns toward the viewer's right, +pitch looks up) */
  yaw: number
  pitch: number
  /** pupil offset -1..1 */
  eyeX: number
  eyeY: number
}

/**
 * Follows the mouse/pen anywhere on the page. The body stays where it is: only the head turns (limited and damped)
 * and the eyes lead it. Without a pointer (touch devices, pointer left the window, tracking off) it eases back to a
 * neutral gaze.
 */
export class MascotGazeController {
  enabled = true
  private target: { x: number; y: number } | null = null
  private pointer: { x: number; y: number } | null = null
  private head = { x: 0, vx: 0, y: 0, vy: 0 }
  private eye = { x: 0, vx: 0, y: 0, vy: 0 }
  private detach: (() => void) | null = null

  /** `anchor` returns the mascot's centre on screen; read when the pointer moves, not every frame. */
  attach(anchor: () => { x: number; y: number } | null) {
    if (this.detach || typeof window === "undefined") return
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") { this.pointer = null; return }
      this.pointer = { x: e.clientX, y: e.clientY }
      this.retarget(anchor)
    }
    const leave = (e: MouseEvent) => { if (!e.relatedTarget) { this.pointer = null; this.target = null } }
    const blur = () => { this.pointer = null; this.target = null }
    const scrolled = () => this.retarget(anchor)
    window.addEventListener("pointermove", move, { passive: true })
    document.addEventListener("mouseout", leave)
    window.addEventListener("blur", blur)
    window.addEventListener("resize", scrolled)
    window.addEventListener("scroll", scrolled, { passive: true })
    this.detach = () => {
      window.removeEventListener("pointermove", move)
      document.removeEventListener("mouseout", leave)
      window.removeEventListener("blur", blur)
      window.removeEventListener("resize", scrolled)
      window.removeEventListener("scroll", scrolled)
    }
  }

  dispose() { this.detach?.(); this.detach = null }

  /** Sets the target directly (normalised -1..1), e.g. for tests or scripted looks. null = neutral. */
  lookAt(t: { x: number; y: number } | null) { this.target = t }

  step(dt: number): GazeFrame {
    const t = this.enabled && this.target ? this.target : { x: 0, y: 0 }
    const g = MASCOT.gaze
    ;[this.head.x, this.head.vx] = spring(this.head.x, this.head.vx, t.x, g.headOmega, dt)
    ;[this.head.y, this.head.vy] = spring(this.head.y, this.head.vy, t.y, g.headOmega, dt)
    ;[this.eye.x, this.eye.vx] = spring(this.eye.x, this.eye.vx, t.x, g.eyeOmega, dt)
    ;[this.eye.y, this.eye.vy] = spring(this.eye.y, this.eye.vy, t.y, g.eyeOmega, dt)
    return {
      yaw: this.head.x * g.maxYaw * DEG,
      pitch: this.head.y * g.maxPitch * DEG,
      eyeX: this.eye.x * g.eyeRange,
      eyeY: this.eye.y * g.eyeRange,
    }
  }

  /** True while the head or eyes are still moving (lets a reduced-motion renderer stop drawing). */
  get settled() {
    const t = this.enabled && this.target ? this.target : { x: 0, y: 0 }
    return [this.head.x - t.x, this.head.y - t.y, this.eye.x - t.x, this.eye.y - t.y, this.head.vx, this.head.vy].every((v) => Math.abs(v) < 1e-3)
  }

  private retarget(anchor: () => { x: number; y: number } | null) {
    const a = anchor()
    if (!a || !this.pointer) return
    this.target = gazeTarget(this.pointer.x, this.pointer.y, a.x, a.y, window.innerWidth, window.innerHeight)
  }
}
