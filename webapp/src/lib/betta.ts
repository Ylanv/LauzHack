// ASCII betta fish, ported to a live canvas renderer from betta_fish.py
// (c) @dwcminh.ascii, github.com/dwcminh/ascii-art/tree/main/BETTA-FISH. Free for personal, non-commercial use;
// commercial use needs the author's permission. Not our own work: keep the credit in the footer.
//
// Same model as the original: a 3D body and veils (tail, back and belly sails, two ribbons, two oars) swimming on one
// travelling wave, projected to a character grid, shaded by the light falling across the folds, outlined where a part
// meets water, filled with letters chosen by brightness, soft trails between frames.
// Differences: it starts fully grown (no drawing-in intro), the swim path is a seamless 14 s loop, and it is recoloured
// to the app palette (indigo / periwinkle) with brightness mapped to opacity so it sits on the light page.

type V3 = [number, number, number]
const TAU = Math.PI * 2, GOLDEN = Math.PI * (3 - Math.sqrt(5))
const smooth = (x: number) => { x = x < 0 ? 0 : x > 1 ? 1 : x; return x * x * (3 - 2 * x) }
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)

/* ---- timeline: everything is periodic in LOOP seconds, so the fish loops without a seam ---- */
const LOOP = 14, W0 = TAU / LOOP
const PERIOD = 2, BEAT0 = 0.2                      // one beat = one full tail stroke
const T_RISE = [0, 2.4], T_TURN = [2.4, 4.4], T_DIVE = [4.4, 6.8], T_BACK = [6.8, 8.8], T_HOME = [8.8, 11.2]
const span = (t: number, b: number[]) => smooth((t - b[0]) / (b[1] - b[0]))
const beat = (t: number) => { const ph = (((t - BEAT0) / PERIOD) % 1 + 1) % 1; return ph < 0.22 ? smooth(ph / 0.22) : 1 - smooth((ph - 0.22) / 0.78) }
const stroke = (t: number) => 0.7 + 0.5 * beat(t)

const NOSE = 0.42, LENGTH = 0.8, TAIL_X = NOSE - 0.97 * LENGTH
const PIVOT = [-0.26, -0.06], HOME_Y = 0.02, TIP = 0.22, STEEP = 1.7, CLIMB = 0.24, FACING = 0.6, WEAVE = 0.22
const BODY_LAG = 0.32, FIN_LAG = 0.85, SWIM = 0.05, TAIL_BEAT = Math.PI, ALONG_BODY = 5, ALONG_FIN = 2.6

const heading = (t: number) => FACING + (Math.PI - 2 * FACING) * (span(t, T_TURN) - span(t, T_BACK)) + WEAVE * Math.sin(W0 * 2 * t + 0.4) + 0.06 * Math.sin(W0 * 3 * t)
const height = (t: number) => CLIMB * (span(t, T_RISE) - 2 * span(t, T_DIVE) + span(t, T_HOME)) + 0.05 * Math.sin(W0 * 2 * t)

/** carry a point of the fish's own space into the water (tipped, turned, weaving). lag: later for the tail and the fin hems. */
function carry(src: Float32Array, n: number, t: number, lag: Float32Array | null, out: Float32Array) {
  const st = stroke(t)
  for (let i = 0; i < n; i++) {
    let x = src[3 * i], y = src[3 * i + 1], z = src[3 * i + 2]
    const behind = clamp((NOSE - x) / LENGTH, 0, 1)
    const td = t - BODY_LAG * behind - (lag ? lag[i] : 0)
    z += ((SWIM * st * Math.pow(Math.max(behind - 0.25, 0), 1.5)) / 0.65) * Math.sin(ALONG_BODY * behind - TAIL_BEAT * t)
    x -= PIVOT[0]; y -= PIVOT[1]
    const tip = TIP + 0.05 * Math.sin(W0 * td + 1.0) + (STEEP * (height(td + 0.05) - height(td - 0.05))) / 0.1
    const ct = Math.cos(tip), sT = Math.sin(tip)
    const x2 = x * ct - y * sT, y2 = x * sT + y * ct
    const yaw = heading(td), cy = Math.cos(yaw), sy = Math.sin(yaw)
    out[3 * i] = x2 * cy - z * sy + 0.05 * Math.sin(W0 * td + 0.4)
    out[3 * i + 1] = y2 + HOME_Y + height(td)
    out[3 * i + 2] = x2 * sy + z * cy
  }
}

