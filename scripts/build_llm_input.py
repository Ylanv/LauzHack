"""Everything up to the final-report LLM: 3 inputs → public data (+ SITG in GE) + orthophoto + website scraping
→ vision (Gemini via OpenRouter) on the orthophoto and website photos → 25 features. --no-vision = 0 token.

    python scripts/build_llm_input.py "Marie Dupont" "RHODIOR SA" "Chemin du Pont-du-Centenaire 109, 1228 Plan-les-Ouates"

Writes probe_out/<slug>/llm_input.json + the images it references (orthophoto.jpg, website_1.jpg…).
This JSON (with Gemini's vision results inside) is the hand-off to the final-report LLM.
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
    ap.add_argument("--no-vision", action="store_true", help="skip Gemini (0 token)")
    ap.add_argument("--out", default="probe_out")
    a = ap.parse_args()
    sys.stdout.reconfigure(encoding="utf-8")
    try:
        res = run(a.client_name, a.company, a.address, a.industry, a.website, use_llm=not a.no_vision, final_report=False)
    except (InputError, ServiceError) as e:
        print(f"ERROR: {e}")
        sys.exit(1)
    out = Path(a.out) / re.sub(r"[^a-z0-9]+", "-", a.company.lower()).strip("-")
    out.mkdir(parents=True, exist_ok=True)
    (out / "llm_input.json").write_text(json.dumps(res["llm_input"], ensure_ascii=False, indent=2), encoding="utf-8")
    for name, jpeg in res["images"].items():
        (out / name).write_bytes(jpeg)
    li = res["llm_input"]
    c = li["feature_coverage_before_llm"]
    print(f"{a.company}: features before LLM {c['all']['filled']}/{c['all']['total']} (P0 {c['P0']['filled']}/{c['P0']['total']}, "
          f"P1 {c['P1']['filled']}/{c['P1']['total']}, P2 {c['P2']['filled']}/{c['P2']['total']}) · images: {', '.join(res['images']) or 'none'}"
          f" · vision: {li['evidence']['aerial_image']['status']} · website: {li['evidence']['website']['status']}"
          f" · {li['metrics']['duration_ms'] / 1000:.1f}s · {len(li['metrics']['tool_calls'])} Gemini call(s),"
          f" {li['metrics']['tokens_input']}/{li['metrics']['tokens_output']} tok, CHF {li['metrics']['cost_chf']:.4f}")
    print(f"→ {out / 'llm_input.json'}")


if __name__ == "__main__":
    main()
