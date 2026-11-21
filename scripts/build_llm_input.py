"""Part 1 of the pipeline for one company: 4 inputs → llm_input.json (+ photos as .jpg).

    python scripts/build_llm_input.py "Marie Dupont" "CMDS SA" "Rue du Champ-Blanchod 7, 1228 Plan-les-Ouates" --industry metalworking

Writes probe_out/<slug>/llm_input.json (photos embedded as base64), llm_input.for_llm.json (same without photos:
what the final-report LLM receives) and the photos as .jpg files. --no-vision = 0 token.
"""

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from src.industries import INDUSTRIES  # noqa: E402
from src.pipeline import InputError, ServiceError, for_llm_text, run, save  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("client_name")
    ap.add_argument("company", help="exact registered company name")
    ap.add_argument("address", help="Geneva building address: 'Street N, NPA Town'")
    ap.add_argument("--industry", required=True, choices=sorted(INDUSTRIES), help="industry type declared by the client")
    ap.add_argument("--website", help="optional technical hint")
    ap.add_argument("--no-vision", action="store_true", help="skip the vision calls (0 token)")
    ap.add_argument("--out", default="probe_out")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        doc = run(a.client_name, a.company, a.address, a.industry, a.website, use_llm=not a.no_vision)
    except (InputError, ServiceError) as e:
        print(f"ERROR: {e}")
        sys.exit(1)
    out = Path(a.out) / re.sub(r"[^a-z0-9]+", "-", a.company.lower()).strip("-")
    save(doc, out)
    (out / "llm_input.for_llm.json").write_text(json.dumps(for_llm_text(doc), ensure_ascii=False, indent=2), encoding="utf-8")
    c, m = doc["feature_coverage_before_llm"], doc["metrics"]
    print(f"{a.company}: features {c['all']['filled']}/{c['all']['total']} (P0 {c['P0']['filled']}/{c['P0']['total']}, "
          f"P1 {c['P1']['filled']}/{c['P1']['total']}, P2 {c['P2']['filled']}/{c['P2']['total']}) · photos: {', '.join(doc['images']) or 'none'}"
          f" · {m['duration_ms'] / 1000:.1f}s · {len(m['tool_calls'])} vision call(s), CHF {m['cost_chf']:.4f}")
    print(f"→ {out / 'llm_input.json'}")


if __name__ == "__main__":
    main()
