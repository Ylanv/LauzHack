// @ts-nocheck
// Background scene + betta sprite (ASCII betta by @dwcminh.ascii, github.com/dwcminh/ascii-art, personal / non-commercial use).
import { rect } from "./utils"
const $ = (id) => document.getElementById(id)

const BGW = 200, BGH = 112;
const PLANKTON = Array.from({ length: 70 }, (_, i) => ({ x: (i * 73.13) % BGW, y: (i * 41.7) % BGH, v: 1 + (i % 5) * .5, s: i * .7 }));
/* The fish: the original ASCII betta by @dwcminh.ascii (github.com/dwcminh/ascii-art/tree/main/BETTA-FISH), not a re-implementation.
   It plays the repo's own reel.mp4 (30 fps), cropped to the fish (the HUD and the code panel are left out), with black turned into
   transparency so it swims on the light background. Fallback: the README's preview.gif (6 fps).
   The media are NOT in git (the licence does not allow reposting them): they are read from public/original/ when present;
   without them there is simply no fish. */
const SRC = {
  video: { url: "/original/reel.mp4", crop: [0, 52, 1080, 1100] },       // x, y, w, h in the 1080x1920 reel
  gif: { url: "/original/preview.gif", crop: [0, 18, 300, 298] },       // in the 300x360 gif
}
const SWIM = { x: null, y: 0, dir: 1, lane: 0, last: 0 }
const ORIG = { state: "idle", kind: "", raw: null, crop: null, dirty: false, out: null, octx: null, dec: null, n: 0, i: 0, next: 0, busy: false, rawCtx: null }

function startVideo() {
  const v = document.createElement("video")
  Object.assign(v, { src: SRC.video.url, muted: true, loop: true, playsInline: true, autoplay: true, preload: "auto" })
  v.setAttribute("aria-hidden", "true"); v.style.cssText = "position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none"
  v.addEventListener("error", () => { v.remove(); startGif() }, { once: true })
  v.addEventListener("playing", () => {
    ORIG.state = "ready"; ORIG.kind = "video"; ORIG.raw = v; ORIG.crop = SRC.video.crop; ORIG.dirty = true
    if (v.requestVideoFrameCallback) { const on = () => { ORIG.dirty = true; v.requestVideoFrameCallback(on) }; v.requestVideoFrameCallback(on) }
  }, { once: true })
  document.body.appendChild(v)
  v.play().catch(() => {})
}
async function startGif() {
  try {
    if (!("ImageDecoder" in window)) throw new Error("no ImageDecoder")
    const r = await fetch(SRC.gif.url); if (!r.ok || !(r.headers.get("content-type") || "").includes("gif")) throw new Error("no gif")
    const dec = new ImageDecoder({ data: await r.arrayBuffer(), type: "image/gif" }); await dec.tracks.ready; await dec.completed
    const raw = document.createElement("canvas"); raw.width = 300; raw.height = 360
    Object.assign(ORIG, { dec, n: dec.tracks.selectedTrack.frameCount, raw, rawCtx: raw.getContext("2d"), crop: SRC.gif.crop, kind: "gif", state: "ready" })
  } catch { ORIG.state = "none" }
}
async function gifFrame(now) {
  ORIG.busy = true
  try { const { image } = await ORIG.dec.decode({ frameIndex: ORIG.i }); ORIG.rawCtx.clearRect(0, 0, 300, 360); ORIG.rawCtx.drawImage(image, 0, 0); ORIG.next = now + (image.duration ? image.duration / 1000 : 160); image.close(); ORIG.i = (ORIG.i + 1) % ORIG.n; ORIG.dirty = true }
  finally { ORIG.busy = false }
}
/** scale the current frame to its on-screen size (device pixels), then light-on-black -> the same colour with its brightness as opacity */
function keyFrame(w, h) {
  if (!ORIG.out) { ORIG.out = document.createElement("canvas"); ORIG.octx = ORIG.out.getContext("2d", { willReadFrequently: true }) }
  const o = ORIG.out, c = ORIG.octx
  if (o.width !== w || o.height !== h) { o.width = w; o.height = h }
  const [sx, sy, sw, sh] = ORIG.crop
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = "high"; c.clearRect(0, 0, w, h); c.drawImage(ORIG.raw, sx, sy, sw, sh, 0, 0, w, h)
  const d = c.getImageData(0, 0, w, h), p = d.data
  for (let k = 0; k < p.length; k += 4) {
    const m = Math.max(p[k], p[k + 1], p[k + 2])
    if (m < 10) { p[k + 3] = 0; continue }
    const s = 255 / m; p[k] *= s; p[k + 1] *= s; p[k + 2] *= s; p[k + 3] = Math.min(255, m * 1.15)
  }
  c.putImageData(d, 0, 0)
}

