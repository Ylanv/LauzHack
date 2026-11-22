"""VLM benchmark (Together AI only): which small vision model extracts our image features best for the cost and time?

Same task as production (src/blocks.py): the production system prompt, prompts and strict JSON schemas from
src/prompts.py — aerial orthophoto (VISION_*) and street-level facade (FACADE_*) — on real images fetched by the ETL
(benchmark/vlm/images/<case>__<image>.jpg). Each answer is scored against benchmark/vlm/labels.json.

    python -m benchmark.vlm.run              # all models x all images x REPS
    python -m benchmark.vlm.run --summary    # table + chart + example page from results.jsonl
"""
from __future__ import annotations

import argparse
import json
import statistics as st
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))

from models.openai_compat import OpenAICompatAdapter  # noqa: E402
from src.prompts import FACADE_PROMPT, FACADE_SCHEMA, SYSTEM, VISION_PROMPT, VISION_SCHEMA  # noqa: E402

HERE = Path(__file__).resolve().parent
IMAGES, RESULTS = HERE / "images", HERE / "results.jsonl"
LABELS = json.loads((HERE / "labels.json").read_text(encoding="utf-8"))
REPS = 2
# Together AI serverless models that accept images (probed 2026-11-22 with an image request; price USD per 1M tokens
# in/out from GET /v1/models). Small/cheap models + one large reference. Most of them reason before answering.
MODELS = {
    "Tev1-4B (exp.)": ("together/Tev1-4B-experimental", 0.042, 0.0),
    "Nemotron-3.5-Super-VL": ("nvidia/NVIDIA-Nemotron-3.5-Super-VL", 0.15, 0.50),
    "GLM-5.3-Flash": ("zai-org/GLM-5.3-Flash", 0.15, 0.50),
    "MiniMax-M3.1-Flash": ("MiniMaxAI/MiniMax-M3.1-Flash", 0.15, 0.60),
    "Qwen3.5-9B": ("Qwen/Qwen3.5-9B", 0.17, 0.25),
    "DeepSeek-V4.1-Flash": ("deepseek-ai/DeepSeek-V4.1-Flash", 0.30, 1.20),
    "Inkling-2-Small": ("thinkingmachines/Inkling-2-Small", 0.30, 1.00),
    "Muse-Glimmer-30B": ("meta-models/Muse-Glimmer-30B", 0.35, 1.50),
    "Kimi-K3 (large ref.)": ("moonshotai/Kimi-K3", 3.00, 15.00),
}
TASKS = {"aerial": ("orthophoto.jpg", VISION_SCHEMA), "facade": ("facade_streetview.jpg", FACADE_SCHEMA)}
MAX_TOKENS = 4000   # reasoning models think before the JSON: production caps (700-900) truncate them


def prompt(task: str, case: str) -> str:
    c = LABELS["cases"][case]
    return VISION_PROMPT.format(m_per_px="0.15") if task == "aerial" else FACADE_PROMPT.format(company=c["company"], address=c["address"])


# ---------------------------------------------------------------- scoring against the reference labels
def presence(pred, truth):
    if truth == "present":
        return {"confirmed_present": 1, "possible": 0.5}.get(pred, 0)
    return {"confirmed_absent": 1, "unknown": 0.5, "possible": 0.25}.get(pred, 0)


def score(task: str, case: str, out: dict | None) -> tuple[float, dict]:
    ref = LABELS[task][case]
    if not isinstance(out, dict):
        return 0.0, {}
    s = {}
    for k, v in ref.items():
        if k.startswith("_"):
            continue
        if k == "roof_flat":
            s[k] = 1.0 if "flat" in str(out.get("roof_type") or "").lower() else 0.0
        elif k == "roof_equipment_any":
            s[k] = 1.0 if out.get("roof_equipment") else 0.0
        elif k == "construction_material":
            s[k] = float(v.get(out.get(k), 0))
        elif k == "facade_visible":
            s[k] = 1.0 if out.get(k) is v else 0.0
        elif k == "signage_matches_company":
            s[k] = 1.0 if out.get(k) == v else 0.0
        else:
            s[k] = float(presence(out.get(k), v))
    return round(sum(s.values()) / len(s), 3), s


