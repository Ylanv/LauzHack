import { describe, expect, it } from "vitest"
import { MascotEmotionController } from "./emotion"
import { MascotLoadingAdapter, type LoadingSnapshot, type TaskStatus } from "./loadingAdapter"
import { MascotAnimator } from "./animator"
import { gazeTarget, spring } from "./gaze"
import { MASCOT } from "./params"

const HAPPY = MASCOT.reactions.happy.duration
const SUCCESS = MASCOT.reactions.success.duration
const ERROR = MASCOT.reactions.error.duration
const snap = (runId: number, statuses: TaskStatus[], outcome: LoadingSnapshot["outcome"] = "running"): LoadingSnapshot =>
  ({ runId, outcome, tasks: statuses.map((status, i) => ({ id: "t" + i, status })) })
const setup = () => { const e = new MascotEmotionController(); return { e, a: new MascotLoadingAdapter(e) } }

describe("MascotEmotionController", () => {
  it("plays a reaction, then returns to the base state", () => {
    const e = new MascotEmotionController()
    e.setBase("thinking")
    e.react("happy", 0)
    expect(e.frame(0.1).emotion).toBe("happy")
    expect(e.frame(HAPPY + 0.01).emotion).toBe("thinking")
  })

  it("queues a limited number of happies and merges the rest", () => {
    const e = new MascotEmotionController()
    expect(e.react("happy", 0)).toBe(true)
    expect(e.react("happy", 0.01)).toBe(true)
    expect(e.react("happy", 0.02)).toBe(true)
    expect(e.react("happy", 0.03)).toBe(false)          // maxQueued = 2
    expect(e.frame(HAPPY * 2.5).emotion).toBe("happy")  // the queued ones play back to back
    expect(e.frame(HAPPY * 3 + 0.01).emotion).toBe("idle")
  })

  it("success interrupts a happy and drops queued happies; happy during success is dropped", () => {
    const e = new MascotEmotionController()
    e.react("happy", 0); e.react("happy", 0.1)
    e.react("success", 0.2)
    expect(e.frame(0.3).emotion).toBe("success")
    expect(e.react("happy", 0.4)).toBe(false)
    expect(e.frame(0.2 + SUCCESS + 0.01).emotion).toBe("idle")
  })

  it("error interrupts happy but not success", () => {
    const e = new MascotEmotionController()
    e.react("happy", 0)
    expect(e.react("error", 0.1)).toBe(true)
    expect(e.frame(0.2).emotion).toBe("error")
    const s = new MascotEmotionController()
    s.react("success", 0)
    expect(s.react("error", 0.1)).toBe(false)
  })

  it("notifies only when the visible emotion changes", () => {
    const e = new MascotEmotionController()
    const seen: string[] = []
    e.subscribe((x) => seen.push(x))
    e.setBase("idle"); e.setBase("thinking"); e.setBase("thinking")
    e.react("happy", 0)
    for (let t = 0; t < HAPPY + 0.2; t += 1 / 60) e.frame(t)
    expect(seen).toEqual(["thinking", "happy", "thinking"])
  })
})

describe("MascotLoadingAdapter", () => {
  it("idle when the loading screen appears, thinking when a task starts", () => {
    const { e, a } = setup()
    expect(a.sync(snap(1, ["pending", "pending"]), 0).map((x) => x.type)).toEqual(["loadingStarted"])
    expect(e.frame(0).emotion).toBe("idle")
    a.sync(snap(1, ["running", "pending"]), 0.1)
    expect(e.frame(0.1).emotion).toBe("thinking")
  })

  it("one happy per completed task, never replayed by re-syncing the same state", () => {
    const { e, a } = setup()
    a.sync(snap(1, ["running", "pending"]), 0)
    expect(a.sync(snap(1, ["done", "running"]), 1).filter((x) => x.type === "taskCompleted")).toHaveLength(1)
    expect(e.frame(1.1).emotion).toBe("happy")
    for (let i = 0; i < 5; i++) expect(a.sync(snap(1, ["done", "running"]), 1.2)).toEqual([])
    expect(e.frame(1 + HAPPY + 0.01).emotion).toBe("thinking")   // no extra happies were queued
  })

  it("handles several completions arriving together predictably", () => {
    const { e, a } = setup()
    a.sync(snap(1, ["running", "running", "running", "running", "pending"]), 0)
    const ev = a.sync(snap(1, ["done", "done", "done", "done", "running"]), 1)
    expect(ev.filter((x) => x.type === "taskCompleted")).toHaveLength(4)
    // 1 playing + 2 queued, the 4th merged
    expect(e.frame(1 + HAPPY * 2.5).emotion).toBe("happy")
    expect(e.frame(1 + HAPPY * 3 + 0.01).emotion).toBe("thinking")
  })

  it("final success takes priority over the last task's happy", () => {
    const { e, a } = setup()
    a.sync(snap(1, ["done", "running"]), 0)
    const ev = a.sync(snap(1, ["done", "done"], "success"), 1)
    expect(ev.map((x) => x.type)).toEqual(["taskCompleted", "allCompleted"])
    expect(e.frame(1.05).emotion).toBe("success")
    expect(e.frame(1 + SUCCESS + 0.01).emotion).toBe("idle")
    expect(a.sync(snap(1, ["done", "done"], "success"), 5)).toEqual([])
    expect(e.frame(5.1).emotion).toBe("idle")
  })

  it("success also interrupts a happy that is already playing", () => {
    const { e, a } = setup()
    a.sync(snap(1, ["running", "pending"]), 0)
    a.sync(snap(1, ["done", "running"]), 1)
    a.sync(snap(1, ["done", "done"], "success"), 1.2)
    expect(e.frame(1.3).emotion).toBe("success")
  })

  it("a failure shows ERROR, then calms down, and never celebrates", () => {
    const { e, a } = setup()
    a.sync(snap(1, ["done", "running"]), 0)
    const ev = a.sync(snap(1, ["done", "failed"], "failed"), 1)
    expect(ev.map((x) => x.type)).toEqual(["taskFailed"])
    expect(e.frame(1.1).emotion).toBe("error")
    expect(e.frame(1 + ERROR + 0.01).emotion).toBe("idle")
    expect(a.sync(snap(1, ["done", "done"], "success"), 3).some((x) => x.type === "allCompleted")).toBe(false)
    expect(e.frame(3.1).emotion).toBe("idle")
  })

  it("a run-level failure without a failing task still reacts once", () => {
    const { e, a } = setup()
    a.sync(snap(1, ["running"]), 0)
    expect(a.sync(snap(1, ["running"], "failed"), 1).map((x) => x.type)).toEqual(["taskFailed"])
    expect(e.frame(1.1).emotion).toBe("error")
    expect(a.sync(snap(1, ["running"], "failed"), 1.2)).toEqual([])
  })

  it("warnings make it concerned while the task is open", () => {
    const { e, a } = setup()
    a.sync(snap(1, ["warning", "pending"]), 0)
    expect(e.frame(0).emotion).toBe("concerned")
    a.sync(snap(1, ["done", "running"]), 1)
    expect(e.frame(1 + HAPPY + 0.01).emotion).toBe("thinking")
  })

  it("a new run starts fresh; mounting mid-run does not replay history", () => {
    const { e, a } = setup()
    a.sync(snap(1, ["done", "done"], "success"), 0)            // first sight of run 1: already finished
    expect(e.frame(0.1).emotion).toBe("idle")
    a.sync(snap(2, ["pending", "pending"]), 1)
    a.sync(snap(2, ["done", "running"]), 2)
    expect(e.frame(2.1).emotion).toBe("happy")                  // same task id, new run: reacts again
  })
})

