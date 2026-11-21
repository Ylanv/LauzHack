# Property Underwriting Risk Report

{{synthetic_watermark_if_applicable}}

**Case** {{case_id}} · **Generated** {{generated_at}} · **Version** {{report_version}}  
**Insured object** {{address}} · **EGID** {{egid_or_unresolved}} · **Company** {{legal_company_name}} · **UID** {{uid_or_unknown}}  
**Jurisdiction** Geneva (GE), Switzerland · **Scope** One commercial building only · **Status** {{underwriting_readiness}}

> Automated evidence-based pre-assessment. Synthetic cases must be visibly labeled as fictional. Not a binding premium quotation, replacement-value appraisal or site inspection.

## PAGE 1 — Decision brief (read in ~60 seconds)

### Executive summary
**{{summary_headline}}**  
{{summary_overview}}  
**Recommended next step:** {{next_step}}

### Top material findings (maximum 5)
| Priority | Observation | Underwriting implication | Action | Evidence |
|---|---|---|---|---|
{{priority_findings_rows}}

### Critical unknowns / decisions pending
{{top_blocking_questions_summary}}

### Available cover context (system-generated, not by LLM)
{{coverage_context_table}}

## PAGE 2 — Building and risk profile

### Building identity & valuation (system-generated)
| Verified attribute | Value | Evidence/status |
|---|---|---|
{{building_fact_rows}}

**Reconstruction value:** {{reconstruction_value_or_unknown}}; valuation confidence {{valuation_status}}.  
**Market value:** {{market_value_or_unknown}} (not a substitute for insured rebuilding value).

### COPE
| Domain | Key data | Underwriting interpretation | Important gaps |
|---|---|---|---|
{{cope_rows}}

### Hazards and insurance treatment
| Hazard | Source measurement/legend | Exposure conclusion | Pricing applicability | Evidence |
|---|---|---|---|---|
{{hazard_rows}}

*For the standard Swiss private natural-hazards component, tariffs are regulated. Local hazard information is for underwriting, prevention and separately priced coverages as applicable; do not apply an individual tariff multiplier.*

## PAGE 3 — Evidence gallery (include only relevant cards)

{{visual_cards_with_deterministically_rendered_annotations}}

Each image card MUST contain: image/overlay, annotation legend, short claim, assessment relevance, source provider, original URL or dataset ID, image capture/publication date (or unknown), retrieval date, confidence, EGID/site linkage, and attribution/usage terms.

Map rules: building footprint outline; exact map layer legend and units; map date; no LLM-fabricated hazard polygon. Public website photographs are only evidence of what is actually visible, not of current occupancy unless dated and site-linked.

## PAGE 4 — Open questions for underwriter (separate from customer form)

| Priority | Question to validate | Why important | Ask whom | Acceptable evidence | Blocks initial pricing? |
|---|---|---|---|---|---|
{{question_rows}}

**Owner-facing intake remains three fields.** This is a back-office verification queue, not an automatically presented customer questionnaire.

## APPENDIX — Provenance and audit

{{ordered_source_register}}

{{coverage_statistics}} · {{model_and_token_usage}} · {{data_freshness_and_license_status}} · {{validation_warnings}}