/* ---- the body ---- */
const NU = 400
const _H = (() => {
  const xs = [0, 0.03, 0.09, 0.18, 0.32, 0.48, 0.66, 0.84, 1.0], ys = [0.004, 0.026, 0.058, 0.094, 0.128, 0.128, 0.102, 0.068, 0.047]
  const raw = new Float64Array(NU)
  for (let i = 0; i < NU; i++) {
    const u = i / (NU - 1); let k = 0; while (k < xs.length - 2 && u > xs[k + 1]) k++
    raw[i] = ys[k] + ((ys[k + 1] - ys[k]) * (u - xs[k])) / (xs[k + 1] - xs[k])
  }
  const pad = new Float64Array(NU + 20); for (let i = 0; i < pad.length; i++) pad[i] = raw[clamp(i - 10, 0, NU - 1)]
  const ker = Array.from({ length: 21 }, (_, n) => 0.5 - 0.5 * Math.cos((TAU * n) / 20)), ks = ker.reduce((a, b) => a + b, 0)
  const out = new Float64Array(NU)
  for (let i = 0; i < NU; i++) { let s = 0; for (let k = 0; k < 21; k++) s += pad[i + k] * ker[k]; out[i] = s / ks }
  return out
})()
const tall = (u: number) => { const f = clamp(u, 0, 1) * (NU - 1), i = Math.min(NU - 2, Math.floor(f)); return _H[i] + (_H[i + 1] - _H[i]) * (f - i) }
const arch = (u: number) => 0.012 * Math.sin(Math.PI * clamp(u, 0, 1)) - 0.01 * Math.pow(clamp(1 - u / 0.2, 0, 1), 2)
const backAt = (x: number) => { const u = (NOSE - x) / LENGTH; return arch(u) + tall(u) }
const bellyAt = (x: number) => { const u = (NOSE - x) / LENGTH; return arch(u) - tall(u) }
const body = (u: number, th: number): V3 => { const h = tall(u); return [NOSE - LENGTH * u, arch(u) + h * Math.sin(th), h * (0.56 - 0.22 * u) * Math.cos(th)] }

/* ---- camera and light ---- */
const unit = (v: V3): V3 => { const l = Math.hypot(v[0], v[1], v[2]) || 1e-12; return [v[0] / l, v[1] / l, v[2] / l] }
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const EYE: V3 = [0, -0.25, 6], FWD = unit([0 - EYE[0], 0 - EYE[1], 0 - EYE[2]])
const RIGHT = unit(cross(FWD, [0, 1, 0])), UPV = cross(RIGHT, FWD)
const EYE_CAM: V3 = [dot(RIGHT, EYE), dot(UPV, EYE), dot(FWD, EYE)]
const ZOOM = 7.4
const VIEW = unit(EYE), KEY = unit([-0.5, 0.62, 0.6]), HALF = unit([KEY[0] + VIEW[0], KEY[1] + VIEW[1], KEY[2] + VIEW[2]])

