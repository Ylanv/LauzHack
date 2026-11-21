// @ts-nocheck
// Illustrative aerial placeholder, used only when the real SWISSIMAGE tile cannot be loaded.
import { rect } from "./utils"

export function drawAerial(cv) {
  const W = 128, H = 80; cv.width = W; cv.height = H; const c = cv.getContext("2d");
  let seed = 20261121; const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const greens = ["#7f9462", "#8aa06b", "#728858", "#96a574", "#a9a57c"];
  for (let by = 0; by < 10; by++) for (let bx = 0; bx < 16; bx++) {
    rect(c, bx * 8, by * 8, 8, 8, greens[Math.floor(rnd() * greens.length)]);
    for (let k = 0; k < 9; k++) rect(c, bx * 8 + Math.floor(rnd() * 8), by * 8 + Math.floor(rnd() * 8), 1, 1, rnd() > .5 ? "#6d8153" : "#9fae7c");
  }
  rect(c, 0, 60, W, 5, "#6c7077"); for (let x = 0; x < W; x += 8) rect(c, x + 1, 62, 4, 1, "#c9ccd0");
  rect(c, 104, 0, 5, 60, "#6c7077");
  rect(c, 24, 48, 58, 10, "#8b8f95"); for (let x = 28; x < 80; x += 6) rect(c, x, 50, 1, 6, "#b9bcc0");
  rect(c, 87, 25, 15, 16, "#8f949b"); rect(c, 84, 22, 15, 16, "#aeb3ba"); rect(c, 85, 23, 13, 14, "#bfc3c8");
  c.globalAlpha = .3; rect(c, 29, 23, 52, 26, "#000"); c.globalAlpha = 1;
  rect(c, 26, 20, 52, 26, "#9da2a8"); rect(c, 27, 21, 50, 24, "#c9ccd0");
  for (let x = 31; x < 56; x += 6) [25, 33, 40].forEach(y => rect(c, x, y, 3, 2, "#e3edf3"));
  rect(c, 58, 22, 18, 22, "#2a3e66");
  for (let y = 22; y < 44; y += 3) rect(c, 58, y, 18, 1, "#3d578a");
  for (let x = 58; x < 76; x += 3) rect(c, x, 22, 1, 22, "#3d578a");
  for (let x = 6; x < 102; x += 5 + Math.floor(rnd() * 3)) {
    const y = 11 + Math.floor(rnd() * 4);
    rect(c, x - 2, y - 2, 5, 5, "#4a6735"); rect(c, x - 1, y - 3, 3, 1, "#4a6735"); rect(c, x - 1, y - 1, 2, 2, "#6a8a4c");
  }
}
