"""Validate an llm_input.json: JSON Schema + consistency checks.

    python -m src.validate probe_out/cmds-sa/llm_input.json
"""

import json
import sys
from pathlib import Path

from jsonschema import Draft202012Validator

SCHEMA = Path(__file__).resolve().parent.parent / "schemas" / "llm_input.schema.json"


def validate(doc: dict) -> list[str]:
    schema = json.loads(SCHEMA.read_text(encoding="utf-8"))
    errors = [f"schema: {'/'.join(map(str, e.absolute_path)) or '<root>'}: {e.message}"
              for e in Draft202012Validator(schema).iter_errors(doc)]
    if errors:
        return errors
    names = [f["feature"] for f in doc["features"]]
    if len(set(names)) != len(names):
        errors.append("features: duplicates")
    src_ids = {s["id"] for s in doc["sources"]}
    for feat, ev in doc["feature_evidence"].items():
        errors += [f"feature_evidence.{feat}: unknown source {sid}" for sid in ev["source_ids"] if sid not in src_ids]
    for f in doc["features"]:
        if f["status"] == "unknown" and f["value"] is not None:
            errors.append(f"{f['feature']}: status unknown but value is set")
        if f["status"] != "unknown" and f["value"] is None:
            errors.append(f"{f['feature']}: value is null but status is {f['status']}")
    return errors


def main() -> int:
    doc = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    errors = validate(doc)
    for e in errors:
        print(e)
    print("OK" if not errors else f"{len(errors)} error(s)")
    return 0 if not errors else 1


if __name__ == "__main__":
    sys.exit(main())
