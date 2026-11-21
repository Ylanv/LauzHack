# Underwriter dashboard — frontend integration guide

Audience: the frontend developer building the AXA underwriting dashboard (back-office, for underwriters — **not** the client-facing `webapp/`, which must never show the underwriting report).

The backend stops at **validated JSON**. It does not produce HTML or PDF: layout, styling, printing and export are the dashboard's job. This document tells you exactly which files to read, what every field means, how to resolve every ID, and how to display each state. You should not need to read backend code.

> Scope split: the backend delivers data (§2) and guarantees it is validated; **you decide storage, case listing, layout, styling, printing and export.** The suggestions below (tabs, cards, colours) are recommendations, not requirements — the binding parts are the data contracts, the ID-resolution rules (§4) and the meaning of each state (§6).

---

## 1. Data contracts — which schema to consume

All schemas are JSON Schema Draft 2020-12 under [`schemas/`](../schemas/README.md).

| Category | File | What it is | Should the UI read it? |
|---|---|---|---|
| INPUT | `schemas/INPUT/customer_request.v1.schema.json` | The 3–4 fields typed by the user (client, legal company name, address, industry) | Only to show "what was requested" |
| FEATURE | `schemas/FEATURE/llm_input.v2.schema.json` (`etl_output.json`) and `schemas/FEATURE/feature.v1.schema.json` (one feature record) | The 19 extracted features with status and sources | Optional (the same facts are in COMBINED_FEATURE) |
| COMBINED_FEATURE | `schemas/COMBINED_FEATURE/combined_feature.v1.schema.json` (`features_combined.json`) | The **evidence register**: facts, sources, images, annotations, quality flags | **Yes — every ID in the report resolves here** |
| OUTPUT | `schemas/OUTPUT/report_output.v1.schema.json` (`output.json`) | The model's structured report: narrative + IDs only | **Yes — main content** |

Rule of thumb: **display narrative from `output.json`, display every value, source, image and status from `features_combined.json`.** The model never writes building values, URLs or image paths; if a number is not in the evidence register, do not show it as data.

---

## 2. What the backend gives you — and what you decide

One command runs the whole pipeline (details in [`src/report/pipeline.py`](../src/report/pipeline.py)):

```bash
python -m src.report --input input.json --output <dir>
```

`input.json` may be a customer request (`schemas/INPUT`, runs the ETL), an already-enriched ETL document (`2.0-llm-input`) or an evidence bundle. The command writes into `<dir>`:

| File | Content | For the UI |
|---|---|---|
| `output.json` | **OUTPUT** — the validated report. Written **only** if the report is valid | main content |
| `features_combined.json` | **COMBINED_FEATURE** — evidence register (facts, sources, visuals, annotations, quality flags) | resolve every ID here |
| `images/` | image files; `features_combined.json → visuals[].asset_uri` is relative to `<dir>` | display |
| `metrics.json` | pipeline status per stage, tokens, cost, latency, validation issues | status + internal run details |
| `etl_output.json` | the ETL document (2.0-llm-input, images not embedded) — only when the ETL ran or was given | optional |
| `output.invalid.json` | last model output when validation failed (diagnostics only — never display as a report) | error view |

Exit code: `0` valid report · `1` report invalid · `2` pipeline error.

**Your decisions (frontend):** where these folders are stored, how cases are named and listed, how list entries are built (company name, address, industry, readiness, number of findings/questions, report date…), whether an API sits in front of the files, and all visual design, page layout, printing and PDF/export. The backend does not impose a case index, a database or a document layout. Everything a list needs is available from these files:

| List column | Where |
|---|---|
| case ID | `output.case_id` (= `features_combined.case.case_id`) |
| company / address / client | `features_combined.case.legal_company_name`, `.building_address`, `.client_name` |
| industry (declared vs register) | fact `ev.declared_industry` (`value.label`) vs fact `feat.business_sector` |
| underwriting readiness | `output.executive_summary.underwriting_readiness` |
| number of findings / open questions / blocking questions | `len(output.priority_findings)`, `len(output.open_questions)`, count of `open_questions[].blocking_initial_pricing == true` |
| report available | `metrics.status == "succeeded"` and `output.json` exists |
| report date | `metrics.finished_at` (evidence date: `features_combined.case.created_at`) |
| synthetic case | `metrics.synthetic` (§5) |

