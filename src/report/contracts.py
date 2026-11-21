"""Canonical schema registry (schemas/<CATEGORY>/) + validation helpers. See schemas/README.md."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[2]
SCHEMAS = ROOT / "schemas"

PATHS = {
    "INPUT": SCHEMAS / "INPUT" / "customer_request.v1.schema.json",
    "FEATURE_DOC": SCHEMAS / "FEATURE" / "llm_input.v2.schema.json",      # ETL output (2.0-llm-input)
    "FEATURE": SCHEMAS / "FEATURE" / "feature.v1.schema.json",            # features.json
    "COMBINED_FEATURE": SCHEMAS / "COMBINED_FEATURE" / "combined_feature.v1.schema.json",
    "OUTPUT": SCHEMAS / "OUTPUT" / "report_output.v1.schema.json",
}
VERSIONS = {"INPUT": "1.0-customer-request", "FEATURE_DOC": "2.0-llm-input", "FEATURE": "1.0-features",
            "COMBINED_FEATURE": "1.0", "OUTPUT": "1.0"}
SYSTEM_PROMPT = ROOT / "reporting" / "REPORT_WRITER_PROMPT.md"


@lru_cache(maxsize=None)
def schema(kind: str) -> dict:
    return json.loads(PATHS[kind].read_text(encoding="utf-8"))


def errors(kind: str, doc) -> list[str]:
    v = Draft202012Validator(schema(kind))
    return [f"{'/'.join(map(str, e.absolute_path)) or '<root>'}: {e.message[:300]}"
            for e in sorted(v.iter_errors(doc), key=lambda e: list(map(str, e.absolute_path)))]


def detect(doc: dict) -> str:
    """Which contract a JSON document follows: INPUT | FEATURE_DOC | COMBINED_FEATURE | OUTPUT."""
    sv = str(doc.get("schema_version", ""))
    if sv == VERSIONS["INPUT"] or ("company_legal_name" in doc and "features" not in doc and "request" not in doc):
        return "INPUT"
    if sv == VERSIONS["FEATURE_DOC"]:
        return "FEATURE_DOC"
    if "facts" in doc and "case" in doc:
        return "COMBINED_FEATURE"
    if "executive_summary" in doc and "priority_findings" in doc:
        return "OUTPUT"
    raise ValueError(f"unrecognised input document (schema_version={sv!r}); expected one of {list(VERSIONS.values())}")