/* ---- palette (app colours), 0..1 ---- */
const mix = (a: V3, b: V3, k: number): V3 => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
/** colours of one fish: body (a to b), veils (v0 at the root, v1 half way, v2 at the hem), highlight, eyes */
export interface Palette { a: V3; b: V3; v0: V3; v1: V3; v2: V3; light: V3; ink: V3 }
const rgb = (hex: string): V3 => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255]
// the colour sets of the original betta_fish.py (body, face/belly, then the veils: root, half way, hem)
const orig = (s: V3, f: V3, v0: V3, v1: V3, v2: V3): Palette => ({ a: s, b: f, v0, v1, v2, light: mix(f, [1, 0.98, 0.94], 0.5), ink: [s[0] * 0.18, s[1] * 0.18, s[2] * 0.22] })
export const PALETTES = {
  blue: orig([0.10, 0.36, 1.00], [0.30, 0.86, 1.00], [0.40, 0.30, 1.00], [0.90, 0.26, 0.92], [1.00, 0.30, 0.55]),     // blue body, violet to rose veils
  fire: orig([0.95, 0.10, 0.16], [1.00, 0.55, 0.35], [0.90, 0.08, 0.14], [1.00, 0.30, 0.08], [1.00, 0.58, 0.10]),     // red to orange
  mustard: orig([0.04, 0.66, 0.74], [0.60, 1.00, 0.90], [0.08, 0.72, 0.70], [0.98, 0.84, 0.14], [1.00, 0.96, 0.58]),  // teal body, yellow veils
  lotus: orig([0.14, 0.84, 0.36], [0.76, 1.00, 0.62], [1.00, 0.86, 0.92], [1.00, 0.44, 0.66], [0.96, 0.14, 0.42]),    // green body, white to deep pink
  koi: orig([1.00, 0.50, 0.10], [1.00, 0.90, 0.70], [0.12, 0.30, 1.00], [0.20, 0.66, 1.00], [0.60, 0.94, 1.00]),      // orange body, blue veils
  aurora: orig([0.30, 0.24, 1.00], [0.66, 0.60, 1.00], [0.18, 1.00, 0.52], [0.18, 0.86, 1.00], [0.72, 0.48, 1.00]),   // indigo body, green to violet
}
/* ---- parts ---- */
const BODY = 0, TAIL = 1, BACK = 2, BELLY = 3, RIB0 = 4, OAR0 = 6, MARK = 8
const HARD = [true, true, true, true, true, true, true, true, false]
const POOLS = ["1il!;:", "rtfjcvxz=+", "aeoun0{}[]<>", "08B$#&%Q"]
const FILL = POOLS.map((p) => Array.from({ length: 12 }, (_, k) => p.charCodeAt(k % p.length)))
const SLOPE = "-/|\\-".split("").map((c) => c.charCodeAt(0))
const slopeChar = (dx: number, dy: number) => { const a = (((Math.atan2(dy, dx) * 180) / Math.PI) % 180 + 180) % 180; return SLOPE[a < 25 ? 0 : a < 72 ? 1 : a < 108 ? 2 : a < 155 ? 3 : 4] }
const sc = (c: string) => c.charCodeAt(0)

interface Sheet {
  K: number; A: number; R: number; n: number
  a: Float32Array; r: Float32Array            // fin coordinates of each point (a along the root, r out to the hem)
  ink: Float32Array                            // base colour per point
  rays: number; part: (k: number) => number
  local: Float32Array; lag: Float32Array; p: Float32Array
  build: (t: number, s: Sheet) => void
}

const scallop = (a: number, rays: number) => 0.94 + 0.06 * Math.sqrt(Math.abs(Math.cos(rays * Math.PI * a)))
const wave = (a: number, r: number, t: number, root: number, big: number, k: number) =>
  big * stroke(t) * Math.pow(r, 1.3) * Math.sin(root + ALONG_FIN * r - TAIL_BEAT * t + 0.9 * (a - 0.5)) +
  0.022 * Math.pow(r, 1.2) * Math.sin(4.5 * TAU * a + 1.3 * Math.sin(W0 * t + k) - 1.8 * r + k) +
  0.014 * Math.pow(r, 4) * Math.sin(19 * a - W0 * 8 * t + 2 * k)

function finInk(r: number, pal: Palette): V3 {
  const ink = r < 0.5 ? mix(pal.v0, pal.v1, smooth(r / 0.5)) : mix(pal.v1, pal.v2, smooth((r - 0.5) / 0.45))
  return r > 0.95 ? mix(pal.v2, pal.light, 0.6) : ink
}

function makeSheet(K: number, A: number, R: number, rays: number, part: (k: number) => number, build: Sheet["build"], sameAR = false): Sheet {
  const n = K * A * R, a = new Float32Array(n), r = new Float32Array(n), ink = new Float32Array(0)
  for (let k = 0; k < K; k++) for (let i = 0; i < A; i++) for (let j = 0; j < R; j++) {
    const idx = (k * A + i) * R + j, av = i / (A - 1), rv = sameAR ? i / (A - 1) : j / (R - 1)
    a[idx] = av; r[idx] = rv
  }
  return { K, A, R, n, a, r, ink, rays, part, local: new Float32Array(n * 3), lag: new Float32Array(n), p: new Float32Array(n * 3), build }
}

/** lay a fin out ray by ray: a ray does not stretch, so where the wave pushes it out of its plane it reaches less far along it */
function veil(s: Sheet, rootFn: (i: number, j: number) => V3, exey: (i: number, j: number) => [number, number], longFn: (i: number) => number, out: Float32Array) {
  const { A, R } = s
  for (let i = 0; i < A; i++) {
    const lg = longFn(i), step = lg / (R - 1)
    let cx = 0, cy = 0
    for (let j = 0; j < R; j++) {
      const idx = i * R + j, prev = j ? out[idx - 1] : out[idx], rise = out[idx] - prev
      let flat = Math.sqrt(Math.max(step * step - rise * rise, (0.6 * step) ** 2)); if (j === 0) flat = 0
      const [ex, ey] = exey(i, j); cx += flat * ex; cy += flat * ey
      const rt = rootFn(i, j)
      s.local[3 * idx] = rt[0] + cx; s.local[3 * idx + 1] = rt[1] + cy; s.local[3 * idx + 2] = rt[2] + out[idx]
      s.lag[idx] = FIN_LAG * lg * (j / (R - 1))
    }
  }
}

