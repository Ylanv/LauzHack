# Web app: requests from the team

Read [WEBAPP.md](WEBAPP.md) first. Then add **one block per request** below, copying the template. Keep each request concrete, so the web app can be adapted without a meeting. Agents: fill this in on behalf of your owner and do not edit `webapp/` directly unless asked.

## Template
```md
### <short title>
- Owner: <name / branch>
- Type: form field | new page/screen | waiting-screen step | data shown to the client | API/backend contract | other
- What the client should see or do: <one or two sentences>
- Data I send / need: <field names, types, example JSON; which PIPELINE_ADAPTER function or endpoint>
- When: <which step, before/after what>
- Must not: <constraints, e.g. no risk score, no cost shown>
- Priority: must | nice to have
- Status: open
```

## Requests

<!-- add your blocks below this line -->


### Collect the declared industry
- Owner: Backend / main
- Type: form field
- What the client should see or do: Select the main activity of the business from a required dropdown.
- Data I send / need: GET /api/industries returns an array of {key: string, label: string}. Display the label and submit the key as industry_type (e.g. "metalworking").
- When: On the form, before submission. The CMDS SA demo should preselect metalworking.
- Must not: Infer the client's answer from the company name.
- Priority: must
- Status: done in webapp/ (2026-11-21), see WEBAPP.md

### Identify the Geneva business premises
- Owner: Backend / main
- Type: form field
- What the client should see or do: Enter the exact registered company name and the full address of the building it occupies for its business in the canton of Geneva. Explain the scope beside the address field.
- Data I send / need: company_legal_name: string (e.g. "CMDS SA"), address: string (e.g. "Rue du Champ-Blanchod 7, 1228 Plan-les-Ouates"). Use the existing canton lookup to flag an out-of-canton selection.
- When: During address selection and before submission.
- Must not: Accept a town alone or silently substitute a nearby street number.
- Priority: must
- Status: done in webapp/ (2026-11-21), see WEBAPP.md

### Run the live assessment once per submission
- Owner: Backend / main
- Type: API/backend contract
- What the client should see or do: See the waiting screen while the backend processes the building, then see confirmation when the live request succeeds.
- Data I send / need: Replace the /api/report call in PIPELINE_ADAPTER.synthesis with one POST /api/llm-input?for_llm=true per submission. Example body is {"client_name":"Marie Dupont","company_legal_name":"CMDS SA","address":"Rue du Champ-Blanchod 7, 1228 Plan-les-Ouates","industry_type":"metalworking"}. The response is the assessment document. The endpoint supplies no tracking reference or per-branch progress.
- When: Start on submit and tie completion to the response. Keep simulated completion in the explicit demo flow.
- Must not: Fall back to a mock success after four seconds, display a fabricated live reference, or expose the underwriting document to the client.
- Priority: must
- Status: done in webapp/ (2026-11-21), see WEBAPP.md

### Recover from a rejected or unavailable assessment
- Owner: Backend / main
- Type: API/backend contract
- What the client should see or do: Keep the entered values. Offer correction for invalid input, access-code entry when required, and a retry after a service failure.
- Data I send / need: GET /api/health exposes access_code_required: boolean. For protected submissions send the entered code in X-Access-Code. Handle 401 for a missing or wrong code, 422 for invalid or out-of-scope input, and 503 for an unavailable upstream service. Use the 422 detail to explain what needs attention.
- When: Check access requirements before the live POST and handle errors before showing confirmation.
- Must not: Embed the team's access code in the frontend bundle or retry a paid request automatically.
- Priority: must
- Status: done in webapp/ (2026-11-21), see WEBAPP.md
