# AXA axolotl mascot

The cube axolotl from `axolotl-cube.zip`, recoloured in AXA colours and animated in code. It has an idle loop, eyes and head that follow the cursor, and emotions. It is standalone and **not wired into the app yet**.

## Files
| File | What it does |
|---|---|
| `assets/source/axolotl-cube.gltf`, `gltf_embedded_0.png` | Original Blockbench export. Never modified. |
| `assets/axolotl-axa.gltf` | Model used by the app: same geometry, AXA texture embedded (9 KB) |
| `assets/axolotl-axa-atlas.png` | The same texture, for review |
| `palette.json` | All mascot colours |
| `assets/logo/` | Square logo: `axolotl-logo.svg`, plus PNGs at 16, 32, 64, 180 (Apple touch icon) and 512 px |
| `../../scripts/build_axolotl.py` | Rebuilds `axolotl-axa.gltf` from the source and `palette.json` |
| `AxolotlMascot.tsx` | React component (transparent canvas that fills its parent) |
| `AxolotlModel.ts` | three.js scene: loads the model, pivot groups, face overlay, contact shadow |
| `animator.ts` | Procedural animation: float, breathing, gills, tail, blinks, reactions → one `Pose` per frame |
| `emotion.ts` | Emotion state machine (`MascotEmotionController`) |
| `gaze.ts` | Cursor tracking (`MascotGazeController`) |
| `face.ts` | Eyes, mouth and cheeks drawn on a 16×16 canvas over the front face |
| `loadingAdapter.ts` | Turns task statuses into one-shot events (`MascotLoadingAdapter`) |
| `params.ts` | Every animation setting (amplitudes, periods, gaze limits, reaction durations) |
| `mascot.test.ts` | Unit tests (`npm test`) |
| `playground/`, `../../mascot.html` | Dev page for trying the mascot |

## Use it
The component fills its container, so give the container a size:
```tsx
import AxolotlMascot from "./mascot/AxolotlMascot"
import type { LoadingSnapshot } from "./mascot/loadingAdapter"

const loading: LoadingSnapshot = {
  runId: jobId,                                   // new id per loading run
  tasks: [{ id: "etl", status: "done" }, { id: "llm", status: "running" }],   // pending | running | done | warning | failed
  outcome: "running",                             // "success" / "failed" once known
}
<div style={{ width: 112, height: 112 }}><AxolotlMascot loading={loading} /></div>
```
Pass the latest snapshot on every render. The adapter remembers which events it has already handled, so re-renders never replay one.

| Event | Mascot |
|---|---|
| no task started | IDLE |
| a task is running | THINKING |
| a task becomes `done` | HAPPY (once per task; extra completions in a burst are merged) |
| a task becomes `warning` | CONCERNED |
| a task `failed` / `outcome: "failed"` | ERROR, then IDLE (no success afterwards in the same run) |
| `outcome: "success"` | SUCCESS (replaces the last HAPPY), then IDLE |

**Triggering an emotion yourself:** create a controller and pass it as `controller`:
```ts
const ctl = new MascotEmotionController()
ctl.setBase("thinking")              // idle | thinking | concerned (lasts until changed)
ctl.react("happy", mascotNow())      // happy | success | error (short; priority success > error > happy)
```
**Other props:** `tracking` (default true), `idleMotion` (default true), `reducedMotion` (defaults to the OS setting), `onEvents`.

## Change it
- **Colours:** edit `palette.json`, then run `npm run build:mascot` (requires Python + Pillow). The face colours are read at runtime.
- **Animation:** edit the values in `params.ts`.
- **Expressions:** edit `drawFace` in `face.ts` and the emotion-to-face mapping in `animator.ts` (`face()`).

## Notes
- The source has **one cube** (head and body together), two flat gill planes and a flat tail fin. It has no legs and no separate head, so "head tracking" turns the whole cube by up to ±12° yaw and ±8° pitch. The gills pivot at the body edge, and the tail sways and lags behind turns.
- three.js and the model load in a separate lazy chunk (~156 KB gzip), so the page does not wait for them. The model is inlined in that chunk, so there is no extra request.
- The pixel ratio is capped at 2. There is one `requestAnimationFrame` loop per mascot, paused while the tab is hidden. There are no React state updates per frame.
- With reduced motion, the mascot does not move or blink, and the canvas redraws only when the expression changes.
- On a dark or photo background, the app wrapped the canvas in `filter: drop-shadow(0 0 1px #fff) drop-shadow(0 0 3px rgba(255,255,255,.55))` so the dark-blue cube stays readable.
- In dev builds the last pose is exposed as `canvas.pose` for browser tests.

## Playground
```bash
cd webapp && npm run dev     # then open http://localhost:5173/mascot.html
```
It has sizes from 56 to 240 px, buttons for every emotion, toggles for tracking, idle motion and reduced motion, and light, map and satellite backgrounds. A simulated task list runs through the real adapter, with single, burst, warning, fail, all-complete and full-run buttons.
