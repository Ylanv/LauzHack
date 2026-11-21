"""CLI: python -m src.report --input input.json --output out/   (see src/report/pipeline.py)

    python -m src.report --metrics out/        # print the token/cost metrics of a generated report
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from src.report import pipeline  # noqa: E402


def show_metrics(d: Path) -> int:
    m = json.loads((d / "metrics.json").read_text(encoding="utf-8"))
    llm, etl = m.get("llm") or {}, m.get("etl") or {}
    print(f"case {m.get('case_id')} · status {m['status']} · model {m.get('model_config')} · {m.get('duration_s')} s")
    print(f"LLM : {llm.get('api_calls')} call(s), in {llm.get('input_tokens')} / out {llm.get('output_tokens')} tokens "
          f"(reasoning {llm.get('reasoning_tokens') if llm.get('reasoning_tokens') is not None else 'included in output'}), "
          f"retries {llm.get('retries')}, USD {llm.get('usd_billed') if llm.get('usd_billed') is not None else llm.get('usd_estimated')} "
          f"({'billed' if llm.get('usd_billed') is not None else 'estimated from ' + m.get('pricing_source', '')})")
    if etl:
        print(f"ETL : {etl.get('vision_calls')} vision call(s), in {etl.get('tokens_input')} / out {etl.get('tokens_output')} tokens, "
              f"USD {etl.get('usd')} ({etl.get('usd_source')})")
    print(f"TOTAL USD {m.get('total_usd')}")
    if m.get("error"):
        print("ERROR", m["error"])
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=pipeline.__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--input", help="customer request, 2.0-llm-input document or evidence bundle (JSON)")
    ap.add_argument("--output", help="output directory")
    ap.add_argument("--model", help="config id in models/configs.json (default REPORT_MODEL or claude_opus55)")
    ap.add_argument("--max-usd", type=float, help="spending cap for this report (default REPORT_MAX_USD or 1.00)")
    ap.add_argument("--no-vision", action="store_true", help="ETL without vision calls")
    ap.add_argument("--assets", help="folder with an annotations.json sidecar for the images (synthetic cases)")
    ap.add_argument("--metrics", help="print metrics of an output directory and exit")
    a = ap.parse_args(argv)
    if a.metrics:
        return show_metrics(Path(a.metrics))
    if not (a.input and a.output):
        ap.error("--input and --output are required")
    doc = json.loads(Path(a.input).read_text(encoding="utf-8"))
    out = Path(a.output)
    m = pipeline.run(doc, out, a.model, a.max_usd, use_vision=not a.no_vision, assets=Path(a.assets) if a.assets else None)
    for s in m["stages"]:
        print(f"  {s['stage']:9s} {s['status']:8s} {s.get('detail') or s.get('error') or ''}")
    show_metrics(out)
    return {"succeeded": 0, "invalid_report": 1}.get(m["status"], 2)


if __name__ == "__main__":
    sys.exit(main())
