import { PALETTE } from "./params"

/**
 * The face is drawn on a 16x16 canvas laid over the front of the cube (two canvas pixels per texture pixel), so the
 * eyes can look around and the expression can change without touching the model. Redrawn only when it changes.
 */
export type Eyes = "open" | "closed" | "happy" | "wide" | "focus"
export type Mouth = "smile" | "grin" | "bigGrin" | "o" | "flat" | "wavy"
export interface FaceState {
  eyes: Eyes
  mouth: Mouth
  /** pupil offset in face pixels, -1..1 (+x viewer's right, +y up) */
  px: number
  py: number
  cheeks: boolean
  brows: "none" | "worried"
}

export const FACE_SIZE = 16
export const faceKey = (f: FaceState) => `${f.eyes}|${f.mouth}|${f.px}|${f.py}|${+f.cheeks}|${f.brows}`

const EYES_X = [0, 12]          // left edge of each eye, wraps round to the eye pixel on the side of the cube

export function drawFace(c: CanvasRenderingContext2D, f: FaceState) {
  const px = (x: number, y: number, col: string, w = 1, h = 1) => { c.fillStyle = col; c.fillRect(x, y, w, h) }
  c.clearRect(0, 0, FACE_SIZE, FACE_SIZE)
  const W = PALETTE.eyeWhite, P = PALETTE.pupil
  const dx = Math.max(-1, Math.min(1, f.px)), dy = Math.max(-1, Math.min(1, f.py))

  EYES_X.forEach((x0, i) => {
    const mirror = i === 1
    switch (f.eyes) {
      case "open":
        px(x0, 7, W, 4, 4)
        px(x0 + 1 + dx, 8 - dy, P, 2, 2)
        break
      case "wide":
        px(x0, 6, W, 4, 5)
        px(x0 + 1 + dx, 8 - dy, P, 2, 2)
        break
      case "focus":        // attentive: upper lid lowered a little, pupils up
        px(x0, 8, W, 4, 3)
        px(x0 + 1 + dx, 8 + (dy < 0 ? 1 : 0), P, 2, 2)
        break
      case "closed":
        px(x0, 9, W, 4, 1)
        break
      case "happy":        // ^ ^
        px(x0 + 1, 8, W, 2, 1)
        px(x0, 9, W, 1, 1)
        px(x0 + 3, 9, W, 1, 1)
        break
    }
    if (f.brows === "worried") {   // inner ends raised
      px(mirror ? x0 + 2 : x0, 5, W, 2, 1)
      px(mirror ? x0 : x0 + 2, 4, W, 2, 1)
    }
    if (f.cheeks) px(x0 + 1, 12, PALETTE.cheek, 2, 1)
  })

  const M = PALETTE.mouth, R = PALETTE.mouthInside
  switch (f.mouth) {
    case "smile": px(5, 12, M); px(10, 12, M); px(6, 13, M, 4, 1); break
    case "grin": px(5, 12, M, 6, 1); px(5, 13, M); px(6, 13, R, 4, 1); px(10, 13, M); px(6, 14, M, 4, 1); break
    case "bigGrin": px(4, 12, M, 8, 1); px(4, 13, M); px(5, 13, R, 6, 1); px(11, 13, M); px(5, 14, M); px(6, 14, R, 4, 1); px(10, 14, M); px(6, 15, M, 4, 1); break
    case "o": px(7, 12, M, 2, 1); px(6, 13, M); px(7, 13, R, 2, 1); px(9, 13, M); px(7, 14, M, 2, 1); break
    case "flat": px(7, 13, M, 3, 1); break
    case "wavy": px(5, 13, M); px(6, 12, M); px(7, 13, M); px(8, 12, M); px(9, 13, M); px(10, 12, M); break
  }
}
