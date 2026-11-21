# AXA Smart Property — Underwriting Report Generation Design (v1.0)

## Objective
Turn three customer inputs (name, exact legal company name, one building address) and a pre-collected public-information evidence bundle into a standardized, high-quality underwriter dossier with curated visual evidence and a separate high-value verification-question queue. Geneva commercial buildings only.

## Contract
1. Input to LLM: evidence_bundle.schema.json.
2. Output from LLM: llm_report_output.schema.json.
3. Renderer: REPORT_TEMPLATE.md.
4. Prompt: REPORT_WRITER_PROMPT.md.

## Core design
### Facts remain immutable
Never ask the LLM to restate or repair official numeric values. It writes analysis only, with IDs of facts and visuals. Backend owns customer details, source names/URLs, measurements, coverage rules, and image files. Every citation and rendered figure is resolved from an allowlist of source/evidence IDs.

### Inputs and geospatial identity
Resolve company UID and building EGID independently; match the single intended building before drawing a footprint. When one address resolves to several EGIDs, stop building-specific assessment and flag the ambiguity. Do not assume legal headquarters equals insured site.

### Source priorities
- Legal company / UID: Zefix or verified official company directory.
- Building record / construction: RegBL + geo.admin address service.
- Building footprint/roof imagery: swisstopo (SWISSIMAGE / building geometry).
- Geneva river-flood map: SITG LCE_DANGERS_CRUES and applicable local layers.
- Surface runoff: OFEV official runoff maps.
- Hail: MeteoSwiss open hail climatology.
- Seismic hazard: Swiss Seismological Service / federal maps.
- Industry-specific process evidence: site-specific published materials; otherwise company-level caveat.
- Sprinklers, claims, pipe condition, true replacement-value appraisal: usually client or AXA inspection; unknown when unsupported.

### Visuals
For maps, overlay separately validated features on licensed/georeferenced aerial image: footprint, official hazard polygons/raster, north indicator, legend, scale and date. Use Pillow/GeoPandas/rasterio on the backend. Do not instruct a generative image model to recreate a hazard map. Show exact extracted layer legend, not invented 'risk score'. For web/industrial photos, use source-licensed, dated assets; trace photo to site and original claim. Do not infer invisible interior installations from aerial imagery.

### Automated QA
- JSON Schema validation; all required keys present.
- Referential integrity: every fact/evidence/visual/annotation ID in LLM output exists in input.
- Contradiction check: status cannot become 'verified' from weak evidence; company-level != building-level.
- Numeric check: values and computed fields are not authored by LLM. No unsupported CHF, dates, probabilities or scores.
- Image check: every visual and annotation exists, tied to same target EGID or clearly marked company-wide.
- Coverage check: no tailored premium multiplier for standard regulated natural-hazards cover.
- Missing-info check: important missing features appear in questions; 'unknown' is not 'absent'.
- Source licensing check: ensure use permission/attribution for each dataset; SITG dataset-specific conditions may limit commercial use.
- Outlier / red flag -> send for human review, do not auto-approve.

### Token-efficiency allocation
1. Geocoding, lookups, geospatial intersections, OCR/text extraction, image crop and page selection: 0 LLM tokens whenever deterministic tools suffice.
2. Select ~12-25 strong facts, 0-4 visuals with reference IDs, and up to 6 meaningful risks; prune low-value text.
3. Vision is run separately only if visual observations can change underwriting interpretation, ideally one crop / one model call; store structured observed findings. Never send image pixels again to report-writing LLM.
4. Report writer: one high-quality structured-output LLM call. Target narrative input 2-5k text tokens depending on complexity (plus fixed prompt/schema overhead), generated narrative 1-2k tokens. These are engineering budgets, not guaranteed counts.
5. Optional second verification call only when automated QA detects a difficult contradiction; otherwise deterministic render.
6. Cache by EGID, source revision/date and content hashes; client names excluded from shared cache keys.
7. UI/PDF render via HTML templates and CSS: zero LLM tokens. Record actual input/output/image tokens, USD/CHF cost, time, quality-score per case.

### Underwriting quality KPIs
Field coverage (with correct status), factual support rate, top findings relevance, critical missing-question recall, source currency, identity linkage accuracy, value-estimate validity, human time-to-decision, cost/report, tokens/verified fact, visual evidence helpfulness. Have an underwriter score cases blind and compare with manually prepared dossiers.

### Report defaults
- Executive brief 1 page; building+COPE+hazards 1 page; evidence gallery 1 page if visuals; open questions 1 page; source appendix optionally longer.
- Every report uses the same section order even if sections say 'not assessed'.
- Maximum 5 top findings on page 1, 4 images, 8 questions.
- If no valid asset, omit figure rather than inventing one; no reliance on hidden image generation.
- Do not quote an AXA premium from public data unless AXA has provided its proprietary tariff/approved quote engine.
