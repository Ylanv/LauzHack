# AXA Smart Property — report kit (frozen report-writing contract)

> Originally delivered as `AXA_Underwriting_Report_Kit_ClaudeCode_v2/`. The schemas now live in `schemas/COMBINED_FEATURE/` and `schemas/OUTPUT/` (see `schemas/README.md`); prompt, template and specs stay in this folder; examples are in `examples/EXAMPLE_SYNTHETIC_*.json`. File hashes: `FROZEN.sha256`.

This kit contains the **frozen report-generation contract** for the 10-hour, synthetic-only underwriting report benchmark. It is intended to be copied into the existing repository; it does not replace the feature/ETL contract the team already has.

## Exact file roles

| File | Owner / usage |
| --- | --- |
| `reporting/REPORT_TEMPLATE.md` | Deterministic renderer; standardized 4-page underwriter report |
| `schemas/OUTPUT/report_output.v1.schema.json` | **LLM output contract** (JSON Schema, version `1.0`) |
| `schemas/COMBINED_FEATURE/combined_feature.v1.schema.json` | Compact **model input contract** after normalization (version `1.0`) |
| `reporting/REPORT_WRITER_PROMPT.md` | Shared report-writer instructions for **all** candidate models |
| `reporting/IMPLEMENTATION_SPEC.md` | Architectural, rendering and safety constraints |
| `reporting/INPUT_V2_ADAPTER.md` | Required mapping from the existing `2.0-llm-input` object into the evidence bundle |
| `examples/EXAMPLE_SYNTHETIC_EVIDENCE.json` | Valid normalized synthetic input |
| `examples/EXAMPLE_SYNTHETIC_LLM_OUTPUT.json` | Valid model narrative output |
| `examples/demo-assets/flood_map_placeholder.png` | Fictional illustrative visual asset, not geographic evidence |
| 

## Data flow

`Existing synthetic case (schema_version=2.0-llm-input)` → **deterministic v2 adapter** → `schemas/COMBINED_FEATURE/combined_feature.v1.schema.json` → **LLM structured response** `schemas/OUTPUT/report_output.v1.schema.json` → deterministic report renderer using `REPORT_TEMPLATE.md`.

**Do not** feed the raw v2 input to one model and the normalized evidence bundle to another. Models must receive identical data within each controlled benchmark.

## Important conventions

1. The `2.0-llm-input` schema is the user's **existing upstream input** and is not overwritten by this kit.
2. The intermediary `evidence_bundle` **schema_version** is `1.0`. The LLM report **schema_version** is also `1.0`. They are different contracts, not a downgrade of the upstream format.
3. The model writes only narrative, findings, uncertainty and reference IDs. Backend renders exact building values, images, hazard maps, source details, legal caveats and costs.
4. `verified` in a **synthetic case** means supported by the artificial case's evidence oracle, never verified about an actual building.
5. Every factual claim must reference an input fact ID. Inputs with unresolved references or unsupported 'verified' fields must be repaired or rejected for the benchmark.
6. A company-wide industrial process is not evidence that the process takes place inside the specific building.
7. The standard regulated natural-hazards tariff must not receive a risk-based individual surcharge based on flood, runoff, hail or storm-zone data.
8. The model must not invent an insurance premium, asset value, hidden safety installations, fake sources or photos.

## Required integration checks

- Validate both example JSON files against their respective schemas.
- Check every output `fact_id`, `visual_id`, `annotation_id` and `feature_id` against the normalized evidence bundle.
- Verify the normalized bundle preserves arrays/objects such as `surface_runoff_exposure`, `earthquake_exposure` and `reconstruction_value_chf`.
- Reject hallucinated numeric claims and references, unsupported site-specific observations, or fake annotated overlays.
- Render the complete example end to end, with the accompanying synthetic visual clearly labeled as fictional.

## Benchmark note

Report writers are judged on analysis quality using **the same evidence bundle** and **the same fixed rendering template**. This is a synthetic pilot, not a demonstration of AXA premium accuracy or real-world underwriting performance.

## Acceptance checklist

- [ ] Both example JSON documents validate with Draft 2020-12 JSON Schema.
- [ ] Normalization preserves all 19 upstream feature names and values, including nested objects and lists.
- [ ] At least one end-to-end synthetic report is rendered using `REPORT_TEMPLATE.md`.
- [ ] Every displayed cited fact resolves to an allowed evidence ID.
- [ ] Missing systems (e.g., sprinklers) produce questions rather than guessed features.
- [ ] One fictional evidence image is displayed with its attribution and synthetic watermark.
- [ ] No premiums are calculated or quoted by the report writer.
- [ ] All candidate model reports use the same final visual format.
