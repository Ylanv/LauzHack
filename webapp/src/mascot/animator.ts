import { MASCOT } from "./params"
import type { EmotionFrame } from "./emotion"
import type { GazeFrame } from "./gaze"
import type { FaceState } from "./face"

const DEG = Math.PI / 180
const TAU = Math.PI * 2

/** Everything the renderer applies in one frame. Each layer of the model owns its own fields, so nothing fights. */
export interface Pose {
  /** float group: idle bobbing + reaction bounces, breathing */
  y: number
  z: number
  scaleY: number
  scaleXZ: number
  /** head pivot (the cube is head and body): gaze + emotion, radians; +yaw = viewer's right, +pitch = looking up */
  yaw: number
  pitch: number
  roll: number
  /** gill pivots (radians about the attachment edge, + = up) and tail sway */
  gill: number
  tail: number
  /** 0..1 how close to the ground the body is (contact shadow) */
  lift: number
  face: FaceState
}

export interface AnimatorOptions {
  /** Idle floating, breathing, gills and tail (the face still blinks and reacts) */
  idleMotion?: boolean
  /** prefers-reduced-motion: no movement at all, only facial expressions */
  reducedMotion?: boolean
  random?: () => number
}

const smooth = (x: number) => x * x * (3 - 2 * x)

/**
 * Composes the procedural animation: idle layer x base-state blend + reaction offsets + gaze, plus blinking.
 * Stateful only for blending and the blink schedule; call `frame` once per rendered frame.
 */
export class MascotAnimator {
  idleMotion: boolean
  reducedMotion: boolean
  private random: () => number
  private blend = { roll: 0, pitch: 0, motion: 1 }
  private nextBlink = 1.8
  private blinkUntil = -1
  private pendingDouble = false
  private motionScale = 1

  constructor(o: AnimatorOptions = {}) {
    this.idleMotion = o.idleMotion ?? true
    this.reducedMotion = o.reducedMotion ?? false
    this.random = o.random ?? Math.random
  }

  frame(t: number, dt: number, emo: EmotionFrame, gaze: GazeFrame): Pose {
    const I = MASCOT.idle, R = MASCOT.reactions
    const moving = !this.reducedMotion
    // blend toward the base state's pose (so THINKING -> IDLE etc. never snaps)
    const target = MASCOT.states[emo.base]
    const k = moving ? 1 - Math.exp(-MASCOT.blendRate * dt) : 1
    this.blend.roll += (target.roll - this.blend.roll) * k
    this.blend.pitch += (target.pitch - this.blend.pitch) * k
    this.blend.motion += (target.motion - this.blend.motion) * k
    this.motionScale += ((moving && this.idleMotion ? 1 : 0) - this.motionScale) * (moving ? 1 - Math.exp(-4 * dt) : 1)
    const m = this.motionScale * this.blend.motion
    const speed = emo.base === "thinking" ? 1.25 : 1

    const wave = (period: number, phase = 0) => Math.sin((TAU * t) / period + phase)
    const breathe = wave(I.breathePeriod)
    const pose: Pose = {
      y: wave(I.floatPeriod) * I.floatAmp * m,
      z: 0,
      scaleY: 1 + breathe * I.breatheAmp * m,
      scaleXZ: 1 - breathe * I.breatheAmp * 0.5 * m,
      yaw: moving ? gaze.yaw : 0,
      pitch: moving ? gaze.pitch + this.blend.pitch * DEG : 0,
      roll: moving ? this.blend.roll * DEG : 0,
      gill: wave(I.gillPeriod / speed, 0.7) * I.gillAmp * DEG * m,
      tail: (wave(I.tailPeriod / speed, 1.3) * I.tailAmp * DEG) * m - (moving ? gaze.yaw * 0.6 : 0),
      lift: 0,
      face: this.face(emo, gaze, t),
    }

    // reactions: offsets on top of the idle layer, all returning to zero at the end
    const p = emo.reactionProgress
    if (moving && emo.reaction === "happy") {
      const hop = Math.sin(Math.PI * smooth(p))
      pose.y += hop * R.happy.bounce
      pose.scaleY += (p > 0.85 ? -Math.sin(((p - 0.85) / 0.15) * Math.PI) * 0.04 : 0)   // tiny landing squash
      pose.gill += Math.sin(p * TAU * 3) * R.happy.gillWiggle * DEG * (1 - p)
      pose.tail += Math.sin(p * TAU * 2.5) * 14 * DEG * (1 - p)
    } else if (moving && emo.reaction === "success") {
      const hops = R.success.hops
      pose.y += Math.abs(Math.sin(Math.PI * hops * p)) * R.success.bounce * (1 - 0.4 * p)
      pose.yaw += Math.sin(p * TAU * 2) * R.success.shimmy * DEG * (1 - p)
      pose.gill += (Math.sin(Math.PI * p) * 0.6 + Math.sin(p * TAU * 4) * 0.4) * R.success.gillWiggle * DEG
      pose.tail += Math.sin(p * TAU * 4) * 16 * DEG * (1 - p)
    } else if (moving && emo.reaction === "error") {
      const env = p < 0.15 ? smooth(p / 0.15) : 1 - smooth((p - 0.15) / 0.85)
      pose.pitch += R.error.recoil * DEG * env
      pose.z += R.error.back * env
      pose.gill -= 10 * DEG * env
    }
    pose.lift = Math.max(0, pose.y)
    return pose
  }

  private face(emo: EmotionFrame, gaze: GazeFrame, t: number): FaceState {
    const round = (v: number) => (Math.abs(v) < 0.45 ? 0 : Math.sign(v))
    const f: FaceState = { eyes: "open", mouth: "smile", px: round(gaze.eyeX), py: round(gaze.eyeY), cheeks: false, brows: "none" }
    switch (emo.emotion) {
      case "thinking": f.eyes = "focus"; f.mouth = "flat"; f.py = Math.max(f.py, 0); break
      case "concerned": f.brows = "worried"; f.mouth = "wavy"; f.py = 1; break
      case "happy": f.eyes = "happy"; f.mouth = "grin"; f.cheeks = true; break
      case "success": f.eyes = "happy"; f.mouth = "bigGrin"; f.cheeks = true; break
      case "error": f.eyes = "wide"; f.mouth = "o"; f.px = 0; f.py = 0; break
    }
    if (this.blinking(t) && f.eyes !== "happy") f.eyes = "closed"
    return f
  }

  /** Occasional blinks at irregular intervals, sometimes a quick double blink. None with reduced motion. */
  private blinking(t: number) {
    if (this.reducedMotion) return false
    const B = MASCOT.blink
    if (t >= this.nextBlink && t > this.blinkUntil) {
      this.blinkUntil = t + B.duration
      if (this.pendingDouble) { this.pendingDouble = false; this.nextBlink = t + B.minGap + this.random() * (B.maxGap - B.minGap) }
      else if (this.random() < B.doubleChance) { this.pendingDouble = true; this.nextBlink = t + B.duration + 0.12 }
      else this.nextBlink = t + B.minGap + this.random() * (B.maxGap - B.minGap)
    }
    return t < this.blinkUntil
  }
}