const TAIL_RAYS = 15, BACK_RAYS = 9, BELLY_RAYS = 11, SWEEP = 0.6
let SHEETS: Sheet[] = []
function initSheets() {
  const tmp = new Float32Array(112 * 44)
  const tail = makeSheet(1, 112, 44, TAIL_RAYS, () => TAIL, (t, s) => {
    for (let i = 0; i < s.A; i++) for (let j = 0; j < s.R; j++) { const a = i / (s.A - 1), r = j / (s.R - 1); tmp[i * s.R + j] = wave(a, r, t, ALONG_BODY, 0.17, 0) }
    veil(s, (i) => [TAIL_X, 0.04 * (2 * (i / (s.A - 1)) - 1), 0],
      (i, j) => { const a = i / (s.A - 1), r = j / (s.R - 1); const spread = 2.5 * (1 + 0.08 * beat(t - 0.25 * r)); let ang = (a - 0.5) * spread * (1 - 0.22 * r * r) + 0.07 * r * Math.sin(3.2 * a - 3 * W0 * t); ang -= 0.16 * r * r * Math.cos(ang); return [-Math.cos(ang), Math.sin(ang)] },
      (i) => { const a = i / (s.A - 1); return 0.7 * (0.9 + 0.1 * Math.sin(Math.PI * a)) * scallop(a, TAIL_RAYS) }, tmp)
  })
  const sail = (up: number, A: number, R: number, rays: number, part: number) => makeSheet(1, A, R, rays, () => part, (t, s) => {
    const X = (a: number) => (up > 0 ? -0.24 * a : 0.04 - 0.3 * a)
    for (let i = 0; i < s.A; i++) for (let j = 0; j < s.R; j++) { const a = i / (s.A - 1), r = j / (s.R - 1); tmp[i * s.R + j] = wave(a, r, t, (ALONG_BODY * (NOSE - X(a))) / LENGTH, 0.13 + 0.03 * (up < 0 ? 1 : 0), 1.7 + up) }
    veil(s, (i, j) => { const a = i / (s.A - 1), r = j / (s.R - 1), x = X(a); return [x, up > 0 ? backAt(x) - 0.012 : bellyAt(x) + 0.012, 0.012 + 0.01 * r] },
      (i, j) => { const a = i / (s.A - 1), r = j / (s.R - 1), l0 = up > 0 ? 0.1 + 0.3 * a : 0.08 + 0.26 * a; const lean = l0 + SWEEP * r - 0.1 * beat(t - 0.25 * r) + 0.07 * r * Math.sin(3 * a - 3 * W0 * t + up); return [-Math.sin(lean), up * Math.cos(lean)] },
      (i) => { const a = i / (s.A - 1); return (up > 0 ? (0.32 + 0.28 * a) * Math.sqrt(Math.sin(Math.PI * clamp(0.14 + 0.72 * a, 0, 1))) : (0.26 + 0.42 * a) * Math.sqrt(Math.sin(Math.PI * clamp(0.12 + 0.74 * a, 0, 1)))) * scallop(a, rays) }, tmp)
  })
  const back = sail(1, 64, 34, BACK_RAYS, BACK), belly = sail(-1, 72, 34, BELLY_RAYS, BELLY)
  const rib = makeSheet(2, 100, 9, 0, (k) => RIB0 + k, (t, s) => {
    for (let k = 0; k < 2; k++) for (let i = 0; i < s.A; i++) for (let j = 0; j < s.R; j++) {
      const sv = i / (s.A - 1), w = (j / (s.R - 1)) * 2 - 1, side = 2 * k - 1, reach = 0.6 * sv
      const wide = 0.036 * Math.pow(Math.sin(Math.PI * Math.pow(clamp(sv, 0, 1), 0.55)), 0.8)
      const idx = (k * s.A + i) * s.R + j
      s.local[3 * idx] = 0.13 - 0.6 * (0.22 * sv + 0.3 * sv * sv) + w * wide
      s.local[3 * idx + 1] = bellyAt(0.13) + 0.012 - 0.6 * (0.96 * sv - 0.2 * sv * sv) + 0.3 * w * wide
      s.local[3 * idx + 2] = side * (0.03 + 0.07 * sv) + 0.11 * Math.pow(sv, 1.3) * Math.sin(1.4 + 3.4 * sv - TAIL_BEAT * t + 2.4 * k) + 0.012 * w * Math.sin(9 * sv - 7 * W0 * t)
      s.lag[idx] = FIN_LAG * reach
    }
  }, true)
  const oar = makeSheet(2, 28, 18, 0, (k) => OAR0 + k, (t, s) => {
    for (let k = 0; k < 2; k++) for (let i = 0; i < s.A; i++) for (let j = 0; j < s.R; j++) {
      const a = i / (s.A - 1), r = j / (s.R - 1), side = 2 * k - 1, swing = 0.8 + 0.55 * Math.sin(17 * W0 * t + Math.PI * k - 1.2 * r)
      const ang = (a - 0.5) * 1.9, reach = 0.15 * r, idx = (k * s.A + i) * s.R + j
      s.local[3 * idx] = 0.205 - Math.cos(ang) * Math.cos(swing) * reach
      s.local[3 * idx + 1] = -0.025 + Math.sin(ang) * reach
      s.local[3 * idx + 2] = side * (tall(0.27) * 0.5 + 0.004 + Math.cos(ang) * Math.sin(swing) * reach)
      s.lag[idx] = 0
    }
  })
  SHEETS = [tail, back, belly, rib, oar]
}

