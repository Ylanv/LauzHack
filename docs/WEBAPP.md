# Web app (frontend): what is there and how to plug into it

Read this before changing `webapp/`. (`frontend/index.html` is the separate simple page served by the backend for the Vercel demo; it is not this app.) If you need something added or changed, write it in [WEBAPP_REQUESTS.md](WEBAPP_REQUESTS.md).

## In one paragraph
A client-facing pre-assessment page for building insurance (fictional brand **Alpenmark**). The client fills a short form. A waiting screen then flies a map from the globe down to the building while the pipeline runs, and a "request sent" screen closes the flow. The client never sees a risk score, tokens or cost. The UI is in English and uses only the palette `#3d52a0 #7091e6 #8697c4 #adbbda #ede8f5` (ink `#1c2250`). Hazard colours in the satellite window are the one exception.

## Run it
```bash
cd webapp && npm install && npx vite --host 0.0.0.0 --port 5173   # http://localhost:5173
```
- The backend is optional: `uvicorn src.main:app --reload` from the repo root. Vite proxies `/api` to `127.0.0.1:8000`.
- No API keys are needed for the demo. It runs fully offline from mocks, except the map tiles, which need network.
- Dev URLs:
  - `/?autorun` starts the demo case directly.
  - `&at=12` jumps ahead in the sequence (seconds).
  - `&ui=A|B` picks the end layout.
  - `&pause=0` goes straight to the "sent" screen.

## Stack
React 18 + Vite 5 + TypeScript, plain CSS (`src/styles.css`). MapLibre GL is **pinned to 5.24.1**: v6 breaks its web worker under Vite. Map data comes from swisstopo (vector basemap, SWISSIMAGE) and Natural Earth. There is no CSS framework and no state library.

## Screens and flow (`src/App.tsx`)
| Screen | File | What it does |
|---|---|---|
| Form | `components/FormScreen.tsx` | Fields: your name, company legal name, Swiss building address. The address uses geo.admin.ch autocomplete. Inline validation and a "Fill with the demo case" button. Submits `RequestInput { contact, company, address }` plus `Coords` |
| Waiting | `components/Flight.tsx` + `lib/mapFlight.ts` | Full-screen map: globe → Europe → Switzerland → building. The companion bubble narrates the steps: done steps get a green check, the current step a diamond loader. A review bar (A/B layout, "Pause at end", Continue) is there for team testing |
| Sent | `components/DoneScreen.tsx` | Confirmation with the reference number |

Always present:
- **Companion:** `components/Companion.tsx`, a WebGL sprite in `CobaltSprite.tsx` with the moods idle, working, happy and puzzled.
- **Background:** the ASCII betta fish in `lib/betta.ts` and `lib/background.ts`. They are non-commercial, credit @dwcminh.ascii, and appear on the form and sent screens only.

## Waiting-screen map (`lib/mapFlight.ts`)
- Single input: `MapFlight.update({ step, progress, coords })`. The camera follows the pipeline status and never runs on its own timer.
- Map style (`lib/worldStyle.ts`): a light map in the app colours. Satellite imagery appears only at the end, depending on the layout:
  - **A:** the map stays clean to the end. A window in the top-right shows the SWISSIMAGE aerial view, with the own building, neighbour, main road, water and forest outlined, hatched and labelled with distances. The hazard chips are illustrative for now.
  - **B:** the satellite view goes full screen at the end, with the same features highlighted on the map and cards on the side.
- Surroundings (`lib/surroundings.ts`): plain geometry on the vector tiles already loaded. It uses no model and no tokens.
- "Pause at end" holds the map so people can drag and zoom it. Continue goes on to the sent screen.

## Pipeline contract (where your logic plugs in)
- `src/pipeline/types.ts`: `Evidence { field, label, value, status: verified|observed|inferred|unknown, building_confirmed, source{type,url,retrieved_at}, evidence?, confidence?, requires_verification }`. Never a numeric risk score.
- `src/pipeline/index.ts`: `PIPELINE_ADAPTER` has one async function per branch, and each returns `Evidence[]`:
  - `identity`, `building`, `hazard`, `aerial` and `industry` are **stubs marked `PLUG-IN`** that return `[]`.
  - `synthesis` calls `POST /api/report` with `{ client_name, company_legal_name, address }`. It times out after 4 s and falls back to the mock reference. **Note:** the current backend has no `/api/report` any more; it exposes `/api/llm-input`, `/api/industries` and `/api/health`. So the web app runs on mocks until this call is wired to the new endpoint.
- `src/pipeline/mock.ts`: the demo case and the **step timeline**. Today the waiting-screen timing is simulated from these steps:
  - `identity`: Checking the company
  - `building`: Reading the building record
  - `hazard`: Checking natural hazards
  - `aerial`: Looking at the roof
  - `industry`: Reading public information
  - `file`: Putting the file together
- Backend contract: `schemas/llm_input.schema.json` (examples in `examples/`).

## What is real vs mocked
| Real | Mocked / illustrative |
|---|---|
| Address search (geo.admin.ch), canton lookup, map tiles, SWISSIMAGE, surroundings from vector tiles | Step timing, the five pipeline branches (stubs), hazard levels in the window, the reference number when the backend is off |

## Conventions
- Keep it frugal: code before models, and at most one model call per branch.
- Unknown stays unknown, and every item keeps its source.
- The UI is light and soft (rounded, palette colours) and accessible: labels, `aria-live` status, reduced-motion support.
- Before a PR, run `npx tsc --noEmit` in `webapp/`.
