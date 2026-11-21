// @ts-nocheck
// Background scene + betta sprite (ASCII betta by @dwcminh.ascii, github.com/dwcminh/ascii-art, personal / non-commercial use).
import { rect } from "./utils"
import { createBetta, PALETTES } from "./betta"
const $ = (id) => document.getElementById(id)

const BGW = 200, BGH = 112;
const PLANKTON = Array.from({ length: 70 }, (_, i) => ({ x: (i * 73.13) % BGW, y: (i * 41.7) % BGH, v: 1 + (i % 5) * .5, s: i * .7 }));
/* The fish: ASCII betta by @dwcminh.ascii (github.com/dwcminh/ascii-art), ported to a live canvas renderer (see betta.ts).
   Three of them, one per palette colour, swimming slowly in the free space left and right of the card (never behind it).
   Each is rendered at about 20-30 fps with soft trails into its own offscreen canvas, one render per animation frame at most. */
const FISH_SPEC = [
  { pal: "blue", rows: 40, size: 0.62, side: "left", cy: 0.5, ax: 0.1, ay: 0.06, ph: 0.0, off: 0 },
  { pal: "koi", rows: 32, size: 0.46, side: "right", cy: 0.3, ax: 0.1, ay: 0.07, ph: 2.1, off: 4.7 },
  { pal: "lotus", rows: 26, size: 0.34, side: "right", cy: 0.74, ax: 0.1, ay: 0.05, ph: 4.2, off: 9.3 },
]
const SPEED = 1.7   // swim speed relative to the original timing
const FISH = { list: null, turn: 0 }
export function paintFish(t) {
  const cv = $("fish"); if (!cv) return
  if (!FISH.list) FISH.list = FISH_SPEC.map((s) => {
    const betta = createBetta({ cols: Math.round(s.rows * 1.1), rows: s.rows, cw: 10, ch: 14, palette: PALETTES[s.pal] })   // coarse grid, small glyphs: airy like the original
    const off = document.createElement("canvas"); off.width = betta.width; off.height = betta.height
    const sil = document.createElement("canvas"); sil.width = off.width; sil.height = off.height
    return { s, betta, off, sil, octx: off.getContext("2d"), sctx: sil.getContext("2d"), last: -1 }
  })
  if (cv.width !== innerWidth || cv.height !== innerHeight) { cv.width = innerWidth; cv.height = innerHeight }
  // one render per call, round robin, only if that fish is due (always once before its first draw)
  const k = FISH.turn++ % FISH.list.length, f = FISH.list[k]
  if (f.last < 0 || t - f.last >= 1 / 30 || t < f.last) { f.betta.draw(f.octx, (t + f.s.off) * SPEED); f.last = t
    // dark silhouette of the same frame, drawn slightly offset behind the fish so its contours stand out from the background
    const sc = f.sctx; sc.globalCompositeOperation = "source-over"; sc.clearRect(0, 0, f.sil.width, f.sil.height); sc.drawImage(f.off, 0, 0)
    sc.globalCompositeOperation = "source-in"; sc.fillStyle = "rgba(28,34,80,.55)"; sc.fillRect(0, 0, f.sil.width, f.sil.height) }
  // free space: left and right of the card
  const card = document.querySelector(".card"), r = card ? card.getBoundingClientRect() : { left: innerWidth / 2 - 280, right: innerWidth / 2 + 280 }
  const bands = { left: [0, Math.max(0, r.left - 12)], right: [Math.min(innerWidth, r.right + 12), innerWidth] }
  const c = cv.getContext("2d"); c.clearRect(0, 0, cv.width, cv.height); c.imageSmoothingEnabled = true
  FISH.list.forEach(({ s, off, sil }) => {
    const [x0, x1] = bands[s.side], bw = x1 - x0, asp = off.width / off.height
    if (bw < 120) return                                          // no free space (narrow screen): no fish rather than a fish behind the form
    const H = Math.min(innerHeight * s.size, (bw * 1.1) / asp), W = H * asp
    const cx = (x0 + x1) / 2 + Math.sin(t * 0.17 + s.ph) * Math.max(0, bw - W) * 0.5, cyy = innerHeight * s.cy + Math.sin(t * 0.24 + s.ph * 1.7) * innerHeight * s.ay
    const o = 0.7
    ;[[-o, 0], [o, 0], [0, -o], [0, o]].forEach(([dx, dy]) => c.drawImage(sil, cx - W / 2 + dx, cyy - H / 2 + dy, W, H))
    c.drawImage(off, cx - W / 2, cyy - H / 2, W, H)
  })
}
export function paintBackground(t) {
  const c = $("bg").getContext("2d");
  ["#ede8f5", "#e9e7f6", "#e5e5f6", "#e1e4f6", "#dde3f6", "#d9e1f5"].forEach((col, i) => rect(c, 0, i * 19, BGW, 19, col));
  [[0,24,10],[24,22,17],[46,20,25],[150,20,14],[170,16,24],[186,14,11]].forEach(([x, w, h]) => {   // soft cubes, a nod to the reference
    c.globalAlpha = .9; rect(c, x, BGH - h, w, h, "#f5f2fb"); rect(c, x, BGH - h, w, 2, "#ffffff"); rect(c, x + w - 3, BGH - h + 2, 3, h - 2, "#dfe3f4"); c.globalAlpha = 1;
  });
  c.globalAlpha = .5;
  for (let k = 0; k < 5; k++) { const y0 = (k * 24 + t * 2) % BGH; for (let x = 0; x < BGW; x += 3) if (Math.sin(x * .21 + t * .8 + k * 2) > .35) rect(c, x, y0 + Math.sin(x * .09 + t + k) * 1.5, 2, 1, "#ffffff"); }
  c.globalAlpha = 1;
  PLANKTON.forEach((p, i) => {
    const x = (p.x + Math.sin(t * .4 + p.s) * 3 + BGW) % BGW, y = ((p.y - t * p.v * .8) % BGH + BGH) % BGH;
    c.globalAlpha = .35 + .35 * Math.abs(Math.sin(t * .9 + p.s)); rect(c, x, y, 1, 1, i % 3 ? "#ffffff" : "#adbbda");
  });
  c.globalAlpha = 1;
}