/* ---- body points ---- */
const NB = 5200
let BU: Float32Array, BTH: Float32Array, B0: Float32Array, B1: Float32Array, B2: Float32Array, BSC: Float32Array, BK: Float32Array
function initBody() {
  const grid = 2000, cum = new Float64Array(grid); let acc = 0
  for (let i = 0; i < grid; i++) { acc += tall(i / (grid - 1)) + 0.01; cum[i] = acc }
  BU = new Float32Array(NB); BTH = new Float32Array(NB); B0 = new Float32Array(NB * 3); B1 = new Float32Array(NB * 3); B2 = new Float32Array(NB * 3); BSC = new Float32Array(NB); BK = new Float32Array(NB)
  let g = 0
  for (let i = 0; i < NB; i++) {
    const target = ((i + 0.5) / NB) * acc; while (g < grid - 2 && cum[g + 1] < target) g++
    const u = (g + (target - cum[g]) / (cum[g + 1] - cum[g])) / (grid - 1), th = (i * GOLDEN) % TAU
    BU[i] = u; BTH[i] = th
    const p0 = body(u, th), p1 = body(u + 2e-3, th), p2 = body(u, th + 2e-3)
    B0.set(p0, 3 * i); B1.set(p1, 3 * i); B2.set(p2, 3 * i)
    BSC[i] = 0.5 + 0.5 * Math.cos(u * 170 + th * 8) * Math.cos(u * 170 - th * 8)
    const pale = clamp(Math.max(smooth((0.2 - u) / 0.12), smooth((-Math.sin(th) - 0.2) / 0.6)), 0, 1)
    BK[i] = 0.75 * pale + 0.4 * (BSC[i] > 0.78 && u > 0.2 ? 1 : 0)
  }
}

/* ---- render ---- */
export interface BettaOpts { cols: number; rows: number; cw: number; ch: number; palette?: Palette }
const MAXPTS = NB + 112 * 44 + 64 * 34 + 72 * 34 + 2 * 100 * 9 + 2 * 28 * 18 + 80
const SX = new Float32Array(MAXPTS), SY = new Float32Array(MAXPTS), SZ = new Float32Array(MAXPTS), SL = new Float32Array(MAXPTS), SC = new Float32Array(MAXPTS * 3)
const SP = new Int8Array(MAXPTS), SG = new Int32Array(MAXPTS), SA = new Float32Array(MAXPTS)
let ready = false

const bubbles = (() => { let s = 3; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647); return Array.from({ length: 56 }, () => [r(), r(), r(), r(), r()]) })()

