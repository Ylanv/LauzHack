import palette from "./palette.json"

/** Mascot colours (also baked into the model texture by scripts/build_axolotl.py). */
export const PALETTE = palette

/** Every tuning value of the mascot. Units: seconds, degrees, and model units (the body cube is 0.5 high). */
export const MASCOT = {
  /** Device pixel ratio cap for the WebGL canvas */
  maxDpr: 2,
  idle: {
    floatAmp: 0.018,        // ~3.5% of the body height
    floatPeriod: 2.6,
    breatheAmp: 0.012,      // scale change, kept tiny so the cube never looks rubbery
    breathePeriod: 3.4,
    gillAmp: 5,             // degrees
    gillPeriod: 1.9,
    tailAmp: 9,
    tailPeriod: 2.3,
  },
  blink: { minGap: 2.6, maxGap: 6.2, duration: 0.13, doubleChance: 0.18 },
  gaze: {
    maxYaw: 12,             // head
    maxPitch: 8,
    eyeRange: 1,            // pupils move up to one face pixel each way
    headOmega: 7,           // spring stiffness (rad/s): head follows a bit slower than the eyes
    eyeOmega: 16,
    /** Pointer distance (in viewport halves) at which the head reaches its limit */
    reach: 0.75,
  },
  /** How quickly base-state poses (tilt, attentiveness) blend, 1/s */
  blendRate: 6,
  reactions: {
    happy: { duration: 0.95, bounce: 0.09, gillWiggle: 16 },
    success: { duration: 1.8, bounce: 0.15, hops: 2, shimmy: 14, gillWiggle: 22 },
    error: { duration: 1.25, recoil: 9, back: 0.05 },
    /** Happy reactions queued while another one plays; extra completions in a burst are merged */
    maxQueued: 2,
  },
  states: {
    idle: { roll: 0, pitch: 0, motion: 1 },
    thinking: { roll: 7, pitch: -3, motion: 1.15 },
    concerned: { roll: -6, pitch: 2, motion: 0.5 },
  },
} as const
