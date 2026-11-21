"""Generate a full report: 3 inputs → 3 blocks → 25 features → final LLM → HTML with photos.

    python scripts/run_report.py "Marie Dupont" "Schreinerei Gassmann AG" "Allmend 53, 6204 Sempach"
    python scripts/run_report.py "Marie Dupont" "Victorinox AG" "Schmiedgasse 57, 6438 Ibach" --website https://www.victorinox.com

Writes probe_out/<slug>/report.html and report.json.
"""

import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from src.pipeline import InputError, ServiceError, run  # noqa: E402


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("client_name")
    ap.add_argument("company")
    ap.add_argument("address")
    ap.add_argument("--industry", required=True, choices=sorted(__import__("src.industries", fromlist=["x"]).INDUSTRIES),
                    help="industry type declared by the client")
    ap.add_argument("--website", help="optional technical hint")
    ap.add_argument("--out", default="probe_out")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        res = run(a.client_name, a.company, a.address, a.industry, a.website)
    except (InputError, ServiceError) as e:
        print(f"ERROR: {e}")
        sys.exit(1)
    out = Path(a.out) / re.sub(r"[^a-z0-9]+", "-", a.company.lower()).strip("-")
    out.mkdir(parents=True, exist_ok=True)
    (out / "report.html").write_text(res.pop("html"), encoding="utf-8")
    (out / "report.json").write_text(json.dumps(res, ensure_ascii=False, indent=2), encoding="utf-8")
    m, c = res["metrics"], res["feature_coverage"]
    print(f"{a.company}: attention={res['report']['attention_level']} · features {c['all']['filled']}/{c['all']['total']}"
          f" (P0 {c['P0']['filled']}/{c['P0']['total']}, P1 {c['P1']['filled']}/{c['P1']['total']}, P2 {c['P2']['filled']}/{c['P2']['total']})"
          f" · blocks " + ", ".join(f"{k}:{v['status']}" for k, v in res["blocks"].items())
          + f" · LLM {len(m['tool_calls'])} calls, {m['tokens_input']}/{m['tokens_output']} tok, CHF {m['cost_chf']:.4f} · {m['duration_ms'] / 1000:.1f}s")
    print(f"→ {out / 'report.html'}")


if __name__ == "__main__":
    main()
