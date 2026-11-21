# Adapter specification: upstream v2.0 input → validated evidence bundle v1.0

**Purpose.** Preserve the existing synthetic dataset's `schema_version: "2.0-llm-input"`, while giving all report-writing models a smaller, consistent, referenceable bundle matching `evidence_bundle.schema.json`. The adapter MUST be deterministic and produce no LLM calls.

## Inputs and outputs

Input: the user's v2 object with `request`, `identification`, `features[]`, `feature_evidence`, `feature_coverage_before_llm`, `sources[]`, `evidence`, `images`, and `metrics`.

Output: `{schema_version, case, building, coverage_context, facts, visuals, sources, unknown_feature_ids, quality_flags}`.

Maintain the exact input file unchanged and version the normalized file separately.

## Field mapping

| Normalized field | Source/method |
| --- | --- |
| `schema_version` | Literal `"1.0"` |
| `case.case_id` | Stable synthetic case ID from dataset manifest; v2 example does **not** provide one |
| `case.client_name` | `request.client_name` |
| `case.legal_company_name` | `request.company_legal_name` |
| `case.building_address` | `request.building_address` |
| `case.created_at` | Date part of `generated_at`; validate format |
| `building.egid` | `identification.building_egid` or null |
| `building.company_uid` | `identification.company_uid` or null |
| `building.canton` | `identification.canton` (must be `GE` for this benchmark) |
| `building.identity_resolution` | `unique` only if exact one-building match is explicitly established; otherwise `ambiguous` or `not_found` |
| `coverage_context.jurisdiction` | `CH-GE` |
| `coverage_context.candidate_components` | Jurisdiction-appropriate *candidate* components; NOT a claim that the client selected them |
| `facts[]` | One normalized fact per input `features[]` item, plus essential identity/unknown protection facts |
| `visuals[]` | Valid files from `images` / `evidence`, with real annotation metadata if present |
| `sources[]` | Deduplicated v2 source records expanded with nullable metadata |
| `unknown_feature_ids` | IDs of unknown/missing but underwriting-relevant facts |
| `quality_flags` | Missing or conflicting provenance, stale images, ambiguous EGID, unmapped statuses |

## Normalizing facts

For each item in `features[]`:

- Set `id` to `feat.<feature>` (e.g., `feat.surface_runoff_exposure`), stable across runs.
- Set `field_key` to the exact existing feature name.
- Keep `value` with its JSON type and precision; the updated evidence schema accepts scalar, object and array values. Never stringify complex values solely to pass validation.
- Assign `unit` where unambiguous (`CHF` for reconstruction value, `m2` for floor area; otherwise null). For nested objects, retain their original keys and units.
- Transfer `source_ids` from `feature_evidence[feature].source_ids`. Every ID must appear in `sources[]`.
- Derive `site_scope` from supporting evidence. Use `building` only when the evidence is linked to the **insured building**; use `company` for company-wide process claims; use `unknown` if unclear.
- Preserve estimated ranges exactly; never replace them with a midpoint presented as a confirmed value.
- Keep `valid_as_of` null when the source date is not available, with a quality flag if material.

### Status crosswalk

| Upstream `status` | Normalized `evidence_status` | Constraints |
| --- | --- | --- |
| `verified` | `official_record` or `site_specific_document` or `company_level_document` | Choose from **actual source kind and scope**, never based on status alone. MUST have a matching supporting source; otherwise reject benchmark case. |
| `estimated` | `derived_estimate` | Store explicit method/provenance where available; if missing, add a quality flag. |
| `observed` | `visual_observation` | Requires a valid asset/observation provenance; otherwise flag and do not claim it is verified. |
| `inferred` | `derived_estimate` | Low or medium confidence only; keep inferred status explicit in `method` and never promote to confirmed. |
| `unknown` | `unknown` | Preserve null, no source references unless supporting why unknown. |

Do not conflate the presence of a **gas heating boiler** with proof of hot-work or high-temperature **industrial manufacturing**. Treat company-wide industry activity as a candidate, not a building-specific verified process.

### Required missing protection facts

The 19-feature v2 input does not explicitly list sprinklers, fire alarms, fire compartmentation, fire suppression inspections, prior losses or pipe condition. If none is separately evidenced, append facts such as `feat.sprinklers` with `value: null`, `evidence_status: unknown`, `site_scope: unknown`, no source IDs and low confidence. Place their IDs in `unknown_feature_ids` for the question-generation step. **Never infer absent from not found.**

## Sources and synthetic cases

- Use fake provider names explicitly prefixed `SYNTHETIC` and source URLs set to `null` for constructed cases.
- Real provider names and URLs must not be attached to invented records that claim to come from Zefix, SITG, RegBL or swisstopo.
- Preserve each source's ID. Do not invent `src_999` merely to make an unsupported feature look verified.
- Do not send the private truth/oracle to candidate report writers; the oracle is only for evaluation.
- `metrics`, tool traces, API keys, and other execution metadata are **not** facts and must not enter the LLM prompt.
- The report text must say that the case and evidence are synthetic wherever external sharing or screenshots could be misleading.

## Visual evidence

- Each valid `images` entry becomes a `visuals[]` entry only if its actual asset exists and can be retrieved.
- Assign stable IDs (for example, `vis.orthophoto`, `vis.website_1`). Store the relative `asset_uri`, attribution, capture date, source IDs, EGID/site linkage, and genuine annotation IDs.
- An image label is **not** proof that the image contains the claimed element. Generate observations and annotations before the model sees them; do not let the final writer invent them.
- For aerial hazard overlays use explicit geometry/raster annotations created by the dataset, **never** generatively drawn maps. If a visual depicts a fictional case, visibly mark it synthetic.
- Website images may be used as evidence for a specific building only if that association is recorded in the fixture.

## Compact token-efficient rendering input

The adapter may produce a second `compact` view. It may remove redundant company-identification text, empty nested `evidence` objects, raw HTML/website content, API logs, source repetition, and unneeded `metrics`, but it MUST retain:

- All material fire and natural-hazard exposures and their numbers/units.
- Contradictions and status/confidence distinctions.
- Reconstruction cost range and its estimated nature.
- All critical missing-information facts.
- Stable fact/source/visual/annotation IDs.

Compare full vs. compact with the **same** model, prompt and output schema. Record actual cost and factual recall, not only tokens saved.

## Quality gates

1. Validate normalized evidence bundle against schema.
2. Reject unresolved `verified` fact provenance in synthetic benchmark cases.
3. Check every `source_id` exists and no source supports something outside its documented scope.
4. Verify consistency of numeric ranges (`low <= best <= high`, nonnegative shares in [0,1], sensible units).
5. Verify actual assets exist before allowing `visuals[]` references.
6. Ensure output references only IDs present in the normalized bundle.
7. Never promote a general Swiss natural-hazard location indicator into an individualized regulated premium surcharge.
8. Include all missing and unknown material features in the underwriter-only question queue where relevant.