# ---------------------------------------------------------------- run
def call(name: str, task: str, case: str, rep: int) -> dict:
    model, pin, pout = MODELS[name]
    fname, schema = TASKS[task]
    cfg = {"provider": "together", "model": model, "structured": "json_schema", "temperature": 0, "max_tokens": MAX_TOKENS,
           "max_tokens_cap": 8000, "price_usd_per_mtok": {"input": pin, "output": pout}}
    img = (IMAGES / f"{case}__{fname}").read_bytes()
    r = OpenAICompatAdapter(name, cfg).generate(SYSTEM, prompt(task, case), schema, images=[{"mime": "image/jpeg", "bytes": img}])
    if r.error and "response_format" in (r.error or "") or (r.error or "").startswith("api 400"):
        cfg["structured"] = "json_object"   # model without json_schema support: JSON mode + client-side validation
        r = OpenAICompatAdapter(name, cfg).generate(SYSTEM, prompt(task, case), schema, images=[{"mime": "image/jpeg", "bytes": img}])
    q, fields = score(task, case, r.parsed_json)
    return {"model": name, "model_id": model, "task": task, "case": case, "rep": rep, "structured_mode": cfg["structured"],
            "schema_valid": r.schema_valid, "schema_valid_first_try": r.schema_valid_first_try, "error": r.error,
            "latency_s": round(r.latency_ms / 1000, 2), "input_tokens": r.input_tokens, "output_tokens": r.output_tokens,
            "usd": round((r.input_tokens * pin + r.output_tokens * pout) / 1e6, 7), "quality": q, "fields": fields,
            "output": r.parsed_json}


def run(models: list[str]) -> None:
    done = {(d["model"], d["task"], d["case"], d["rep"]) for d in map(json.loads, RESULTS.read_text().splitlines())} if RESULTS.exists() else set()
    jobs = [(m, t, c, rep) for rep in range(REPS) for m in models for t in TASKS for c in LABELS[t] if (m, t, c, rep) not in done]

    def per_model(m):   # sequential per model: latency not distorted by self-concurrency
        for job in [j for j in jobs if j[0] == m]:
            rec = call(*job)
            with RESULTS.open("a") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            print(f"{m:22s} {job[1]:6s} {job[2]:15s} rep{job[3]} q={rec['quality']:.2f} {rec['latency_s']:5.1f}s ${rec['usd']:.5f} "
                  f"{'valid' if rec['schema_valid'] else 'INVALID'} {rec['error'] or ''}", flush=True)
    with ThreadPoolExecutor(max_workers=len(models)) as ex:
        list(ex.map(per_model, models))


def summary() -> list[dict]:
    recs = [json.loads(x) for x in RESULTS.read_text().splitlines()]
    rows = []
    for m in MODELS:
        rs = [r for r in recs if r["model"] == m]
        if not rs:
            continue
        rows.append({"model": m, "model_id": MODELS[m][0], "n": len(rs), "valid": sum(r["schema_valid"] for r in rs),
                     "quality": round(st.mean(r["quality"] for r in rs), 3),
                     "q_aerial": round(st.mean(r["quality"] for r in rs if r["task"] == "aerial"), 3),
                     "q_facade": round(st.mean(r["quality"] for r in rs if r["task"] == "facade"), 3),
                     "latency_s": round(st.mean(r["latency_s"] for r in rs), 2),
                     "p90_s": round(sorted(r["latency_s"] for r in rs)[int(0.9 * (len(rs) - 1))], 2),
                     "usd_per_image": round(st.mean(r["usd"] for r in rs), 6),
                     "usd_per_building": round(2 * st.mean(r["usd"] for r in rs), 6),
                     "in_tok": int(st.mean(r["input_tokens"] for r in rs)), "out_tok": int(st.mean(r["output_tokens"] for r in rs)),
                     "errors": sorted({(r["error"] or "")[:80] for r in rs if r["error"]})})
    (HERE / "summary.json").write_text(json.dumps(rows, indent=2), encoding="utf-8")
    for r in sorted(rows, key=lambda r: -r["quality"]):
        print(f"{r['model']:22s} quality {r['quality']:.2f} (aerial {r['q_aerial']:.2f} / facade {r['q_facade']:.2f})  "
              f"{r['latency_s']:5.1f}s  ${r['usd_per_building']:.5f}/building  valid {r['valid']}/{r['n']}  {r['errors'][:1]}")
    return rows


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", help="comma-separated subset of " + ",".join(MODELS))
    ap.add_argument("--summary", action="store_true")
    a = ap.parse_args()
    if not a.summary:
        run([m.strip() for m in a.models.split(",")] if a.models else list(MODELS))
    summary()