describe("MascotAnimator", () => {
  const emo = (emotion: "idle" | "happy", p = 0) =>
    ({ emotion, base: "idle" as const, reaction: emotion === "happy" ? ("happy" as const) : null, reactionTime: p, reactionProgress: p })
  const gaze = { yaw: 0.2, pitch: 0.1, eyeX: 1, eyeY: 0 }

  it("reduced motion: nothing moves, nothing blinks, expressions still change", () => {
    const a = new MascotAnimator({ reducedMotion: true, random: () => 0.5 })
    for (let t = 0; t < 20; t += 0.05) {
      const p = a.frame(t, 0.05, emo("idle"), gaze)
      expect([p.y, p.z, p.yaw, p.pitch, p.roll, p.gill, p.tail].map(Math.abs)).toEqual([0, 0, 0, 0, 0, 0, 0])
      expect(p.scaleY).toBe(1)
      expect(p.face.eyes).toBe("open")
    }
    const happy = a.frame(21, 0.05, emo("happy", 0.5), gaze)
    expect(happy.y).toBe(0)
    expect(happy.face.eyes).toBe("happy")
  })

  it("idle motion floats gently within the configured amplitude and blinks occasionally", () => {
    const a = new MascotAnimator({ random: () => 0.5 })
    let maxY = 0, blinks = 0, prev = "open"
    for (let t = 0; t < 30; t += 1 / 60) {
      const p = a.frame(t, 1 / 60, emo("idle"), { yaw: 0, pitch: 0, eyeX: 0, eyeY: 0 })
      maxY = Math.max(maxY, Math.abs(p.y))
      if (p.face.eyes === "closed" && prev !== "closed") blinks++
      prev = p.face.eyes
    }
    expect(maxY).toBeGreaterThan(MASCOT.idle.floatAmp * 0.8)
    expect(maxY).toBeLessThanOrEqual(MASCOT.idle.floatAmp * 1.01)
    expect(blinks).toBeGreaterThanOrEqual(3)
    expect(blinks).toBeLessThanOrEqual(12)
  })

  it("happy bounce returns to rest at the end of the reaction", () => {
    const a = new MascotAnimator({ idleMotion: false })
    for (let i = 0; i < 200; i++) a.frame(i / 60, 1 / 60, emo("idle"), { yaw: 0, pitch: 0, eyeX: 0, eyeY: 0 })
    expect(a.frame(4, 1 / 60, emo("happy", 0.5), gaze).y).toBeGreaterThan(0.05)
    expect(Math.abs(a.frame(4.1, 1 / 60, emo("happy", 1), gaze).y)).toBeLessThan(1e-6)
  })
})

describe("gaze", () => {
  it("maps the pointer to a bounded target with the right signs", () => {
    const left = gazeTarget(0, 500, 1000, 500, 1200, 800)
    expect(left.x).toBeLessThan(-0.5); expect(Math.abs(left.y)).toBeLessThan(1e-9)
    const up = gazeTarget(1000, 0, 1000, 700, 1200, 800)
    expect(up.y).toBeGreaterThan(0.5)
    const far = gazeTarget(-1e5, 1e5, 0, 0, 1200, 800)
    expect(Math.abs(far.x)).toBeLessThanOrEqual(1); expect(Math.abs(far.y)).toBeLessThanOrEqual(1)
  })

  it("spring settles on the target without overshoot", () => {
    let x = 0, v = 0, max = 0
    for (let i = 0; i < 120; i++) { [x, v] = spring(x, v, 1, 7, 1 / 60); max = Math.max(max, x) }
    expect(x).toBeCloseTo(1, 3)
    expect(max).toBeLessThanOrEqual(1 + 1e-9)
  })
})
