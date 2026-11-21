"""Validate a report.json: JSON Schema + source traceability.

Usage: python -m src.validate_report path/to/report.json
"""

import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "schemas" / "report.schema.json"

# Blocks that are not factual claims needing a source.
UNSOURCED_BLOCKS = {"schema_version", "report_id", "generated_at", "underwriting", "sources", "metrics"}
# Judgment fields written by the synthesis LLM, derived from other sourced fields.
UNSOURCED_FIELDS = {
    "fire_exposure.preliminary_level",
    "fire_exposure.explanation",
    "maintenance.assessment_scope",
    "maintenance.note",
}


def _resolve(report: dict, dot_path: str) -> bool:
    node = report
    for key in dot_path.split("."):
        if not isinstance(node, dict) or key not in node:
            return False
        node = node[key]
    return True


def _filled_leaf_paths(node, prefix=""):
    """Yield dot paths of top-level fields (depth 2) holding a known value."""
    for key, value in node.items():
        path = f"{prefix}{key}"
        if value is None or value == "unknown" or value == []:
            continue
        yield path


def validate(report: dict) -> list[str]:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    errors = [
        f"schema: {'/'.join(map(str, e.absolute_path)) or '<root>'}: {e.message}"
        for e in Draft202012Validator(schema).iter_errors(report)
    ]
    if errors:
        return errors

    sources = report["sources"]
    ids = [s["id"] for s in sources]
    if len(ids) != len(set(ids)):
        errors.append("sources: duplicate ids")

    supported = set()
    for s in sources:
        for path in s["supports_fields"]:
            if not _resolve(report, path):
                errors.append(f"sources: {s['id']} cites unknown field '{path}'")
            supported.add(path)

    for c in report["underwriting"]["conflicts"]:
        for sid in c["source_ids"]:
            if sid not in ids:
                errors.append(f"conflicts: unknown source id '{sid}'")

    # Every known factual value must be backed by a source (field or its parent).
    for block, content in report.items():
        if block in UNSOURCED_BLOCKS or not isinstance(content, dict):
            continue
        for path in _filled_leaf_paths(content, f"{block}."):
            if path in UNSOURCED_FIELDS:
                continue
            leaf = content[path.split(".", 1)[1]]
            if isinstance(leaf, dict) and leaf.get("assessment_basis") == "not_assessed":
                continue
            if isinstance(leaf, dict) and leaf.get("status") == "not_estimated":
                continue
            if path not in supported and block not in supported:
                errors.append(f"traceability: '{path}' has a value but no source")

    return errors


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    report = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    errors = validate(report)
    for e in errors:
        print(e)
    print("OK" if not errors else f"{len(errors)} error(s)")
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