/** still: reduced motion, keep the first frame shown and do not animate */
export function paintFish(still = false) {
  const cv = $("fish"); if (!cv) return
  if (ORIG.state === "idle") { ORIG.state = "loading"; startVideo() }
  const now = performance.now()
  if (ORIG.kind === "gif" && !ORIG.busy && now >= ORIG.next && !(still && ORIG.out)) gifFrame(now)
  if (ORIG.kind === "video" && still && ORIG.out && !ORIG.raw.paused) ORIG.raw.pause()
  const dpr = Math.min(2, devicePixelRatio || 1), pw = Math.round(innerWidth * dpr), ph = Math.round(innerHeight * dpr)
  const c = cv.getContext("2d")
  if (cv.width !== pw || cv.height !== ph) { cv.width = pw; cv.height = ph; ORIG.dirty = true }
  if (ORIG.state !== "ready") return
  // one fish swimming across the whole screen, back and forth at a new height each time. Slow in the open, quick behind the card:
  // it never lingers under the form.
  const [, , sw, sh] = ORIG.crop, asp = sw / sh
  const H = Math.min(innerHeight * 0.72, 640), W = H * asp
  const card = document.querySelector(".card"), r = card ? card.getBoundingClientRect() : null
  const dt = Math.min(0.1, (now - (SWIM.last || now)) / 1000); SWIM.last = now
  if (SWIM.x === null) { SWIM.x = r ? Math.max(W / 2 + 10, r.left / 2) : innerWidth * 0.25; SWIM.y = innerHeight / 2 }
  const behind = r && SWIM.x + W * 0.3 > r.left && SWIM.x - W * 0.3 < r.right
  if (!still) SWIM.x += SWIM.dir * (behind ? 420 : 38) * dt
  if (SWIM.x > innerWidth + W / 2 || SWIM.x < -W / 2) {   // off screen: turn back at another height
    SWIM.dir *= -1; SWIM.lane = (SWIM.lane + 1) % 3
    SWIM.x = SWIM.dir > 0 ? -W / 2 : innerWidth + W / 2
  }
  const ty = innerHeight * [0.5, 0.36, 0.64][SWIM.lane]; SWIM.y += (ty - SWIM.y) * Math.min(1, dt * 0.5)
  const x = SWIM.x - W / 2, y = SWIM.y - H / 2 + Math.sin(now / 2400) * innerHeight * 0.03
  const w = Math.round(W * dpr), h = Math.round(H * dpr)
  if (ORIG.dirty || !ORIG.out || ORIG.out.width !== w) { ORIG.dirty = false; keyFrame(w, h) }
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, cv.width, cv.height)
  c.shadowColor = "rgba(28,34,80,.4)"; c.shadowBlur = 1.5 * dpr   // a hair of shade so pale letters still read on the light background
  if (SWIM.dir > 0) { c.translate(Math.round((x + W) * dpr), Math.round(y * dpr)); c.scale(-1, 1); c.drawImage(ORIG.out, 0, 0) }   // the reel's fish faces left: mirrored when it swims right
  else c.drawImage(ORIG.out, Math.round(x * dpr), Math.round(y * dpr))
  c.setTransform(1, 0, 0, 1, 0, 0); c.shadowColor = "transparent"
}export function paintBackground(t) {
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
