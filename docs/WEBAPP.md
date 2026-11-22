# Web app: what is there and how to plug into it

Read this before changing `webapp/`. `frontend/index.html` is a different page: the simple one the backend serves for the Vercel demo. To ask for a change in the web app, write it in [WEBAPP_REQUESTS.md](WEBAPP_REQUESTS.md).

## In one paragraph
A client-facing pre-assessment page for commercial building insurance (fictional brand **AXAlotl**), for buildings in the **canton of Geneva**.
1. The client fills a short form.
2. The web app starts **one report job** on the backend (`POST /api/reports`: ETL → LLM report → validation).
3. A waiting screen flies a map from the globe down to the building and follows the job until the report is generated.
4. A "request sent" screen closes the flow.

The client never sees a risk score, tokens, cost or the underwriting document. The UI is in English and uses only the palette `#3d52a0 #7091e6 #8697c4 #adbbda #ede8f5` (ink `#1c2250`). The zone colours in the satellite window are the one exception.

## Run it
```bash
cd webapp && npm install && npx vite --host 0.0.0.0 --port 5173   # http://localhost:5173
# backend, from the repo root (Vite proxies /api to 127.0.0.1:8000):
uv venv .venv && uv pip install --python .venv/bin/python -r requirements.txt uvicorn
.venv/bin/python -m uvicorn src.main:app --port 8000
```
- **Live mode** is the default: the form needs the backend for the activity list, and every submission calls it.
- **Demo mode** (`/?demo`): fully simulated, no backend call, and a built-in activity list. It is the only place where completion is simulated.
- Dev URLs:
  - `/?autorun` is demo mode and starts the demo case directly.
  - `&at=12` jumps ahead in the waiting sequence (seconds).
  - `&ui=A` shows the alternative end layout (satellite window).
  - `&pause=0` skips the review pause.
  - `/fish.html` shows the background only.

## Stack
- React 18, Vite 5 and TypeScript, with plain CSS (`src/styles.css`). There is no CSS framework and no state library.
- MapLibre GL is **pinned to 5.24.1**, because v6 breaks its web worker under Vite.
- Map data comes from swisstopo (vector basemap, SWISSIMAGE) and Natural Earth.

## Screens and flow (`src/App.tsx`)
| Screen | File | What it does |
|---|---|---|
| Form | `components/FormScreen.tsx` | See "Form" below |
| Waiting | `components/Flight.tsx` + `lib/mapFlight.ts` | Full-screen map: globe → Europe → Switzerland → building. The companion bubble narrates the steps: done steps get a green check, the current one a diamond loader. A review bar is there for team testing: "Pause at end" (the map can then be dragged and zoomed), JSON (the backend output, team only) and Continue |
| Sent | `components/DoneScreen.tsx` | A confirmation that recaps contact, company, building and activity. There is **no reference number**, because the backend gives none |

### Form
| Field | Sent as | Rules |
|---|---|---|
| Your name | `client_name` | Required |
| Company legal name | `company_legal_name` | Required, exactly as in the commercial register |
| Address of the business premises | `address` (`"Street N, NPA Town"`) | Must be **picked in the geo.admin.ch list**: a town alone or a free-typed text is refused. Outside the canton of Geneva it is flagged right away and refused, using the canton lookup in `lib/canton.ts`. The card subtitle states the scope |
| Main activity of the business | `industry_type` | Required drop-down filled by `GET /api/industries`, showing the label and sending the key. It is never inferred. If the list fails to load, a "Load again" link appears |

"Fill with the demo case" fills in Marie Dupont, CMDS SA, Rue du Champ-Blanchod 7, 1228 Plan-les-Ouates, with metalworking preselected.

### Live report and errors (`src/pipeline/index.ts`, backend `src/main.py`)
- On submit, `startReport()` sends **one** `POST /api/reports`. The backend starts the full report pipeline in the background (ETL → LLM report → validation, `src/report/pipeline.py`) and answers `{ job_id }`. The client polls `GET /api/reports/{job_id}` every 1.5 s, which returns `status` and the running `stage` (`etl`, `features`, `llm`, `validate`), never the report.
- The waiting screen follows the real pipeline and never runs ahead of it:
  - While the ETL runs, the timeline waits before its last step.
  - After the ETL, it waits inside "Putting the file together". The companion says "Writing the report" (LLM) and then "Checking the report" (validation).
  - The confirmation screen ("Your request has been sent") appears **only when the report is valid** and stored in `reports/<job_id>/` for the team (see the dashboard).
- The job folder is the case read by the underwriter dashboard. In team review ("Pause at end"), "Open report" opens it there.
- Errors bring the client back to the form **with every value kept**, and a message in a banner. There are no automatic retries.
  - **422** or ETL "input rejected": the backend's message is shown (for example: no company registered under that exact name).
  - **Public service down, invalid report, connection lost:** a "Try again" button sends the same values once more.
