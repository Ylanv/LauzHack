import { MASCOT } from "./params"

/** Persistent states: what the mascot is doing while nothing special happens. */
export type BaseEmotion = "idle" | "thinking" | "concerned"
/** Short reactions played on top of the base state, then the mascot falls back to it. */
export type Reaction = "happy" | "success" | "error"
export type Emotion = BaseEmotion | Reaction

const PRIORITY: Record<Reaction, number> = { happy: 1, error: 2, success: 3 }
const DURATION: Record<Reaction, number> = {
  happy: MASCOT.reactions.happy.duration,
  success: MASCOT.reactions.success.duration,
  error: MASCOT.reactions.error.duration,
}

export interface EmotionFrame {
  /** What the face and body should show now */
  emotion: Emotion
  base: BaseEmotion
  reaction: Reaction | null
  /** Seconds since the reaction started, and its progress 0..1 */
  reactionTime: number
  reactionProgress: number
}

/**
 * Small emotion state machine, driven by explicit timestamps (seconds) so it never needs timers and can be tested
 * deterministically. Rules:
 *  - a reaction of higher priority (success > error > happy) interrupts a lower one and clears queued happies
 *  - a lower-priority reaction arriving during a higher one is dropped
 *  - happies arriving during a happy are queued (MASCOT.reactions.maxQueued), extra ones are merged
 */
export class MascotEmotionController {
  private base: BaseEmotion = "idle"
  private current: { kind: Reaction; start: number } | null = null
  private queued = 0
  private last: Emotion = "idle"
  private listeners = new Set<(e: Emotion) => void>()

  setBase(b: BaseEmotion) { this.base = b; this.notify() }
  getBase() { return this.base }

  /** Plays a reaction at time `now` (seconds). Returns false when it was dropped. */
  react(kind: Reaction, now: number): boolean {
    this.expire(now)
    const cur = this.current
    if (!cur) { this.current = { kind, start: now }; this.notify(); return true }
    if (PRIORITY[kind] > PRIORITY[cur.kind]) { this.current = { kind, start: now }; this.queued = 0; this.notify(); return true }
    if (kind === "happy" && cur.kind === "happy") {
      if (this.queued >= MASCOT.reactions.maxQueued) return false
      this.queued++
      return true
    }
    return false
  }

  /** Drops any reaction in progress (e.g. when a new loading run starts). */
  clearReactions() { this.current = null; this.queued = 0; this.notify() }

  frame(now: number): EmotionFrame {
    this.expire(now)
    const cur = this.current
    const t = cur ? now - cur.start : 0
    const f: EmotionFrame = {
      emotion: cur ? cur.kind : this.base,
      base: this.base,
      reaction: cur ? cur.kind : null,
      reactionTime: t,
      reactionProgress: cur ? Math.min(1, t / DURATION[cur.kind]) : 0,
    }
    if (f.emotion !== this.last) this.notify()
    return f
  }

  /** Called whenever the visible emotion changes (not every frame). */
  subscribe(fn: (e: Emotion) => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }

  private expire(now: number) {
    while (this.current && now - this.current.start >= DURATION[this.current.kind]) {
      const end = this.current.start + DURATION[this.current.kind]
      if (this.current.kind === "happy" && this.queued > 0) { this.queued--; this.current = { kind: "happy", start: end } }
      else this.current = null
    }
  }

  private notify() {
    const e = this.current ? this.current.kind : this.base
    if (e === this.last) return
    this.last = e
    this.listeners.forEach((fn) => fn(e))
  }
}
