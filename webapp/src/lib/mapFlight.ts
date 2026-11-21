// Cinematic waiting-screen map: a real satellite globe (MapLibre GL, globe projection) driven by the pipeline status.
// Single input: MapFlight.update({ step, progress, coords }). The camera follows the real step; it never runs on a timer.
//   identity -> spinning globe | identity_done -> aim at Europe | zoom -> Europe > Switzerland > canton > town > building
//   focus -> aerial card (real SWISSIMAGE tile) | scan -> pulse | done
// Map: a light palette-coloured style (Natural Earth world, swisstopo vector map); SWISSIMAGE satellite only for the last metres. A transparent canvas draws overlays.
import { Map as MLMap } from "maplibre-gl"
import "maplibre-gl/dist/maplibre-gl.css"
import type { Coords, FlightStep, Insight } from "../pipeline/types"
import { drawAerial } from "./aerialFallback"
import { analyseSurroundings, type Feat } from "./surroundings"
import { buildStyle } from "./worldStyle"

const D = Math.PI / 180, TAU = Math.PI * 2
const clampF = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const sm = (x: number) => { x = clampF(x, 0, 1); return x * x * (3 - 2 * x) }
const fade = (v: number, a: number, b: number) => sm((v - a) / (b - a))
const backOut = (x: number) => { x = clampF(x, 0, 1); const c = 1.70158; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2) }
const angDiff = (a: number, b: number) => ((((b - a + 180) % 360) + 360) % 360) - 180

const CAPTION: Record<FlightStep, string> = { identity: "Locating the company", identity_done: "Address resolved", zoom: "Closing in on the building", focus: "Reading the aerial image", scan: "Checking public information", done: "File complete" }
const OBS = [{ k: "Roof", v: "Flat, with rooflights", x: 40, y: 31, at: 0.3 }, { k: "Solar panels", v: "East part of the roof", x: 67, y: 33, at: 0.55 }, { k: "Vegetation", v: "Tree line to the north", x: 32, y: 12, at: 0.8 }]
const Z_BUILDING = 17.3
// Keep the waiting screen light: satellite imagery only. Flip to true to bring back hazard zones, legend, the aerial card and the finding cards.
const SHOW_OVERLAYS = false
// Insurance-relevant surroundings read from the swisstopo vector map (no model, no tokens): own footprint, neighbour, main road, water, forest.
const SHOW_FEATURES = true
const PITCH_MAX = 0   // flat top-down view

