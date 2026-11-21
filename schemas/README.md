# Schemas

Four contracts, one folder each. JSON Schema Draft 2020-12. A schema is never edited in place: a breaking change gets a new file (`*.v2.schema.json`) and a new `schema_version`.

```
INPUT ──(ETL: src/pipeline.py)──▶ FEATURE ──(src/report/evidence.py)──▶ COMBINED_FEATURE ──(LLM: src/report/generate.py)──▶ OUTPUT
```

Run it all with `python -m src.report --input input.json --output <dir>` (see `src/report/pipeline.py`).

| Category | Schema | `schema_version` | Produced by | Consumed by | Public contract? |
|---|---|---|---|---|---|
| **INPUT** | `INPUT/customer_request.v1.schema.json` | `1.0-customer-request` | the user / dashboard (same fields as `POST /api/llm-input`) | ETL (`src/pipeline.run`) | yes |
| **FEATURE** | `FEATURE/llm_input.v2.schema.json` — ETL document | `2.0-llm-input` | ETL (`src/pipeline.py`, `POST /api/llm-input`) | evidence adapter; also accepted directly as pipeline input (pre-enriched mode) | yes (existing API output) |
| | `FEATURE/feature.v1.schema.json` — one feature record list | `1.0-features` | definition of the 19 features with value, status, verification flag, source IDs | documentation / tooling | internal |
| **COMBINED_FEATURE** | `COMBINED_FEATURE/combined_feature.v1.schema.json` — evidence bundle (`features_combined.json`) | `1.0` | `src/report/evidence.py` (deterministic, no LLM) | report model; dashboard (ID resolution) | yes |
| **OUTPUT** | `OUTPUT/report_output.v1.schema.json` — structured report (`output.json`) | `1.0` | report model, then `src/report/validate_report.py` | dashboard | yes |

Examples: `INPUT/example.customer_request.json` · `../examples/llm_input.example.json` (real ETL document) · `../examples/EXAMPLE_SYNTHETIC_EVIDENCE.json` (COMBINED_FEATURE) · `../examples/EXAMPLE_SYNTHETIC_LLM_OUTPUT.json` (OUTPUT).

## Rules

- **Feature status** (`verified`, `observed`, `inferred`, `declared`, `estimated`, `unknown`) is set by the ETL and never upgraded. The adapter maps it to `evidence_status` in COMBINED_FEATURE (table in `reporting/INPUT_V2_ADAPTER.md`); a "verified" feature without an official/document source is downgraded and flagged.
- **IDs are stable across all stages**: feature `x` is fact `feat.x` in COMBINED_FEATURE and in OUTPUT; source IDs `src_N` come from the ETL unchanged; images become `vis.<file stem>`.
- **Unknown is not absent**: missing protections (sprinklers, alarms, compartmentation, inspections, prior losses, pipes, electrical) are added as unknown facts and listed in `unknown_feature_ids`.
- **Synthetic data** is recognised by source providers prefixed `SYNTHETIC` (URLs null). Real ETL data keeps its providers, URLs and attributions.
- **OUTPUT and COMBINED_FEATURE are frozen** (report kit, hashes in `reporting/FROZEN.sha256`); the model prompt is `reporting/REPORT_WRITER_PROMPT.md`.

## Adapters

| From | To | Where |
|---|---|---|
| customer request | ETL document | `src/pipeline.run()` |
| ETL document `2.0-llm-input` | COMBINED_FEATURE | `src/report/evidence.to_bundle()` |
| any supported input | detection of its kind | `src/report/contracts.detect()` |
