// Fish test page (dev only, not linked from the app): the site background with the fish, nothing else. /fish.html
import "./styles.css"
import { paintBackground, paintFish } from "./lib/background"

document.getElementById("root")!.innerHTML = `<canvas id="bg" width="200" height="112"></canvas><canvas id="fish"></canvas>`
let last = 0
const loop = (now: number) => { requestAnimationFrame(loop); if (now - last > 45) { last = now; paintBackground(now / 1000) } paintFish() }
requestAnimationFrame(loop)