There is no HTTP endpoint for reports yet; if you need one, add a request in [WEBAPP_REQUESTS.md](WEBAPP_REQUESTS.md).

---

## 3. Case page — how to display each OUTPUT field

`output.json` structure (all keys always present, `schema_version` = `"1.0"`):

`case_id`, `executive_summary`, `cope`, `priority_findings[≤6]`, `hazard_interpretations[≤14]`, `valuation_commentary`, `visual_evidence[≤4]`, `open_questions[≤8]`, `underwriter_next_step`.

Recommended tabs: **Overview · COPE · Hazards · Evidence · Valuation · Questions · Export**. The source template the kit was designed for is [`reporting/REPORT_TEMPLATE.md`](../reporting/REPORT_TEMPLATE.md) (section order, limits: 5 findings on the first screen, 4 images, 8 questions) — follow its order; styling is yours.

### 3.1 Overview

| Field | Component | Notes |
|---|---|---|
| `executive_summary.headline` | Page title / hero | ≤ 1 line |
| `executive_summary.underwriting_readiness` | Status pill | `ready_for_initial_review` → "Ready for initial review" (green) · `requires_clarification` → "Requires clarification" (amber) · `specialist_review_recommended` → "Specialist review recommended" (orange) · `building_identity_unresolved` → "Building identity unresolved" (red; building-specific content is unreliable) |
| `executive_summary.overview` | Paragraph | |
| `executive_summary.key_takeaway` | Callout | |
| `executive_summary.critical_fact_ids` | Fact chips (§4) | |
| `underwriter_next_step` | Primary action box | Also repeat in the Questions tab |
| `priority_findings` (top 5 by priority) | Finding cards | See §3.4 |
| Identity block | Key–value card | From the evidence register, not the report: `combined_feature.case.legal_company_name`, `.building_address`, `.client_name`; `combined_feature.building.company_uid`, `.egid` (show "unresolved" unless `identity_resolution == "unique"`), `.canton` |

### 3.2 COPE

`cope.construction | occupancy | protection | exposure`, each `{headline, interpretation, fact_ids[], evidence_ids[], unknown_feature_ids[]}`.

