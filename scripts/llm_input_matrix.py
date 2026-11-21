"""Build llm_input.json (pre-final-LLM: public data + SITG + vision) for a list of companies and print feature coverage.

    python scripts/llm_input_matrix.py probe_out/ge_industrial_cases.json
"""
import json
import re
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from src.features import CATALOG  # noqa: E402
from src.pipeline import InputError, ServiceError, run  # noqa: E402


def one(c):
    try:
        r = run("Test Client", c["company"], c["address"], c.get("industry", "other"), c.get("website"), final_report=False)
    except (InputError, ServiceError) as e:
        return {"company": c["company"], "error": str(e)}
    except Exception as e:  # noqa: BLE001
        return {"company": c["company"], "error": f"{type(e).__name__}: {e}"[:200]}
    out = Path("probe_out") / re.sub(r"[^a-z0-9]+", "-", c["company"].lower()).strip("-")
    out.mkdir(parents=True, exist_ok=True)
    (out / "llm_input.json").write_text(json.dumps(r["llm_input"], ensure_ascii=False, indent=2), encoding="utf-8")
    for n, j in r["images"].items():
        (out / n).write_bytes(j)
    li = r["llm_input"]
    return {"company": c["company"], "features": {f["feature"]: f for f in li["features"]}, "m": li["metrics"]}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    cases = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    with ThreadPoolExecutor(4) as ex:
        res = list(ex.map(one, cases))
    ok = [r for r in res if "features" in r]
    for r in res:
        print(("ERROR " + r["error"]) if "error" in r else
              f"{r['company'][:40]:<40} {r['m']['duration_ms'] / 1000:.0f}s  CHF {r['m']['cost_chf']:.4f}", "" if "error" not in r else r["company"])
    tot = {}
    print(f"\n{'feature':<28} prio found/{len(ok)}")
    for k, (g, rel, comps, prio) in CATALOG.items():
        st = Counter(r["features"][k]["status"] for r in ok)
        found = len(ok) - st.get("unknown", 0)
        t = tot.setdefault(prio, [0, 0]); t[0] += found; t[1] += len(ok)
        print(f"{k:<28} {prio}  {found:>2}/{len(ok)}  {dict(st)}")
    print({p: f"{a}/{b} = {round(100 * a / b)}%" for p, (a, b) in tot.items()})


if __name__ == "__main__":
    main()
