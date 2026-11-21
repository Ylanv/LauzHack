# AXAlotl web app (Smart Property)

React + Vite + TypeScript, plain CSS. Three client screens: form, cinematic waiting screen, "request sent".

## Run
```bash
cd webapp && npm install && npm run dev      # http://localhost:5173
# From the repo root in a second terminal:
python -m uvicorn src.main:app --port 8000
```
`/api` is routed to `http://127.0.0.1:8000` by Vite. Set `LAUZHACK_API_URL` before starting Vite if FastAPI uses another port.
`npm run build` type-checks and builds.

## What is real, what is mocked
| Part | Status |
|---|---|
| Address autocomplete | **Real** geo.admin.ch SearchServer. Offline suggestions are available in demo mode |
| Canton from coordinates | Real, point-in-polygon on embedded swisstopo-derived outlines |
| Report | `POST /api/reports` runs the ETL, model and validation in FastAPI. The dashboard reads the saved report |
| Waiting screen | Status and completed steps come from `GET /api/reports/{job_id}`. The map retains its animation. Confirmation requires a validated report |
| Waiting screen | Light palette like the form. The globe and zoom are a light, non-satellite map; the 2D satellite image appears only for the last metres. The companion's bubble narrates the current step. Hazard zones, aerial card and finding cards are hidden: set `SHOW_OVERLAYS = true` in `mapFlight.ts` to bring them back |
| Aerial card (when overlays are on) | **Real SWISSIMAGE** of the address (geo.admin.ch WMS, about 170 m across). Illustration only if the request fails |
| Insight cards, hazard overlays | Illustrative placeholders (positions are not computed from real data yet) |
| Map | **Light palette globe** (MapLibre GL 5.24, globe projection; pinned because v6 breaks the worker under Vite): Natural Earth outlines, then the swisstopo vector basemap restyled in the app colours (roads, water, forest, buildings). swisstopo SWISSIMAGE fades in only from zoom ~15 so the building is clear. Flown by `src/lib/mapFlight.ts` via `MapFlight.update({ step, progress, coords })`. Needs network for tiles |
| Surroundings | **No model, no tokens**: src/lib/surroundings.ts reads building, road, water and forest geometry from the vector tiles already loaded and shows the nearest ones with distances. Toggle with SHOW_FEATURES in mapFlight.ts |
| Fish | **Live port** of the original `betta_fish.py` renderer (`src/lib/betta.ts`): 3D body and veils on a travelling wave, character grid, 30 fps, seamless 14 s loop. Starts fully grown (no drawing-in intro), recoloured to the app palette |
| Companion | Real OriginKit cobalt-sprite WebGL component (`CobaltSprite.tsx`), moods via props |

Open `/?demo` for the simulated flow without API keys. The live backend reads keys from the repo root's `.env`. Set `REPORT_MODEL` to choose the report model. The default is `openrouter_gemini35flash_lite`.

## Licences and credits
- Fish: ASCII betta by @dwcminh.ascii (github.com/dwcminh/ascii-art). Personal, non-commercial use only; commercial use needs the author's permission. Credit stays in the footer.
- Companion: OriginKit "cobalt-sprite". Check OriginKit's licence before shipping.
- Imagery: swisstopo SWISSIMAGE (show "© swisstopo"; check terms for commercial use). Vector basemap: swisstopo. Canton outlines: Natural Earth / swisstopo-derived.
- Team review: on the waiting screen a bar switches the end layout (A: clean map + small satellite window with illustrative hazard zoning; B: full satellite) and "Pause at end" holds the map when processing finishes (Continue to proceed). URL: `?ui=A|B`, `?pause=0`.
- Fish colours are the original `betta_fish.py` palettes (blue, koi, lotus); speed is `SPEED` in `background.ts`.
- Dev helper: `/?autorun` starts the demo directly, `/?autorun&at=11` jumps ahead in the sequence.

## 60-second demo
1. Open `/?demo`, click **Fill with the demo case** (or type "Rue de l'Industrie" and pick a suggestion).
2. **Send request.** The globe spins, locks on the address, zooms to the building; hazard layers and finding cards appear one by one.
3. The aerial image card shows numbered roof observations. The companion comments along the way.
4. Optionally click **Skip animation**.
5. The "request sent" screen shows the recap.
