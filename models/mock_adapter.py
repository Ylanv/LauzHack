"""Zero-cost mock provider for offline smoke tests: returns a minimal object built from the schema."""
from __future__ import annotations

import json

from models.base import Adapter, GenResult, estimate_tokens, validate


def minimal_instance(schema: dict, case_id: str = "mock"):
    if "const" in schema:
        return schema["const"]
    if "enum" in schema:
        return schema["enum"][0]
    t = schema.get("type")
    if isinstance(t, list):
        t = next((x for x in t if x != "null"), "null")
    if t == "object":
        return {k: (case_id if k == "case_id" else minimal_instance(v, case_id))
                for k, v in schema.get("properties", {}).items() if k in schema.get("required", [])}
    if t == "array":
        return []
    if t == "string":
        return "mock"
    if t in ("integer", "number"):
        return 0
    if t == "boolean":
        return False
    return None


class MockAdapter(Adapter):
    provider = "mock"

    def generate(self, system, user, schema, images=None, guard=None, schema_name="underwriting_report"):
        case_id = "mock"
        marker = '"case_id": "'
        if marker in user:
            case_id = user.split(marker, 1)[1].split('"', 1)[0]
        if guard:
            guard(estimate_tokens(system + user), 500)
        data = minimal_instance(schema, case_id)
        text = json.dumps(data)
        errs = validate(schema, data)
        return GenResult(text=text, parsed_json=data, input_tokens=estimate_tokens(system + user),
                         output_tokens=estimate_tokens(text), latency_ms=1, schema_valid=not errs,
                         validation_errors=errs, finish_reason="stop", structured_mode="mock",
                         model_reported="mock")