export const MapFlight = (() => {
  let map: MLMap | null = null
  let cv: HTMLCanvasElement, ctx: CanvasRenderingContext2D
  let W = 0, H = 0, dpr = 1, panelW = 0, cxm = 0, cy = 0, vig: CanvasGradient | null = null
  let isStatic = false, lastNow = 0, AER: HTMLCanvasElement | null = null
  let aRect: { x: number; y: number; w: number; h: number } | null = null
  const S = { step: "identity" as FlightStep, progress: 0, coords: { lon: 7.36333, lat: 46.22724, label: "Valais (VS)", cantonId: 23 } as Coords }
  const cam = { lon: 0, lat: 22, zoom: 1.8 }
  const anim = { z: 0, marker: 0, aerial: 0, inset: 0, hz: [0, 0, 0], obsAt: [-1, -1, -1], capA: 1, capText: "", t: 0 }
  const INS = { q: [] as Insight[], shown: [] as (Insight & { t0: number })[], last: -9 }
  let variant: "A" | "B" = "A", appliedVariant = "", free = false
  const inset = { t0: -1 }
  const aer = { key: "", img: null as HTMLCanvasElement | null, ok: false, fail: false }

  const avail = () => Math.min(W - panelW, H)
  const zGlobe = () => Math.log2((TAU * avail() * 0.36) / 512)

  function resize() {
    dpr = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr)
    panelW = 0; cy = H / 2
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62)
    g.addColorStop(0, "rgba(237,232,245,0)"); g.addColorStop(1, "rgba(237,232,245,.30)"); vig = g
    map?.resize()
  }

  /** Real SWISSIMAGE aerial for the address: a mosaic of 5x5 WMTS tiles (zoom 18) cropped to 800x500 px, about 330 m across. Falls back to an illustration. */
  function loadAerial() {
    if (!SHOW_OVERLAYS && variant !== "A") return
    const b = S.coords, key = b.lon.toFixed(5) + "," + b.lat.toFixed(5)
    if (aer.key === key) return
    aer.key = key; aer.ok = false; aer.fail = false; aer.img = null
    const Z = AZ, n = 2 ** Z, fx = ((b.lon + 180) / 360) * n, fy = ((1 - Math.log(Math.tan(b.lat * D) + 1 / Math.cos(b.lat * D)) / Math.PI) / 2) * n
    const tx = Math.floor(fx), ty = Math.floor(fy), cvs = document.createElement("canvas"); cvs.width = AW; cvs.height = AH
    const c2 = cvs.getContext("2d")!; c2.fillStyle = "#e1e4f6"; c2.fillRect(0, 0, AW, AH)
    let errs = 0, good = 0
    for (let j = -2; j <= 2; j++) for (let i = -2; i <= 2; i++) {
      const img = new Image()
      img.onload = () => { if (aer.key !== key) return; c2.drawImage(img, Math.round((tx + i - fx) * 256 + AW / 2), Math.round((ty + j - fy) * 256 + AH / 2)); good++; aer.img = cvs; aer.ok = true }
      img.onerror = () => { if (aer.key === key && ++errs === 25 && !good) aer.fail = true }
      img.src = `https://wmts.geo.admin.ch/1.0.0/ch.swisstopo.swissimage/default/current/3857/${Z}/${tx + i}/${ty + j}.jpeg`
    }
  }
  /* metres east/north of the building -> screen */
  const m = (e: number, n: number) => {
    const b = S.coords
    return map!.project([b.lon + e / (111320 * Math.cos(b.lat * D)), b.lat + n / 110574])
  }
  const mpx = () => { const a = m(0, 0), c = m(100, 0); return Math.hypot(c.x - a.x, c.y - a.y) / 100 }
  const poly = (pts: number[][], close = false) => { ctx.beginPath(); pts.forEach(([e, n], i) => { const p = m(e, n); i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y) }); if (close) ctx.closePath() }
  const text = (s: string, x: number, y: number, size: number, weight: number, col: string, align: CanvasTextAlign = "left", ls = 0) => {
    ctx.font = `${weight} ${size}px system-ui,-apple-system,"Segoe UI",sans-serif`; ctx.fillStyle = col; ctx.textAlign = align; ctx.textBaseline = "middle"
    if ("letterSpacing" in ctx) (ctx as any).letterSpacing = ls + "px"
    ctx.fillText(s, x, y)
  }
  const rrect = (x: number, y: number, w: number, h: number, r: number) => { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath() }
  const wrap = (str: string, maxW: number, font: string) => { ctx.font = font; const out: string[] = []; let line = ""; str.split(" ").forEach((w) => { const tt = line ? line + " " + w : w; if (ctx.measureText(tt).width > maxW && line) { out.push(line); line = w } else line = tt }); if (line) out.push(line); return out }

  function drawHazards(t: number) {
    const px = mpx(), A = anim.hz
    if (A[0] > 0.01) { // surface runoff (illustrative)
      const pts = [[260, 150], [150, 70], [70, -5], [42, -30], [15, -80], [-60, -150], [-200, -230]]
      ctx.globalAlpha = A[0]; ctx.lineCap = "round"; ctx.lineJoin = "round"; poly(pts); ctx.strokeStyle = "rgba(112,145,230,.55)"; ctx.lineWidth = Math.max(3, 18 * px); ctx.stroke()
      ctx.strokeStyle = "rgba(223,228,246,.85)"; ctx.lineWidth = Math.max(1.2, 5 * px); if (!isStatic) { ctx.setLineDash([14, 12]); ctx.lineDashOffset = -t * 20 } poly(pts); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1
    }
    if (A[1] > 0.01) { // hail
      ctx.globalAlpha = A[1]; ctx.fillStyle = "rgba(223,228,246,.9)"
      for (let i = 0; i < 110; i++) { const a = i * 2.399, r = 250 * Math.sqrt((i + 0.5) / 110), p = m(r * Math.cos(a), r * Math.sin(a)); ctx.fillRect(p.x - 1, p.y - 1, 2.2, 2.2) }
      poly(Array.from({ length: 41 }, (_, i) => [250 * Math.cos((i / 40) * TAU), 250 * Math.sin((i / 40) * TAU)]), true); ctx.strokeStyle = "rgba(223,228,246,.5)"; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1
    }
    if (A[2] > 0.01) { // seismic zone
      ctx.globalAlpha = A[2];[260, 150, 70].forEach((r) => { poly(Array.from({ length: 49 }, (_, i) => [r * Math.cos((i / 48) * TAU), r * Math.sin((i / 48) * TAU)]), true); ctx.fillStyle = "rgba(61,82,160,.16)"; ctx.fill(); ctx.setLineDash([5, 7]); ctx.strokeStyle = "rgba(223,228,246,.7)"; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]) })
      const p = m(0, 275); text("Z3a", p.x, p.y - 8, 12, 400, "rgba(255,255,255,.95)", "center", 2); ctx.globalAlpha = 1
    }
  }

  function drawMarker(t: number) {
    const ma = anim.marker; if (ma < 0.01) return
    const b = S.coords, p = map!.project([b.lon, b.lat])
    const ph = isStatic ? 0.5 : (t % 2) / 2
    ctx.globalAlpha = ma
    ctx.strokeStyle = "rgba(61,82,160," + (1 - ph) * 0.85 + ")"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 7 + ph * 30, 0, TAU); ctx.stroke()
    ctx.fillStyle = "#3d52a0"; ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, TAU); ctx.fill()
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.5; ctx.stroke(); ctx.globalAlpha = 1
  }
  function drawLegend() {
    const lg: [string, string][] = [["Surface runoff · medium", "rgba(112,145,230,.9)"], ["Hail · moderate frequency", "rgba(223,228,246,.9)"], ["Seismic zone Z3a", "rgba(173,187,218,.9)"]]
    if (anim.hz[0] <= 0.02) return
    ctx.font = "300 12px system-ui,sans-serif"; if ("letterSpacing" in ctx) (ctx as any).letterSpacing = ".5px"
    const ws = lg.map((l) => ctx.measureText(l[0]).width + 26), tot = ws.reduce((a, b) => a + b, 0); let x = cxm - tot / 2; const y = H - 44
    ctx.save(); ctx.fillStyle = "rgba(10,14,46,.55)"; rrect(x - 14, y - 15, tot + 22, 30, 15); ctx.fill(); ctx.restore()
    lg.forEach((l, i) => { const a = anim.hz[i]; if (a > 0.02) { ctx.globalAlpha = a; ctx.fillStyle = l[1]; ctx.beginPath(); ctx.arc(x + 5, y, 3.5, 0, TAU); ctx.fill(); text(l[0], x + 16, y, 12, 300, "#dfe4f6", "left", 0.5); ctx.globalAlpha = 1 } x += ws[i] })
  }

  function drawAerialCard(t: number) {
    const a = anim.aerial; aRect = null; if (a < 0.01) return
    const availW = W - panelW, wide = panelW > 0, cw = wide ? Math.min(availW * 0.36, 470, H * 0.52 * 1.6) : Math.min(W - 40, 420), ch = (cw * 80) / 128
    const x = wide ? panelW + availW - cw - 40 : (W - cw) / 2, y = wide ? cy - ch / 2 - 60 : H - ch - 190, k = cw / 128; aRect = { x, y, w: cw, h: ch }
    ctx.save(); ctx.globalAlpha = a * 0.22; ctx.fillStyle = "#050719"; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = a
    ctx.shadowColor = "rgba(0,0,0,.5)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 18; rrect(x, y, cw, ch, 16); ctx.fillStyle = "#222"; ctx.fill(); ctx.shadowColor = "transparent"
    ctx.save(); rrect(x, y, cw, ch, 16); ctx.clip()
    const real = aer.ok && aer.img
    if (real) { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; ctx.drawImage(aer.img!, x, y, cw, ch) }
    else if (aer.fail) { if (!AER) { AER = document.createElement("canvas"); drawAerial(AER) } ctx.imageSmoothingEnabled = false; ctx.drawImage(AER, x, y, cw, ch) }
    else text("Loading aerial image", x + cw / 2, y + ch / 2, 13, 300, "#adbbda", "center", 1)
    if (S.step === "scan" && !isStatic) { const q = (t % 2.6) / 2.6, yy = y + q * ch, gg = ctx.createLinearGradient(0, yy - 40, 0, yy); gg.addColorStop(0, "rgba(223,228,246,0)"); gg.addColorStop(1, "rgba(223,228,246,.28)"); ctx.fillStyle = gg; ctx.fillRect(x, yy - 40, cw, 40); ctx.fillStyle = "rgba(242,244,255,.9)"; ctx.fillRect(x, yy, cw, 1.4) }
    ctx.restore(); rrect(x, y, cw, ch, 16); ctx.strokeStyle = "rgba(223,228,246,.45)"; ctx.lineWidth = 1; ctx.stroke()
    if (real) { // address point on the real image (the true footprint comes from RegBL / 3D data later)
      const px = x + cw / 2, py = y + ch / 2, ph = isStatic ? 0.5 : (t % 2.2) / 2.2
      ctx.strokeStyle = "rgba(242,244,255," + (1 - ph) * 0.9 + ")"; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.arc(px, py, 8 + ph * 26, 0, TAU); ctx.stroke()
      ctx.strokeStyle = "#f2f4ff"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(px, py, 7, 0, TAU); ctx.stroke(); ctx.fillStyle = "#f2f4ff"; ctx.beginPath(); ctx.arc(px, py, 2.4, 0, TAU); ctx.fill()
      ctx.globalAlpha = a * 0.85; text("SWISSIMAGE · © swisstopo", x, y + ch + 22, 11, 300, "#adbbda", "left", 1.2)
      text(`${S.coords.lat.toFixed(5)}° N · ${S.coords.lon.toFixed(5)}° E · about 170 m across`, x, y + ch + 42, 12, 300, "#fff", "left", 0.3)
    } else if (aer.fail) { // illustrative fallback: footprint and observations
      const fx = x + 26 * k, fy = y + 20 * k, fw = 52 * k, fh = 26 * k
      ctx.strokeStyle = "#f2f4ff"; ctx.lineWidth = 2; ctx.strokeRect(fx, fy, fw, fh); ctx.fillStyle = "rgba(112,145,230,.16)"; ctx.fillRect(fx, fy, fw, fh)
      OBS.forEach((o, i) => {
        if (anim.obsAt[i] < 0) return; const pp = isStatic ? 1 : backOut((t - anim.obsAt[i]) / 0.45); if (pp <= 0.01) return
        ctx.globalAlpha = a * Math.min(1, pp); const mx = x + o.x * k, my = y + o.y * k
        ctx.save(); ctx.translate(mx, my); ctx.scale(pp, pp); ctx.beginPath(); ctx.arc(0, 0, 10, 0, TAU); ctx.fillStyle = "rgba(10,14,46,.88)"; ctx.fill(); ctx.strokeStyle = "#f2f4ff"; ctx.lineWidth = 1.2; ctx.stroke(); text(String(i + 1), 0, 0.5, 11, 400, "#fff", "center", 0); ctx.restore()
        const ry = y + ch + 36 + i * 46; ctx.beginPath(); ctx.arc(x + 11, ry, 10, 0, TAU); ctx.fillStyle = "rgba(10,14,46,.88)"; ctx.fill(); ctx.strokeStyle = "rgba(223,228,246,.8)"; ctx.lineWidth = 1; ctx.stroke(); text(String(i + 1), x + 11, ry + 0.5, 11, 400, "#fff", "center", 0)
        text(o.k.toUpperCase(), x + 32, ry - 8, 11, 300, "#8697c4", "left", 2.5); text(o.v, x + 32, ry + 10, 14, 300, "#fff", "left", 0.2)
      })
      ctx.globalAlpha = a * 0.7; text("Illustrative image, SWISSIMAGE unavailable", x, y + ch + 36 + 3 * 46 - 12, 11, 300, "#8697c4", "left", 1.2)
    }
    ctx.restore()
  }

  const insA = (i: { t0: number }, t: number) => (isStatic ? 1 : sm((t - i.t0) / 0.6))
  function drawInsights(t: number) {
    if (!INS.shown.length) return; let slot = 0
    INS.shown.forEach((i) => {
      const a = insA(i, t), pop = isStatic ? 1 : backOut((t - i.t0) / 0.5); if (a < 0.01) return
      const w = 214, font = "300 12px system-ui,sans-serif", tl = wrap(i.title, w - 24, "400 14px system-ui,sans-serif"), nl = wrap(i.note, w - 24, font), h = 18 + tl.length * 18 + nl.length * 16 + 12
      const maxX = (aRect && anim.aerial > 0.5 ? aRect.x : W) - 16 - w
      const SL: Record<string, [number, number]> = { wood: [panelW + 24, cy - 215], road: [cxm - w / 2 - 20, 84], bld: [cxm + 60, cy - 12], river: [cxm - 40, Math.min(cy + 175, H - 110 - h)] }
      let bx: number, by: number
      if (SL[i.id]) { bx = clampF(SL[i.id][0], panelW + 16, maxX); by = clampF(SL[i.id][1], 80, H - 100 - h) }
      else { bx = panelW + 28; by = H - 150 - h + 40 - slot * (h + 12); slot++ }
      ctx.save(); ctx.globalAlpha = a
      ctx.translate(bx + w / 2, by + h / 2); ctx.scale(0.94 + 0.06 * Math.min(1, pop), 0.94 + 0.06 * Math.min(1, pop)); ctx.translate(-(bx + w / 2), -(by + h / 2))
      rrect(bx, by, w, h, 12); ctx.fillStyle = "rgba(10,14,46,.86)"; ctx.fill(); ctx.strokeStyle = "rgba(173,187,218,.35)"; ctx.lineWidth = 1; ctx.stroke()
      let yy = by + 17; text(i.kicker.toUpperCase(), bx + 12, yy, 10, 300, "#8697c4", "left", 2); yy += 20
      tl.forEach((l) => { text(l, bx + 12, yy, 14, 400, "#fff", "left", 0); yy += 18 }); yy += 1
      nl.forEach((l) => { text(l, bx + 12, yy, 12, 300, "#adbbda", "left", 0.1); yy += 16 })
      ctx.restore()
    })
  }

  /* ---- surroundings: nearest building footprint, neighbour, main road, water and forest, from the vector tiles ---- */
  const FE = { list: [] as Feat[], tries: 0, last: -9, done: false }
  const KIND = { building: { col: "#3d52a0", tag: "Building", title: "Your building" }, neighbour: { col: "#3d52a0", tag: "Fire spread", title: "Neighbouring building" }, road: { col: "#7091e6", tag: "Access", title: "Main road" }, water: { col: "#7091e6", tag: "Flood exposure", title: "Water" }, forest: { col: "#8697c4", tag: "Wildfire, storm", title: "Wooded area" } } as const
  const distLabel = (d: number) => (d < 3 ? "adjoining" : d < 100 ? Math.round(d / 5) * 5 + " m" : Math.round(d / 10) * 10 + " m")

  const tracePath = (geom: any) => {
    const ringPath = (pts: number[][], close: boolean) => { pts.forEach((p, i) => { const s = map!.project([p[0], p[1]]); i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y) }); if (close) ctx.closePath() }
    if (geom.type === "Polygon") geom.coordinates.forEach((r: number[][]) => ringPath(r, true))
    else if (geom.type === "MultiPolygon") geom.coordinates.forEach((p: number[][][]) => p.forEach((r) => ringPath(r, true)))
    else if (geom.type === "LineString") ringPath(geom.coordinates, false)
    else if (geom.type === "MultiLineString") geom.coordinates.forEach((l: number[][]) => ringPath(l, false))
  }

  /** Highlighted geometry, then tidy cards in two columns beside the building, joined to their feature by a thin elbow leader. */
  function drawFeatures(t: number) {
    const vis = FE.list.filter((f) => f.t0 >= 0).map((f) => ({ f, a: isStatic ? 1 : sm((t - f.t0) / 0.7) })).filter((v) => v.a >= 0.01)
    if (!vis.length) return
    vis.forEach(({ f, a }) => {
      const K = KIND[f.kind], isPoly = f.geom.type.includes("Polygon"), thin = f.kind === "road" || (f.kind === "water" && !isPoly)
      ctx.save(); ctx.globalAlpha = a; ctx.lineJoin = "round"; ctx.lineCap = "round"
      ctx.beginPath(); tracePath(f.geom)
      if (isPoly) { ctx.fillStyle = f.kind === "forest" ? "rgba(134,151,196,.34)" : f.kind === "water" ? "rgba(112,145,230,.34)" : "rgba(61,82,160,.30)"; ctx.fill() }
      ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.lineWidth = thin ? 6 : 4.5; ctx.stroke()
      ctx.strokeStyle = K.col; ctx.lineWidth = thin ? 3 : 2; if (f.kind === "road" && !isStatic) { ctx.setLineDash([9, 7]); ctx.lineDashOffset = -t * 16 } ctx.stroke(); ctx.setLineDash([])
      ctx.restore()
    })
    // cards
    const cards = vis.map(({ f, a }) => {
      const K = KIND[f.kind], p = map!.project(f.at), main = f.kind === "building" ? K.title : `${f.name || K.title} · ${distLabel(f.d)}`
      ctx.font = "650 13px system-ui,sans-serif"; const w1 = ctx.measureText(main).width
      return { f, a, K, p, main, w: Math.max(150, w1 + 38), h: 42, side: p.x < cxm ? -1 : 1, y: 0 }
    })
    const gap = 10, top = 84, bottom = H - 64
    ;[-1, 1].forEach((side) => {
      const col = cards.filter((c) => c.side === side).sort((x, y) => x.p.y - y.p.y)
      const lo = side === 1 && variant === "A" ? Math.max(top, insetBottom + 14) : top
      col.forEach((c) => { c.y = clampF(c.p.y - c.h / 2, lo, bottom - c.h) })
      for (let i = 1; i < col.length; i++) col[i].y = Math.max(col[i].y, col[i - 1].y + col[i - 1].h + gap)
      for (let i = col.length - 2; i >= 0; i--) col[i].y = Math.min(col[i].y, col[i + 1].y - col[i].h - gap)
      if (col.length && col[0].y < lo) { col[0].y = lo; for (let i = 1; i < col.length; i++) col[i].y = Math.max(col[i].y, col[i - 1].y + col[i - 1].h + gap) }
    })
    const dx = Math.min(250, Math.max(120, W / 2 - 220))
    cards.forEach(({ a, K, p, main, w, h, side, y }) => {
      const bx = clampF(side < 0 ? cxm - dx - w : cxm + dx, 16, W - w - 16), by = y
      const ex = side < 0 ? bx + w : bx, ey = by + h / 2, mx = ex - side * 20
      ctx.save(); ctx.globalAlpha = a; ctx.lineJoin = "round"
      ctx.strokeStyle = K.col; ctx.globalAlpha = a * 0.75; ctx.lineWidth = 1.25; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(mx, ey); ctx.lineTo(ex, ey); ctx.stroke(); ctx.globalAlpha = a
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, TAU); ctx.fill(); ctx.lineWidth = 2; ctx.stroke()
      ctx.shadowColor = "rgba(61,82,160,.22)"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6; rrect(bx, by, w, h, 12); ctx.fillStyle = "rgba(255,255,255,.97)"; ctx.fill(); ctx.shadowColor = "transparent"
      ctx.fillStyle = K.col; rrect(bx + 13, by + 11, 7, 7, 2.5); ctx.fill()
      text(K.tag.toUpperCase(), bx + 26, by + 14.5, 9.5, 600, "#8697c4", "left", 1.1)
      text(main, bx + 13, by + 29.5, 13, 650, "#1c2250", "left", 0)
      ctx.restore()
    })
  }

  /* ---- variant A: satellite window annotated with the insurance-relevant features (vector footprints drawn on the real image) ---- */
  const AW = 800, AH = 500, AZ = 18   // aerial mosaic: 800x500 px at zoom 18, about 330 m across in Switzerland
  const groundW = () => (AW * 156543.03392 * Math.cos(S.coords.lat * D)) / 2 ** AZ
  const ZC: Record<Feat["kind"], string> = { building: "#ffffff", neighbour: "#ff8a3d", road: "#e5383b", water: "#12b5cb", forest: "#2fb344" }
  const ZT: Record<Feat["kind"], string> = { building: "Your building", neighbour: "Neighbour", road: "Main road", water: "Water", forest: "Forest" }
  const ZORDER: Feat["kind"][] = ["forest", "water", "road", "neighbour", "building"]
  const HAZ = ["Runoff · medium", "Hail · moderate", "Seismic Z3a"]
  const pats: Record<string, CanvasPattern | null> = {}
  const hatch = (col: string) => {
    if (pats[col] !== undefined) return pats[col]
    const p = document.createElement("canvas"); p.width = p.height = 9; const c = p.getContext("2d")!
    c.strokeStyle = col; c.lineWidth = 1.6; c.beginPath(); c.moveTo(-1, 10); c.lineTo(10, -1); c.moveTo(-1, 1); c.lineTo(1, -1); c.moveTo(8, 10); c.lineTo(10, 8); c.stroke()
    return (pats[col] = ctx.createPattern(p, "repeat"))
  }
  let insetBottom = 0
  function drawInset(t: number) {
    const a = anim.inset; insetBottom = 0; if (a < 0.01 || variant !== "A") return
    const cw = Math.min(470, W - 32), pad = 10, iw = cw - pad * 2, ih = (iw * AH) / AW, head = 30, foot = 52, h = pad + head + ih + foot
    const x = W - cw - 24, y = 22 + (1 - a) * -10; insetBottom = 22 + h
    ctx.save(); ctx.globalAlpha = a
    ctx.shadowColor = "rgba(61,82,160,.28)"; ctx.shadowBlur = 30; ctx.shadowOffsetY = 12; rrect(x, y, cw, h, 20); ctx.fillStyle = "rgba(255,255,255,.97)"; ctx.fill(); ctx.shadowColor = "transparent"
    const GWm = groundW(), GHm = (GWm * AH) / AW
    text("SATELLITE · SURROUNDINGS", x + pad + 4, y + pad + 12, 10, 600, "#8697c4", "left", 1.4)
    text(Math.round(GWm / 10) * 10 + " m across", x + cw - pad - 4, y + pad + 12, 10, 600, "#adbbda", "right", 0.4)
    const ix = x + pad, iy = y + pad + head, b = S.coords, kx = 111320 * Math.cos(b.lat * D), ky = 110574
    const toPx = (p: number[]) => [ix + iw * (0.5 + ((p[0] - b.lon) * kx) / GWm), iy + ih * (0.5 - ((p[1] - b.lat) * ky) / GHm)]
    const path = (geom: any) => {
      const ring = (pts: number[][], close: boolean) => { pts.forEach((p, k) => { const [px, py] = toPx(p); k ? ctx.lineTo(px, py) : ctx.moveTo(px, py) }); if (close) ctx.closePath() }
      if (geom.type === "Polygon") geom.coordinates.forEach((r: number[][]) => ring(r, true))
      else if (geom.type === "MultiPolygon") geom.coordinates.forEach((pp: number[][][]) => pp.forEach((r) => ring(r, true)))
      else if (geom.type === "LineString") ring(geom.coordinates, false)
      else if (geom.type === "MultiLineString") geom.coordinates.forEach((l: number[][]) => ring(l, false))
    }
    // the image
    ctx.save(); rrect(ix, iy, iw, ih, 13); ctx.clip()
    if (aer.ok && aer.img) { ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high"; ctx.drawImage(aer.img, ix, iy, iw, ih); ctx.fillStyle = "rgba(10,14,46,.14)"; ctx.fillRect(ix, iy, iw, ih) }
    else if (aer.fail) { if (!AER) { AER = document.createElement("canvas"); drawAerial(AER) } ctx.imageSmoothingEnabled = false; ctx.drawImage(AER, ix, iy, iw, ih) }
    else { ctx.fillStyle = "#e1e4f6"; ctx.fillRect(ix, iy, iw, ih); text("Loading aerial image", ix + iw / 2, iy + ih / 2, 12, 400, "#8697c4", "center", 0.6) }
    // zones: hatched and outlined footprints, one colour per kind
    const vis = FE.list.filter((f) => f.t0 >= 0).map((f) => ({ f, a: isStatic ? 1 : sm((t - f.t0) / 0.7) })).filter((v) => v.a > 0.01)
    ZORDER.forEach((kind) => vis.filter((v) => v.f.kind === kind).forEach(({ f, a: fa }) => {
      const col = ZC[kind], poly = f.geom.type.includes("Polygon")
      ctx.globalAlpha = a * fa; ctx.lineJoin = "round"; ctx.lineCap = "round"
      ctx.beginPath(); path(f.geom)
      if (poly) {
        ctx.fillStyle = kind === "building" ? "rgba(255,255,255,.16)" : col + "33"; ctx.fill()
        const hp = hatch(col); if (hp) { ctx.fillStyle = hp; ctx.fill() }
        ctx.strokeStyle = "rgba(10,14,46,.55)"; ctx.lineWidth = 4.5; ctx.stroke(); ctx.strokeStyle = col; ctx.lineWidth = 2.4; ctx.stroke()
      } else if (kind === "road") {
        ctx.strokeStyle = col; ctx.lineWidth = 9; ctx.stroke(); ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.lineWidth = 9; ctx.setLineDash([1.6, 6]); ctx.lineCap = "butt"; ctx.stroke(); ctx.setLineDash([])
      } else { ctx.strokeStyle = col; ctx.lineWidth = 6; ctx.stroke() }
    }))
    ctx.globalAlpha = a
    const mx = ix + iw / 2, my = iy + ih / 2; ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(mx, my, 5.5, 0, TAU); ctx.fill(); ctx.fillStyle = "#3d52a0"; ctx.beginPath(); ctx.arc(mx, my, 3, 0, TAU); ctx.fill()
    if (!FE.done) { const s0 = "Reading the surroundings"; ctx.font = "500 11px system-ui,sans-serif"; const w0 = ctx.measureText(s0).width + 22; rrect(ix + iw / 2 - w0 / 2, iy + ih - 32, w0, 22, 11); ctx.fillStyle = "rgba(255,255,255,.92)"; ctx.fill(); text(s0, ix + iw / 2, iy + ih - 21, 11, 500, "#3d52a0", "center", 0) }
    ctx.restore()
    // cards in the corners and sides of the image, each with a leader and an arrow to its zone (or to the edge if the zone is beyond the frame)
    const slots = [[0, 0], [1, 0], [0, 1], [1, 1], [0, 0.5], [1, 0.5]].map(([sx, sy]) => ({ sx, sy, used: false }))
    vis.sort((p, q) => ZORDER.indexOf(q.f.kind) - ZORDER.indexOf(p.f.kind)).forEach(({ f, a: fa }) => {
      let [ax, ay] = toPx(f.at); const out = ax < ix + 4 || ax > ix + iw - 4 || ay < iy + 4 || ay > iy + ih - 4
      ax = clampF(ax, ix + 10, ix + iw - 10); ay = clampF(ay, iy + 10, iy + ih - 10)
      const label = f.kind === "building" ? ZT.building : `${f.name && f.kind !== "neighbour" ? f.name : ZT[f.kind]} · ${distLabel(f.d)}`
      ctx.font = "650 11px system-ui,sans-serif"; const w = ctx.measureText(label).width + 30, hh = 22
      const pos = (s: { sx: number; sy: number }) => [ix + 8 + s.sx * (iw - 16 - w), iy + 8 + s.sy * (ih - 16 - hh)]
      let best: (typeof slots)[0] | null = null, bd = Infinity
      slots.forEach((s) => { if (s.used) return; const [px, py] = pos(s), d = Math.hypot(px + w / 2 - ax, py + hh / 2 - ay); if (d < bd) { bd = d; best = s } })
      if (!best) return; (best as any).used = true
      const [bx, by] = pos(best), col = f.kind === "building" ? "#3d52a0" : ZC[f.kind]
      const ex = clampF(ax, bx, bx + w), ey = clampF(ay, by, by + hh)
      ctx.globalAlpha = a * fa
      if (Math.hypot(ax - ex, ay - ey) > 6) {
        const ang = Math.atan2(ay - ey, ax - ex)
        ctx.lineCap = "round"; ctx.strokeStyle = "rgba(255,255,255,.95)"; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ax, ay); ctx.stroke()
        ctx.strokeStyle = col; ctx.lineWidth = 1.6; ctx.stroke()
        ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(ax - 8 * Math.cos(ang - 0.45), ay - 8 * Math.sin(ang - 0.45)); ctx.lineTo(ax - 8 * Math.cos(ang + 0.45), ay - 8 * Math.sin(ang + 0.45)); ctx.closePath(); ctx.fill()
        if (out) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 1; ctx.stroke() }
      }
      ctx.shadowColor = "rgba(10,14,46,.35)"; ctx.shadowBlur = 10; ctx.shadowOffsetY = 3; rrect(bx, by, w, hh, 11); ctx.fillStyle = "rgba(255,255,255,.97)"; ctx.fill(); ctx.shadowColor = "transparent"
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(bx + 12, by + hh / 2, 4, 0, TAU); ctx.fill(); if (f.kind === "building") { ctx.strokeStyle = "#3d52a0"; ctx.lineWidth = 1; ctx.stroke() }
      text(label, bx + 21, by + hh / 2 + 0.5, 11, 650, "#1c2250", "left", 0)
    })
    ctx.globalAlpha = a
    // hazard maps (illustrative until the hazard branch is plugged in) and credits
    let hx = x + pad + 4; const hy = iy + ih + 18
    text("Hazards", hx, hy, 10, 600, "#8697c4", "left", 1); hx += 56
    HAZ.forEach((s) => { ctx.font = "550 11px system-ui,sans-serif"; const w = ctx.measureText(s).width + 18; rrect(hx, hy - 10, w, 20, 10); ctx.fillStyle = "#ede8f5"; ctx.fill(); text(s, hx + 9, hy + 0.5, 11, 550, "#3d52a0", "left", 0); hx += w + 6 })
    text("Footprints: swisstopo vector map · imagery © swisstopo · hazards illustrative", x + pad + 4, iy + ih + 40, 9.5, 400, "#adbbda", "left", 0.2)
    ctx.restore()
  }
  function step(now: number) {
    if (!map) return
    const dt = Math.min(0.1, (now - lastNow) / 1000 || 0.016); lastNow = now; anim.t += dt; const t = anim.t
    const st = S.step, order: FlightStep[] = ["identity", "identity_done", "zoom", "focus", "scan", "done"], past = (s: FlightStep) => order.indexOf(st) >= order.indexOf(s)
    const inZoom = st === "zoom" || st === "focus" || st === "scan" || st === "done"
    const b = S.coords, ZE = zGlobe() + 1.3
    const zT = st === "zoom" ? S.progress : inZoom ? 1 : 0
    anim.z += (zT - anim.z) * (isStatic ? 1 : 1 - Math.exp(-dt * 3.2))
    if (inZoom || anim.z > 0.001) { // deterministic camera: one smoothed parameter drives zoom and centre
      const p = sm(anim.z), zoom = ZE + (Z_BUILDING - ZE) * p
      const r0 = 2 ** -ZE, r1 = 2 ** -Z_BUILDING, f = clampF((r0 - 2 ** -zoom) / (r0 - r1), 0, 1)
      cam.lon = 9 + (b.lon - 9) * f; cam.lat = 47 + (b.lat - 47) * f; cam.zoom = zoom
    } else {
      const kc = isStatic ? 1 : 1 - Math.exp(-dt * 2.6)
      if (st === "identity") { if (!isStatic) cam.lon += 6 * dt; cam.lat += (22 - cam.lat) * kc; cam.zoom += (zGlobe() - cam.zoom) * kc }
      else { cam.lon += angDiff(cam.lon, 9) * kc; cam.lat += (47 - cam.lat) * kc; cam.zoom += (ZE - cam.zoom) * kc }
    }
    const ks = isStatic ? 1 : 1 - Math.exp(-dt * 3.5)
    anim.marker += ((past("identity_done") ? 1 : 0) - anim.marker) * ks
    const aT = !SHOW_OVERLAYS ? 0 : st === "focus" ? sm(S.progress / 0.18) : st === "scan" || st === "done" ? 1 : 0; anim.aerial += (aT - anim.aerial) * ks;
    [0.62, 0.74, 0.86].forEach((th, i) => { const T = st === "zoom" ? sm((S.progress - th) / 0.1) : past("focus") ? 1 : 0; anim.hz[i] += (T - anim.hz[i]) * ks })
    OBS.forEach((o, i) => { if (anim.obsAt[i] < 0 && ((st === "focus" && S.progress >= o.at) || st === "scan" || st === "done")) anim.obsAt[i] = t })
    const want = st === "zoom" && S.progress > 0.62 ? "Reading the hazard maps" : CAPTION[st]
    if (isStatic) { anim.capText = want; anim.capA = 1 } else if (anim.capText !== want) { anim.capA -= dt * 3; if (anim.capA <= 0) anim.capText = want } else anim.capA = Math.min(1, anim.capA + dt * 2)
    if (INS.q.length && cam.zoom > 13 && inZoom && (isStatic || t - INS.last > 1.3)) { do { const i = INS.q.shift()!; INS.shown.push({ ...i, t0: t }); INS.last = t } while (isStatic && INS.q.length) }
    anim.inset += ((variant === "A" && (st === "focus" || st === "scan" || st === "done") ? 1 : 0) - anim.inset) * ks
    if (appliedVariant !== variant && map.getLayer("swiss")) { appliedVariant = variant; map.setLayoutProperty("swiss", "visibility", variant === "A" ? "none" : "visible") }
    const shift = panelW ? Math.min(230, (W - panelW) * 0.2) * anim.aerial : 0
    cxm = panelW + (W - panelW) / 2 - shift
    const tilt = fade(cam.zoom, 11, 16.5)
    if (free) { cam.zoom = map.getZoom() } else map.jumpTo({ center: [cam.lon, cam.lat], zoom: cam.zoom, pitch: PITCH_MAX * tilt, bearing: 0, padding: { left: panelW, right: shift * 2, top: 0, bottom: 0 } })

    if (SHOW_FEATURES && !FE.done && cam.zoom > 15.8 && performance.now() - FE.last > 700) {
      FE.last = performance.now(); FE.tries++
      const r = analyseSurroundings(S.coords, (layer, filter) => map!.querySourceFeatures("vt", { sourceLayer: layer, filter: filter as any }) as any[])
      if (r.hasOwn || FE.tries >= 8) { FE.done = true; FE.list = r.out; FE.list.forEach((f, i) => { f.t0 = isStatic ? 0 : t + 0.4 + i * 1.1 }) }
    }
    // overlay
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H)
    if (vig) { ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H) }
    if (SHOW_OVERLAYS && cam.zoom > 11) drawHazards(t)
    drawMarker(t)
    drawInset(t)
    if (SHOW_FEATURES && variant === "B") drawFeatures(t)
    if (SHOW_OVERLAYS) { drawLegend(); drawAerialCard(t); drawInsights(t) }
    if (SHOW_OVERLAYS && anim.capText) {
      ctx.globalAlpha = anim.capA * 0.9; ctx.font = "400 12px system-ui,sans-serif"; if ("letterSpacing" in ctx) (ctx as any).letterSpacing = "4px"
      const cw0 = ctx.measureText(anim.capText.toUpperCase()).width + 44, ccx = panelW + (W - panelW) / 2, ccy = H > 600 ? 54 : 30
      rrect(ccx - cw0 / 2, ccy - 17, cw0, 34, 17); ctx.fillStyle = "rgba(10,14,46,.72)"; ctx.fill()
      text(anim.capText.toUpperCase(), panelW + (W - panelW) / 2, H > 600 ? 54 : 30, 12, 400, "#fff", "center", 4); ctx.globalAlpha = 1
    }
    const cr = "Map data © swisstopo · Natural Earth"; ctx.font = "300 10.5px system-ui,sans-serif"; if ("letterSpacing" in ctx) (ctx as any).letterSpacing = ".6px"
    const crw = ctx.measureText(cr).width + 28; ctx.globalAlpha = 0.85; rrect(cxm - crw / 2, H - 30, crw, 24, 12); ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.fill()
    ctx.globalAlpha = 1; text("Map data © swisstopo · Natural Earth", cxm, H - 18, 10.5, 400, "#5a6390", "center", 0.6); ctx.globalAlpha = 1
  }

  return {
    mount(container: HTMLElement, canvas: HTMLCanvasElement) {
      if (map) return
      cv = canvas; ctx = cv.getContext("2d")!
      map = new MLMap({ container, style: buildStyle(), center: [cam.lon, cam.lat], zoom: cam.zoom, interactive: true, attributionControl: false, fadeDuration: 0, maxPitch: 60 })
      ;["dragPan", "scrollZoom", "boxZoom", "dragRotate", "keyboard", "doubleClickZoom", "touchZoomRotate", "touchPitch"].forEach((h) => (map as any)[h].disable())
      map.on("error", (e) => console.warn("[map]", e.error?.message || e))
      resize(); addEventListener("resize", resize)
    },
    get mounted() { return !!map },
    update(input: { step: FlightStep; progress: number; coords?: Coords }) { S.step = input.step; S.progress = input.progress || 0; if (input.coords) { S.coords = input.coords; loadAerial() } },
    setStatic(v: boolean) { isStatic = !!v },
    setVariant(v: "A" | "B") { variant = v; loadAerial() },
    get variant() { return variant },
    /** Let the user move and zoom the map (at the end, when the flight is held). */
    setFree(on: boolean) {
      if (!map || free === on) return; free = on
      if (on) { map.dragPan.enable(); map.scrollZoom.enable(); map.doubleClickZoom.enable(); map.touchZoomRotate.enable(); map.touchZoomRotate.disableRotation(); map.keyboard.enable(); map.getCanvas().style.cursor = "grab" }
      else { map.dragPan.disable(); map.scrollZoom.disable(); map.doubleClickZoom.disable(); map.touchZoomRotate.disable(); map.keyboard.disable(); map.getCanvas().style.cursor = "" }
    },
    reset() {
      if (free) this.setFree(false)
      INS.q = []; INS.shown = []; INS.last = -9; FE.list = []; FE.tries = 0; FE.done = false
      Object.assign(cam, { lon: 0, lat: 22, zoom: W ? zGlobe() : 1.8 }); inset.t0 = -1; Object.assign(anim, { z: 0, marker: 0, aerial: 0, inset: 0, hz: [0, 0, 0], obsAt: [-1, -1, -1], capA: 1, capText: "" })
      S.step = "identity"; S.progress = 0; loadAerial()
    },
    pushInsight(i: Insight) { if (![...INS.q, ...INS.shown].some((x) => x.id === i.id)) INS.q.push(i) },
    frame(now: number) { if (map) step(now) },
    get isStatic() { return isStatic },
  }
})()
