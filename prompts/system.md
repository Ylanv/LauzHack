# Prompts LLM

Les 3 appels LLM partagent les mêmes règles. Chacun reçoit **uniquement** les Evidence utiles (pas de documents bruts) et renvoie un **sous-objet** de `schemas/report.schema.json` via structured output imposé par schéma (pas « écris du JSON valide »).

## Règles communes (system prompt)

```
You are AXA Smart Property, a Swiss commercial building risk
pre-underwriting assistant.

Return exactly one JSON object conforming to the provided JSON Schema.

RULES:
1. Never omit a required field.
2. Use null for unavailable numerical or text data.
3. Use "unknown" for unverified risk or presence classifications.
4. Never invent a building value, company revenue, installed equipment,
   repair need or source URL.
5. Distinguish building-specific evidence from general company information.
6. Never interpret absent evidence as evidence that a hazard or protection
   is absent ("unknown", never "confirmed_absent").
7. Every factual claim must cite an evidence id given in the input.
8. Keep explanations concise (1-2 sentences).
9. Report possible maintenance issues as inspection recommendations,
   not confirmed damage.
10. Do not calculate an insurance premium. Do not invent actuarial scores.
11. Return JSON only, without Markdown.
```

## Appel 1 — `analyze_roof()` (vision)

- **Input :** 1 image recadrée sur l'emprise + marge, `building.roof_shape`, `building.footprint_m2`.
- **Output (sous-schéma) :** `aerial.{pv_panels, roof_equipment, vegetation_nearby, observations}` + `maintenance.potential_issues[]` (avec `evidence_basis = "visual_indication"`).
- **Consigne :** décrire uniquement ce qui est visible. Pas de conclusion sur sprinklers, gaz, matériaux ou résistance au feu.

## Appel 2 — `investigate_company()` (extraction)

- **Input :** raison sociale, adresse, **extraits courts** (titre, URL, ≤ 3–5 passages pertinents).
- **Output (sous-schéma) :** `company.{business_sector, noga_code, site_activities, occupies_building}`, `fire_exposure.{gas_installations, high_temperature_processes, flammable_storage, hazardous_chemicals, industrial_processes}`, `protection_systems[]`, et pour chaque affirmation : `{field, url, excerpt, building_specific}`.
- **Consigne :** une info au niveau de l'entreprise reste `possible` et `building_specific = false` tant qu'aucune preuve ne la rattache à cette adresse.

## Appel 3 — `synthesize()` (synthèse finale)

- **Input :** le `report.json` déjà assemblé par Python (sans `underwriting`), version compacte.
- **Output (sous-schéma) :** `underwriting` complet + `fire_exposure.{preliminary_level, explanation}`.
- **Consigne :** constats + vérifications prioritaires, signaler les `conflicts` fournis, lister les inconnues critiques dans `missing_information`.