export function createBetta(opts: BettaOpts) {
  if (!ready) { initBody(); initSheets(); ready = true }
  const { cols, rows, cw, ch } = opts, pal = opts.palette || PALETTES.blue
  // per-fish colours: veil colours by position on each sheet, body colours by position on the skin
  const inks = SHEETS.map((s, si) => { const a = new Float32Array(s.n * 3); for (let q = 0; q < s.n; q++) { const c = si === 4 ? mix(pal.v2, pal.light, 0.4) : finInk(s.r[q], pal); a[3 * q] = c[0]; a[3 * q + 1] = c[1]; a[3 * q + 2] = c[2] } return a })
  const bink = new Float32Array(NB * 3); for (let i = 0; i < NB; i++) bink.set(mix(pal.a, pal.b, BK[i]), 3 * i)
  const aspect = (cols * cw) / (rows * ch)
  const cells = cols * rows
  const zbuf = new Float32Array(cells), gi = new Int32Array(cells), cover = new Float32Array(cells)
  const outChar = new Int32Array(cells), outR = new Float32Array(cells), outG = new Float32Array(cells), outB = new Float32Array(cells), outA = new Float32Array(cells)
  const HASH = new Int32Array(cells); for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) HASH[r * cols + c] = (r * 7919 + c * 104729) % 9973
  const cam = new Float32Array(3)
  let n = 0

  const proj = (px: number, py: number, pz: number, i: number) => {
    const x = RIGHT[0] * px + RIGHT[1] * py + RIGHT[2] * pz - EYE_CAM[0], y = UPV[0] * px + UPV[1] * py + UPV[2] * pz - EYE_CAM[1], z = FWD[0] * px + FWD[1] * py + FWD[2] * pz - EYE_CAM[2]
    const zz = Math.max(z, 0.2)
    SX[i] = (0.5 + (x / zz) * ZOOM * 0.5) * cols; SY[i] = (0.5 - (y / zz) * ZOOM * 0.5 * aspect) * rows; SZ[i] = z
    cam[0] = x; cam[1] = y; cam[2] = z
  }

  function scene(t: number) {
    n = 0
    // body
    const p = new Float32Array(NB * 3), pu = new Float32Array(NB * 3), pt = new Float32Array(NB * 3)
    carry(B0, NB, t, null, p); carry(B1, NB, t, null, pu); carry(B2, NB, t, null, pt)
    for (let i = 0; i < NB; i++) {
      const a: V3 = [pu[3 * i] - p[3 * i], pu[3 * i + 1] - p[3 * i + 1], pu[3 * i + 2] - p[3 * i + 2]], b: V3 = [pt[3 * i] - p[3 * i], pt[3 * i + 1] - p[3 * i + 1], pt[3 * i + 2] - p[3 * i + 2]]
      let nn = unit(cross(a, b)); if (dot(nn, VIEW) < 0) nn = [-nn[0], -nn[1], -nn[2]]
      const u = BU[i], nv = dot(nn, VIEW)
      let lum = 0.6 + 0.36 * clamp(dot(nn, KEY), 0, 1) + 0.55 * Math.pow(clamp(dot(nn, HALF), 0, 1), 20) + 0.26 * Math.pow(1 - Math.abs(nv), 2) + (u > 0.2 ? 0.24 * (BSC[i] - 0.5) : 0)
      let c: V3 = [bink[3 * i], bink[3 * i + 1], bink[3 * i + 2]]
      const sh = clamp(lum - 1.0, 0, 0.5); c = mix(c, pal.light, sh)
      proj(p[3 * i], p[3 * i + 1], p[3 * i + 2], n)
      SL[n] = lum; SC[3 * n] = c[0]; SC[3 * n + 1] = c[1]; SC[3 * n + 2] = c[2]; SP[n] = BODY; SG[n] = -1; SA[n] = 1; n++
    }
    // fins
    for (let si = 0; si < SHEETS.length; si++) {
      const s = SHEETS[si], sink = inks[si]
      s.build(t, s); carry(s.local, s.n, t, s.lag, s.p)
      const base = n
      for (let q = 0; q < s.n; q++) proj(s.p[3 * q], s.p[3 * q + 1], s.p[3 * q + 2], base + q)
      const { A, R, K } = s
      for (let k = 0; k < K; k++) for (let i = 0; i < A; i++) for (let j = 0; j < R; j++) {
        const q = (k * A + i) * R + j, i0 = Math.max(i - 1, 0), i1 = Math.min(i + 1, A - 1), j0 = Math.max(j - 1, 0), j1 = Math.min(j + 1, R - 1)
        const qa0 = (k * A + i0) * R + j, qa1 = (k * A + i1) * R + j, qr0 = (k * A + i) * R + j0, qr1 = (k * A + i) * R + j1
        const da: V3 = [s.p[3 * qa1] - s.p[3 * qa0], s.p[3 * qa1 + 1] - s.p[3 * qa0 + 1], s.p[3 * qa1 + 2] - s.p[3 * qa0 + 2]]
        const dr: V3 = [s.p[3 * qr1] - s.p[3 * qr0], s.p[3 * qr1 + 1] - s.p[3 * qr0 + 1], s.p[3 * qr1 + 2] - s.p[3 * qr0 + 2]]
        let nn = unit(cross(da, dr)); if (dot(nn, VIEW) < 0) nn = [-nn[0], -nn[1], -nn[2]]
        const r = s.r[q], a = s.a[q]
        let lum = 0.3 + 0.78 * Math.pow(clamp(dot(nn, KEY), 0, 1), 0.8) + 0.4 * Math.pow(clamp(dot(nn, HALF), 0, 1), 16) + 0.22 * smooth((r - 0.86) / 0.12)
        let c: V3 = [sink[3 * q], sink[3 * q + 1], sink[3 * q + 2]]
        c = mix(c, pal.light, clamp((lum - 0.95) * 0.9, 0, 0.55))
        let glyph = -1
        const m = base + q
        // screen-space derivatives for the rays and the cell coverage
        const dxa = (SX[base + qa1] - SX[base + qa0]) / (i1 - i0 || 1), dya = (SY[base + qa1] - SY[base + qa0]) / (i1 - i0 || 1)
        const dxr = (SX[base + qr1] - SX[base + qr0]) / (j1 - j0 || 1), dyr = (SY[base + qr1] - SY[base + qr0]) / (j1 - j0 || 1)
        if (s.rays && Math.cos(s.rays * TAU * a) > 0.88 && r > 0.14) {
          glyph = slopeChar(dxr, (-dyr / aspect) * (cols / rows)); lum = 0.62 + 0.55 * lum; c = mix(c, pal.light, 0.4)
        }
        SL[m] = lum; SC[3 * m] = c[0]; SC[3 * m + 1] = c[1]; SC[3 * m + 2] = c[2]; SP[m] = s.part(k); SG[m] = glyph
        SA[m] = glyph >= 0 ? 1 : 1.6 * Math.abs(dxa * dyr - dxr * dya) + 0.02
      }
      n += s.n
    }
    // eyes: two dark points on the head
    const eyes = new Float32Array([...body(0.085, 0.42), ...body(0.085, Math.PI - 0.42)]); eyes[2] += 0.012; eyes[5] -= 0.012
    const ep = new Float32Array(6); carry(eyes, 2, t, null, ep)
    for (let e = 0; e < 2; e++) { proj(ep[3 * e], ep[3 * e + 1], ep[3 * e + 2], n); SL[n] = 1.3; SC[3 * n] = pal.ink[0]; SC[3 * n + 1] = pal.ink[1]; SC[3 * n + 2] = pal.ink[2]; SP[n] = MARK; SG[n] = sc("@"); SA[n] = 1; n++ }
    // gill covers
    for (let side = 0; side < 2; side++) {
      const g0 = new Float32Array(16 * 3)
      for (let q = 0; q < 16; q++) { const g = -0.95 + (1.9 * q) / 15, b = body(0.225 + 0.035 * Math.cos(g * 1.4), side ? Math.PI - g : g); g0.set([b[0], b[1], b[2] + (side ? -0.006 : 0.006)], 3 * q) }
      const gp = new Float32Array(16 * 3); carry(g0, 16, t, null, gp)
      const pts: number[][] = []
      for (let q = 0; q < 16; q++) { proj(gp[3 * q], gp[3 * q + 1], gp[3 * q + 2], n + q); pts.push([cam[0] / cam[2], cam[1] / cam[2]]) }
      for (let q = 0; q < 16; q++) { const a = pts[Math.max(q - 1, 0)], b = pts[Math.min(q + 1, 15)]; SL[n] = 1.0; const c = mix(pal.v1, pal.light, 0.3); SC[3 * n] = c[0]; SC[3 * n + 1] = c[1]; SC[3 * n + 2] = c[2]; SP[n] = MARK; SG[n] = slopeChar(b[0] - a[0], b[1] - a[1]); SA[n] = 1; n++ }
    }
  }

  function cellsOf(t: number) {
    zbuf.fill(Infinity); gi.fill(-1); cover.fill(0)
    for (let i = 0; i < n; i++) {
      const x = SX[i], y = SY[i]; if (!(x >= 0 && x < cols && y >= 0 && y < rows && SZ[i] > 0.3)) continue
      const cell = Math.floor(y) * cols + Math.floor(x); cover[cell] += SA[i]
      if (SZ[i] < zbuf[cell]) { zbuf[cell] = SZ[i]; gi[cell] = i }
    }
    outChar.fill(0); outA.fill(0)
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const cell = r * cols + c, g = gi[cell]; if (g < 0) continue
      const prt = SP[g], dep = zbuf[cell], own = SG[g], L = SL[g]
      let gx = 0, gy = 0, edge = false
      if (own < 0) {
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const rr = r + dy, cc = c + dx; let nb = -1, nz = Infinity
          if (rr >= 0 && rr < rows && cc >= 0 && cc < cols) { const gg = gi[rr * cols + cc]; if (gg >= 0) { nb = SP[gg]; nz = zbuf[rr * cols + cc] } }
          const other = nb >= 0 && nb !== prt
          const seam = HARD[prt] && other && HARD[nb] && prt < nb
          if (nb < 0 || (other && nz > dep + 0.035) || seam) { gx += dx; gy += dy; if (!dx || !dy) edge = true }
        }
      }
      const h = HASH[cell]
      let ch: number, bright: number
      if (own >= 0) { ch = own; bright = L }
      else {
        const cov = Math.pow(Math.min(cover[cell], 1), 0.7)
        if (edge) {
          const ax = Math.abs(gx), ay = Math.abs(gy)
          ch = ax + ay === 0 ? sc("+") : ax > 2 * ay ? sc("|") : ay > 2 * ax ? (gy > 0 ? sc("_") : sc("-")) : gx * gy > 0 ? sc("/") : sc("\\")
          bright = Math.max(0.85, L) * (0.3 + 0.7 * cov)
        } else {
          const level = clamp(Math.trunc((L - 0.42) * 4.6), 0, 3)
          ch = FILL[level][(h + Math.trunc(t * 4 + (h % 11))) % 12]
          bright = clamp(0.45 + (0.55 * L) / 0.9, 0.45, 1) * (0.3 + 0.7 * cov)
        }
      }
      outChar[cell] = ch; outR[cell] = SC[3 * g]; outG[cell] = SC[3 * g + 1]; outB[cell] = SC[3 * g + 2]; outA[cell] = clamp(Math.min(bright, 1.4) * 1.0, 0, 1)
    }
  }

  const font = `${Math.round(ch * 0.82)}px ui-monospace,Menlo,Consolas,"DejaVu Sans Mono",monospace`
  /** draw the fish at time t (seconds) onto ctx (transparent canvas, trails kept by fading rather than clearing) */
  function draw(ctx: CanvasRenderingContext2D, t: number) {
    const tc = ((t % LOOP) + LOOP) % LOOP
    scene(tc); cellsOf(tc)
    ctx.globalCompositeOperation = "destination-out"; ctx.fillStyle = "rgba(0,0,0,.5)"; ctx.fillRect(0, 0, cols * cw, rows * ch)   // soft trails
    ctx.globalCompositeOperation = "source-over"
    ctx.font = font; ctx.textAlign = "center"; ctx.textBaseline = "middle"
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const cell = r * cols + c, code = outChar[cell]; if (!code) continue
      ctx.fillStyle = `rgba(${(outR[cell] * 255) | 0},${(outG[cell] * 255) | 0},${(outB[cell] * 255) | 0},${outA[cell].toFixed(2)})`
      ctx.fillText(String.fromCharCode(code), c * cw + cw / 2, r * ch + ch / 2)
    }
    // bubbles rising through empty water
    for (const b of bubbles) {
      const ix = Math.floor(((b[0] + 0.012 * Math.sin(tc * (1 + 2 * b[2]) + b[3] * 40)) % 1) * cols), iy = Math.floor(((((b[1] - tc * (0.02 + 0.06 * b[4])) % 1) + 1) % 1) * rows)
      if (gi[iy * cols + ix] >= 0) continue
      ctx.fillStyle = `rgba(112,145,230,${(0.18 + 0.3 * b[4]).toFixed(2)})`; ctx.fillText(b[4] > 0.7 ? "O" : b[4] > 0.4 ? "o" : ".", ix * cw + cw / 2, iy * ch + ch / 2)
    }
  }
  return { draw, width: cols * cw, height: rows * ch, loop: LOOP }
}