- Locally without an LLM key: start the backend with `REPORT_MODEL=mock` (free, minimal report). The background job needs a long-running server: it is not meant for Vercel's serverless functions.
- Dev: `/?autorun&live` runs the demo case through the live pipeline.
### Background and companion
- **Companion:** `components/Companion.tsx`, a WebGL sprite in `CobaltSprite.tsx` with the moods idle, working, happy and puzzled.
- **Fish:** the original ASCII betta by @dwcminh.ascii, played from the repo's own `reel.mp4` (fallback: `preview.gif`) in `lib/background.ts`.
  - Black is made transparent so the fish shows on the light background.
  - It swims across the whole screen and speeds up behind the form so it never lingers there. It is shown on the form and sent screens only.
  - The media are **not in git**, because their licence forbids reposting them. Copy them from github.com/dwcminh/ascii-art/tree/main/BETTA-FISH into `webapp/public/original/` to see the fish. Without them there is no fish.

## Ticket desk for the AXA underwriting team (`/dashboard.html`, `src/dashboard/`)
Back-office page for underwriters, built from `docs/FRONTEND_INTEGRATION.md`. It is **not linked from the client app** and must never be shown to clients.
- **Data:** one folder per case, written by `python -m src.report --input <request.json> --output reports/<case>` (repo root). In dev, a Vite plugin (`webapp/vite.config.ts`) lists and serves `reports/` (change it with `REPORTS_DIR`). The list refreshes itself every 20 s (new and finished tickets). `reports/` is git-ignored because it can hold client data.
- **Jira-like tickets** (`src/dashboard/tickets.ts`): every report is a ticket.
  - Queues: All open · Assigned to me · Waiting for client · Resolved · All cases.
  - Columns: Type (declared activity), Key, Summary (company + address), Requester, Assignee, Priority (highest finding), Status.
  - Status lozenge with a menu: To review → In progress → Waiting for client → Resolved. Generating and Failed come from the pipeline and cannot be changed.
  - Assignee: Unassigned / Me. Status, assignee and answered questions are kept in the browser (localStorage) for now; a shared store will be needed for a team.
- **Ticket page:**
  - Left: title (report headline), Status + Resolve + ••• (print, JSON downloads), Description, Next step.
  - Tabs: Findings (one row per finding, opening to observation / implication / action / evidence), Questions (checklist, blocking first), Risk (COPE rows, hazards table, industrial fire facts), Evidence (images with annotation overlay, then sources, register and data quality folded), Valuation.
  - Right: Details (assignee, readiness, priority, requester, company, address, activity, EGID, UID, date) and a folded "Run details" (tokens, cost: internal).
  - Narrative comes from `output.json`. Values, statuses and sources come from `features_combined.json` (§4 ID resolution; "unresolved" chips as the fallback).- Deep links: `/dashboard.html?case=<folder>&tab=questions` (findings, questions, risk, evidence, valuation).
- Test data: real reports only. The team commits them in `examples/reports/<case>/` (whole output folder of `python -m src.report`, with real API keys); the dashboard lists `examples/reports/` and the local `reports/`. No mock, synthetic or placeholder case.
## Waiting-screen map (`lib/mapFlight.ts`)
- Single input: `MapFlight.update({ step, progress, coords })`. The camera follows the timeline and never runs on its own timer.
- Style (`lib/worldStyle.ts`): a light map in the app colours.
- **Layout B** (default, chosen by the team): the satellite view goes full screen at the end. Colour code: own building white, neighbour orange, main road red, water cyan, forest green. Every zone is framed and hatched; roads and rivers are drawn as framed corridors of their real width. Cards on the side, joined by leaders in the same colour.
- **Layout A** (`?ui=A`, kept for comparison): the map stays clean to the end. A window in the top-right shows the SWISSIMAGE aerial view.
  - It outlines and hatches the own building (white), the neighbour (orange), the main road (red), water (cyan) and forest (green).
  - Cards with arrows point at each zone. They never cover a zone or each other, and their layout is computed once, so nothing flickers.
  - The window zooms out from 330 m to 660 m when needed, so that the named zones are in the picture. Anything still outside is not named.
- Surroundings (`lib/surroundings.ts`): plain geometry on the vector tiles already loaded. It uses no model and no tokens.

## What is real vs simulated
| Real | Simulated / illustrative |
|---|---|
| Address search (geo.admin.ch), canton check, activity list, access-code check, the live assessment call and its errors, map tiles, SWISSIMAGE, surroundings from vector tiles | The step timeline on the waiting screen (the endpoint reports no per-step progress), and everything in demo mode |

## Conventions
- Keep it frugal: code before models.
- Unknown stays unknown.
- The UI is light and soft (rounded, palette colours) and accessible: labels, `aria-live` status, reduced-motion support.
- Before a PR, run `npx tsc --noEmit` in `webapp/`.

## Handoff: running the client web app with real API keys
1. Repo root: put the keys in `.env` (see `.env.example`; never committed): vision (OpenRouter), facade (Google) and the report model's key (default config `openrouter_gemini35flash_lite`, see `models/configs.json`; `REPORT_MODEL` picks another one).
2. Backend: `.venv/bin/python -m uvicorn src.main:app --port 8000` (without `REPORT_MODEL=mock`).
3. Web app: `cd webapp && npm install && npx vite --port 5173`, open http://localhost:5173 and send the demo case.
4. Check that the waiting screen lasts as long as the real pipeline (ETL + vision + LLM report) and that the confirmation only appears when `reports/<job_id>/output.json` exists. The report then shows in http://localhost:5173/dashboard.html.
5. Not verified yet with real keys: real durations, vision stages, the LLM report content, the `invalid_report` path. The background job needs a long-running server (not Vercel serverless).