Four cards. Card = `headline` (title) + `interpretation` (text) + fact chips (`fact_ids`, then `evidence_ids`) + a "Gaps" list built from `unknown_feature_ids` (display each fact's `field_key`, humanised, with the **Unknown** status style — never "No"/"Absent").

### 3.3 Hazards

`hazard_interpretations[]` = `{peril, interpretation, pricing_role, fact_ids[], evidence_ids[], follow_up_needed}`.

| Field | Display |
|---|---|
| `peril` | Row title: `fire`, `river_flood`, `surface_runoff`, `hail`, `earthquake`, `landslide`, `windstorm`, `rockfall`, `avalanche`, `snow_load`, `water_escape`, `other` |
| measurement | **Not in the report.** Show the value of the `feat.*_exposure` fact(s) in `fact_ids`, resolved from the register (e.g. `feat.hail_exposure` → `{"hail_50y_cm": 3}`) |
| `interpretation` | Text |
| `pricing_role` | `regulated_component_underwriting_only` → "Regulated cover — underwriting/prevention only" · `coverage_dependent` → "Depends on cover selected" · `potential_individual_pricing_input` → "Individually assessable" · `not_assessed` |
| `follow_up_needed` | Flag icon |

Always show this note under natural hazards: *Swiss private natural-hazards cover is written at a regulated tariff; hazard data supports underwriting and prevention, not an individual surcharge.*

Industrial fire exposure: show a small table of these register facts (from `combined_feature.facts`, by `field_key`): `site_industrial_processes`, `high_temperature_operations`, `gas_installations`, `flammable_material_storage`, `business_sector`, plus the `fire` row of `hazard_interpretations`.

### 3.4 Priority findings

`priority_findings[]` = `{id, title, priority, finding_type, observation, underwriting_implication, recommended_action, confidence, fact_ids[], evidence_ids[], coverage_components[]}`.

Card, sorted `critical > high > medium > low`:
- header: `priority` (colour), `title`, `finding_type` label (`confirmed_exposure`, `potential_exposure`, `protective_factor`, `data_gap`, `source_conflict`), `confidence`;
- body: Observation / Implication / Recommended action;
- footer: evidence chips (`fact_ids` + `evidence_ids`), coverage tags (`fire`, `regulated_natural_hazards`, `earthquake_optional`, `water_optional`, `glass_optional`, `other_optional`), and **related questions** = every `open_questions[q]` whose `trigger_finding_ids` contains this finding's `id`.

### 3.5 Evidence

- **Images**: `visual_evidence[]` (§5).
- **Sources**: list `combined_feature.sources[]` — `provider`, `title`, `url` (link if not null), `retrieved_at`, `usage_or_attribution`. Mark sources cited nowhere in the report as "not cited".
- **Evidence register**: table of `combined_feature.facts[]` — `id`, `field_key`, value (formatted, §4.3), status badge (§6), `site_scope`, `confidence`, source chips.
- **Data quality notes**: `combined_feature.quality_flags[]` (strings, show as a list; lines starting `CONFLICT` deserve a warning icon) and the `warning` entries of `validation.json`.

### 3.6 Valuation

`valuation_commentary` = `{reconstruction_value_comment, market_value_comment, missing_valuation_inputs[], fact_ids[]}`.

- Value: from fact `feat.reconstruction_value_chf` → `value = {best_estimate_chf, low_chf, high_chf}`. Show **the range**, e.g. "CHF 2'200'000 (range 1'600'000 – 2'800'000)", with its status badge (normally *Estimated*), and `method` as small print. Never show the best estimate alone.
- `reconstruction_value_comment`, `market_value_comment`: text.
- `missing_valuation_inputs`: bullet list (free text, **not** IDs).
- Uncertainty note: "Indicative range, not an appraisal."

### 3.7 Outstanding questions

`open_questions[]` = `{id, priority, question, reason_for_underwriter, expected_answer_or_document, target, feature_ids[], trigger_finding_ids[], blocking_initial_pricing}`.

Table sorted by `blocking_initial_pricing` first, then priority. Columns: priority · question (+ `id`) · why (`reason_for_underwriter`) · recipient (`target`: `client` → Client, `internal_axa` → AXA internal, `risk_engineer` → Risk engineer, `valuation_expert` → Valuation expert) · expected document · blocking (yes/no) · related features (chips) · related findings (links to finding cards). This is an underwriter work queue, not a customer form.

### 3.8 Export

The backend provides JSON only — export format and design are your choice (e.g. browser print / PDF of your report view, JSON download of `output.json` + `features_combined.json`). Never include `metrics.json` or `output.invalid.json` in customer-facing material. For synthetic cases, the banner must appear in print too.

---

## 4. Evidence resolution — exact rules

Build one lookup from `features_combined.json` when the case loads:

```js
const facts   = new Map(bundle.facts.map(f => [f.id, f]));                 // "feat.*", "ev.*"
const sources = new Map(bundle.sources.map(s => [s.id, s]));               // "src_N"
const visuals = new Map(bundle.visuals.map(v => [v.id, v]));               // "vis.*"
const annotations = new Map(bundle.visuals.flatMap(v =>
  v.annotations.map(a => [a.id, { ...a, visual_id: v.id }])));             // "ann.*"
const findings = new Map(report.priority_findings.map(f => [f.id, f]));     // e.g. "F1"
const questions = new Map(report.open_questions.map(q => [q.id, q]));       // e.g. "Q1"

function resolve(id) {
  if (facts.has(id))       return { kind: "fact", item: facts.get(id) };
  if (sources.has(id))     return { kind: "source", item: sources.get(id) };
  if (visuals.has(id))     return { kind: "visual", item: visuals.get(id) };
  if (annotations.has(id)) return { kind: "annotation", item: annotations.get(id) };
  return { kind: "unresolved", id };   // show greyed "unresolved" chip; never guess
}
```

| Report field | Resolves to | Where |
|---|---|---|
| `fact_ids`, `critical_fact_ids` | fact | `combined_feature.facts[].id` |
| `feature_ids`, `unknown_feature_ids` | fact (feature) | `combined_feature.facts[].id` (unknowns are also listed in `combined_feature.unknown_feature_ids`) |
| `evidence_ids` | fact **or** source **or** visual **or** annotation | use `resolve()` — in practice mostly `src_N` |
| `visual_id` | visual | `combined_feature.visuals[].id` |
| `annotation_ids` | annotation **of that visual** | `combined_feature.visuals[visual_id].annotations[].id` |
| `trigger_finding_ids` | finding | `report.priority_findings[].id` |
| a fact's `source_ids` | source | `combined_feature.sources[].id` |
| an annotation's `linked_fact_ids` | fact | `combined_feature.facts[].id` |

Valid reports have no unresolved IDs (the pipeline validates every reference), but keep the "unresolved" chip as a defensive state.

### 4.1 Fact chip

Label = humanised `field_key` (`feat.flood_exposure` → "Flood exposure"), colour = `evidence_status` (§6), tooltip/popover = formatted value + `site_scope` + `confidence` + `method` + source links.

### 4.2 Displaying one finding with its evidence (real example, case `ge_003`)

`output.json`:
```json
{ "id": "F1", "priority": "critical", "finding_type": "source_conflict", "confidence": "high",
  "title": "Declared warehouse/logistics occupancy conflicts with registered furniture manufacturing",
  "observation": "The client declared warehouse/logistics. The registers record NOGA 310900 furniture manufacturing …",
  "underwriting_implication": "The occupancy class drives the fire assessment …",
  "recommended_action": "Ask the client to confirm all activities performed in this building …",
  "fact_ids": ["ev.declared_industry", "feat.business_sector", "feat.building_usage", "ev.company_register"],
  "evidence_ids": ["src_1", "src_10", "src_11", "src_7"],
  "coverage_components": ["fire"] }
```
`features_combined.json` → `facts`:
```json
{ "id": "feat.business_sector", "field_key": "business_sector", "value": "Fabrication d'autres meubles (NOGA 310900)",
  "unit": null, "evidence_status": "official_record", "site_scope": "company", "source_ids": ["src_10", "src_11"],
  "valid_as_of": null, "confidence": "high", "method": "upstream status: verified; …" }
{ "id": "ev.declared_industry", "field_key": "declared_industry_type",
  "value": {"key": "warehouse_logistics", "label": "Warehouse / logistics"},
  "evidence_status": "derived_estimate", "site_scope": "company", "source_ids": ["src_11"], "confidence": "low",
  "method": "declared by the client in the request form (not verified)" }
```
`output.json` → `open_questions`:
```json
{ "id": "Q1", "priority": "critical", "target": "client", "blocking_initial_pricing": true,
  "question": "Which activities are actually carried out at Chemin de la Chênaie 38 …?",
  "feature_ids": ["feat.high_temperature_operations"], "trigger_finding_ids": ["F1"], … }
```
Render: a red *critical* card "Declared warehouse/logistics occupancy conflicts…", chips *Business sector* (green, Verified · official record), *Declared industry type* (amber, Estimated — client declaration), …, source links `src_1 src_10 src_11 src_7`, and "Related question: Q1 — blocks initial pricing".

### 4.3 Formatting values

`value` keeps its JSON type: string, number, boolean, `null`, object or array.
- `null` → "Unknown" (with the Unknown style) — **never** "No" / "None".
- number + `unit` (`CHF`, `m2`) → Swiss formatting `2'200'000 CHF`, `622 m²`.
- reconstruction object → range string (§3.6).
- other objects (e.g. `{"zone": "Z1b", "soil_class": "D"}`, hazard shares) → key: value list; shares in `[0,1]` → percent.
- arrays → bullet list.
- long `ev.*` objects (register records, vision outputs) → collapsed "details" panel.

---

## 5. Visual evidence

`report.visual_evidence[]` = `{visual_id, title, caption, underwriting_relevance, annotation_ids[], fact_ids[]}` selects up to 4 images; their data come from `combined_feature.visuals[]`:

```json
{ "id": "vis.orthophoto", "kind": "aerial_orthophoto", "asset_uri": "images/orthophoto.jpg",
  "source_ids": ["src_6"], "captured_or_published_at": null, "building_egid": "9971523",
  "alt_text": "…", "annotation_ids": ["ann.orthophoto.01", …],
  "annotations": [ { "id": "ann.orthophoto.01", "label": "insured building footprint (red outline)",
      "geometry_type": "polygon", "coordinates_or_bbox": [184,121, 456,121, 456,321, 184,321],
      "linked_fact_ids": ["feat.roof_type_material", "feat.floor_area_m2"],
      "provenance": "geospatial_geometry", "confidence": "high" } ] }
```

- **File location**: `<output dir>/` + `asset_uri` (relative path, e.g. `images/orthophoto.jpg`). The pipeline writes the image files into `images/`.
- **Missing asset**: if the file does not load, show a placeholder "Image not available" with the `visual_id`; never substitute another picture.
- **Overlays**: draw only the annotations listed in the report's `annotation_ids` for that card (others may be toggled on). Use an SVG layer on top of the `<img>` with `viewBox` = natural image size.
  - Coordinate frame: if every number is in `[0,1]` the coordinates are **normalised** (multiply by width/height); otherwise they are **pixels of the original image** (top-left origin, x right, y down).
  - `coordinates_or_bbox` is a flat list `[x1, y1, x2, y2, …]`. `bounding_box` = `[x_min, y_min, x_max, y_max]`; `polygon` / `raster_overlay` = vertices; `point` = `[x, y]`; `line` = polyline.
  - Style by `provenance`: `geospatial_geometry` (official geometry — solid red), `vision_candidate` (AI candidate, *to verify* — dashed orange), `human_annotation` (solid blue), `source_label` (grey). Show `label` + `confidence` in a legend under the image; number markers with the annotation id suffix (`01`, `05`…).
- **Caption block**: `title`, `caption`, `underwriting_relevance`, linked fact chips, then attribution: providers of `source_ids` + their `usage_or_attribution`, `captured_or_published_at` (or "date unknown"), and site linkage (`building_egid` null → "not linked to the insured building" — e.g. a rejected street photo).
- **Real cases**: the aerial orthophoto already has the insured footprint drawn in red by the ETL; facade (Google Street View) is a demo source — keep its attribution visible.
- **Synthetic assets**: a case is synthetic when every `sources[].provider` starts with `"SYNTHETIC"` (also `quality_flags[0]` starts with `"SYNTHETIC case"`). Synthetic images already carry a red "SYNTHETIC" watermark in the pixels; still badge the card.

---

## 6. UI states

### Fact status (`facts[].evidence_status`)

| Value | Label | Suggested style |
|---|---|---|
| `official_record` | Verified — official record | green |
| `site_specific_document` | Verified — site document | green |
| `company_level_document` | Company-level document (not proof for this building) | blue |
| `visual_observation` | Observed in imagery (to verify) | light blue |
| `derived_estimate` | Estimated / inferred / declared — read `method` | amber |
| `unknown` | Unknown — **not** absent | grey |
| `conflicting` | Conflicting evidence | red outline + warning icon |

Combine with `site_scope` (`building`, `industrial_site`, `company`, `neighborhood`, `canton`, `unknown`): a *company*-scope fact must be labelled "company-wide, not confirmed at this building".

### Pipeline / report states (from `metrics.json`)

| Situation | How to detect | Suggested display |
|---|---|---|
| Generation pending | your own job state (the pipeline writes `metrics.json` with `"status": "running"` while it works) | progress indicator; last entry of `metrics.stages` = current stage |
| Valid report | `status == "succeeded"`, `output.json` present | normal case page |
| Invalid report | `status == "invalid_report"` | error panel listing `metrics.validation.issues` (severity `error`); never render `output.invalid.json` as a report |
| Pipeline failure | `status == "failed"` | error panel with `metrics.error.stage` and `.message` (e.g. company not found in the register, building outside Geneva, public service down) |
| Failed ETL source (partial evidence) | `metrics.stages[stage=="etl"].status == "warning"`; per-source status in `.evidence_blocks` (e.g. `"website": "error"`, `"facade": "skipped"`) | notice "Some sources were unavailable" — the report is valid but built on less evidence |
| Missing image | asset file absent / fails to load | placeholder (§5) |
| Unknown feature | fact `value: null` / `evidence_status: "unknown"` | "Unknown" grey chip; usually paired with an open question |
| Conflicting evidence | `evidence_status: "conflicting"` or `quality_flags` starting `CONFLICT` | warning chip + the conflict text |
| Synthetic case | `metrics.synthetic == true` (§5) | permanent banner, also in print |

`metrics.json` excerpt (real run, CMDS SA):
```json
{ "status": "succeeded", "case_id": "cmds-sa", "model_config": "claude_opus55", "synthetic": false,
  "stages": [ { "stage": "etl", "status": "warning", "evidence_blocks": {"public_data": "ok", "aerial_image": "ok", "facade": "skipped", "website": "error"} },
              { "stage": "features", "status": "ok", "detail": "34 facts, 9 sources, 1 visuals, 7 unknown" },
              { "stage": "llm", "status": "ok" }, { "stage": "validate", "status": "ok", "detail": "0 errors, 0 warnings" } ],
  "llm": { "input_tokens": 13133, "output_tokens": 13981, "usd_estimated": 0.332 }, "total_usd": 0.332 }
```
Tokens, cost and latency are internal: show them, if at all, only in an internal "run details" view.

---

## 7. Component mapping (summary)

| OUTPUT field | Component |
|---|---|
| `executive_summary.headline` | Page header title |
| `executive_summary.underwriting_readiness` | Status pill |
| `executive_summary.overview` / `key_takeaway` | Summary paragraph / callout |
| `executive_summary.critical_fact_ids` | Fact chip row |
| `underwriter_next_step` | Primary action box |
| `cope.*` | 4 COPE cards (headline, text, chips, gaps) |
| `priority_findings[]` | Finding cards sorted by priority, with related questions |
| `hazard_interpretations[]` | Hazard table (+ measurement from facts) + regulated-tariff note |
| `valuation_commentary` | Valuation card (range from `feat.reconstruction_value_chf`) + missing-inputs list |
| `visual_evidence[]` | Image cards with SVG annotation overlay + legend + attribution |
| `open_questions[]` | Question queue table (blocking first) |
| `combined_feature.sources[]` | Sources list (Evidence tab / appendix) |
| `combined_feature.facts[]` | Evidence register table |
| `combined_feature.quality_flags[]` + `validation.json` warnings | Data quality notes |

## 8. Test data

- `examples/EXAMPLE_SYNTHETIC_EVIDENCE.json` + `examples/EXAMPLE_SYNTHETIC_LLM_OUTPUT.json`: a small valid pair (COMBINED_FEATURE + OUTPUT).
- Any output folder produced by `python -m src.report` (e.g. run it on `schemas/INPUT/example.customer_request.json`).
- `examples/llm_input.example.json`: a real ETL document (CMDS SA, Plan-les-Ouates).
