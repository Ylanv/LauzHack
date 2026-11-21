"""End-to-end report pipeline: input.json → ETL → features_combined.json → LLM → output.json.

    python -m src.report --input input.json --output out/            # full pipeline or pre-enriched input
    python -m src.report --input input.json --output out/ --no-vision  # ETL without the vision calls

Accepted inputs (auto-detected, see schemas/README.md):
  - customer request (schemas/INPUT)            → ETL (src.pipeline.run) → evidence bundle → LLM
  - ETL document 2.0-llm-input (schemas/FEATURE) → evidence bundle → LLM (no ETL requests)
  - evidence bundle (schemas/COMBINED_FEATURE)   → LLM

Writes into --output: etl_output.json (when the ETL ran or a 2.0 document was given, images not embedded),
images/, features_combined.json, output.json (only when valid; otherwise output.invalid.json), metrics.json.
Exit code 0 = valid report, 1 = report invalid, 2 = pipeline error.
"""
from __future__ import annotations

import base64
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path

from src.report import contracts, generate
from src.report.evidence import is_synthetic, to_bundle
from src.report.validate_report import summary, validate


class PipelineError(Exception):
    def __init__(self, stage: str, message: str):
        super().__init__(f"{stage}: {message}")
        self.stage, self.message = stage, message


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60] or "case"


def _write(path: Path, doc) -> None:
    path.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")


def _extract_images(v2: dict, images_dir: Path) -> list[str]:
    """Decode the embedded photos (data_url) to files; returns warnings for images that could not be written."""
    warns = []
    for name, img in (v2.get("images") or {}).items():
        m = re.match(r"data:[\w/+.-]+;base64,(.+)", img.get("data_url") or "", re.S)
        if not m:
            warns.append(f"image {name}: no embedded data — not available as visual evidence")
            continue
        try:
            images_dir.mkdir(parents=True, exist_ok=True)
            (images_dir / name).write_bytes(base64.b64decode(m.group(1), validate=True))
        except (ValueError, OSError) as ex:
            warns.append(f"image {name}: could not be decoded ({type(ex).__name__})")
    return warns


def run(doc: dict, out: Path, model: str | None = None, max_usd: float | None = None,
        use_vision: bool = True, assets: Path | None = None) -> dict:
    """Runs the pipeline and returns metrics (also written to out/metrics.json)."""
    out.mkdir(parents=True, exist_ok=True)
    model = model or generate.DEFAULT_MODEL
    t0 = time.perf_counter()
    stages: list[dict] = []
    met = {"schema_version": "1.0-report-metrics", "started_at": _now(), "model_config": model, "stages": stages,
           "status": "running", "pricing_source": generate.PRICING_SOURCE}

    def stage(name, status, t, **kw):
        stages.append({"stage": name, "status": status, "duration_ms": int((time.perf_counter() - t) * 1000), **kw})
        _write(out / "metrics.json", met)

    try:
        kind = contracts.detect(doc)
        met["input_kind"] = kind
        # ---- 1. ETL / input normalisation
        t = time.perf_counter()
        v2 = None
        if kind == "INPUT":
            errs = contracts.errors("INPUT", doc)
            if errs:
                raise PipelineError("input", "; ".join(errs[:5]))
            from src.pipeline import InputError, ServiceError, run as etl_run
            try:
                v2 = etl_run(doc["client_name"], doc["company_legal_name"], doc["building_address"],
                             doc.get("industry_type"), doc.get("website"), use_llm=use_vision)
            except InputError as ex:
                raise PipelineError("etl", f"input rejected: {ex}") from ex
            except ServiceError as ex:
                raise PipelineError("etl", f"public service unavailable, retry later: {ex}") from ex
            if doc.get("requested_coverages") is not None:
                v2["identification"]["requested_coverages"] = doc["requested_coverages"]
            case_id = doc.get("case_id") or _slug(doc["company_legal_name"])
            blocks = {k: (v or {}).get("status") for k, v in v2.get("evidence", {}).items()}
            failed = [k for k, s in blocks.items() if s not in (None, "ok")]
            m = v2.get("metrics", {})
            met["etl"] = {"vision_calls": len(m.get("tool_calls", [])), "tokens_input": m.get("tokens_input"),
                          "tokens_output": m.get("tokens_output"), "reasoning_tokens": m.get("reasoning_tokens"),
                          "usd": m.get("cost_usd"), "usd_source": m.get("cost_source"),
                          "external_calls": m.get("external_calls"), "duration_ms": m.get("duration_ms")}
            stage("etl", "warning" if failed else "ok", t, evidence_blocks=blocks,
                  detail=f"degraded sources: {', '.join(failed)}" if failed else "all evidence blocks ok")
        elif kind == "FEATURE_DOC":
            v2 = doc
            case_id = (doc.get("case_id") or _slug(doc["request"]["company_legal_name"]))
            stage("etl", "skipped", t, detail="pre-enriched 2.0-llm-input document given")
        elif kind == "COMBINED_FEATURE":
            case_id = doc["case"]["case_id"]
            stage("etl", "skipped", t, detail="evidence bundle given")
        else:
            raise PipelineError("input", f"a report OUTPUT cannot be used as pipeline input ({kind})")
        met["case_id"] = case_id

        # ---- 2. features_combined.json
        t = time.perf_counter()
        if v2 is not None:
            errs = contracts.errors("FEATURE_DOC", v2)
            if errs and not all("data_url" in e for e in errs):
                raise PipelineError("features", "ETL document invalid: " + "; ".join(errs[:5]))
            warns = _extract_images(v2, out / "images")
            if assets and (assets / "annotations.json").exists():
                (out / "images").mkdir(exist_ok=True)
                (out / "images" / "annotations.json").write_bytes((assets / "annotations.json").read_bytes())
            etl_doc = {**v2, "images": {n: {k: v for k, v in i.items() if k != "data_url"} for n, i in (v2.get("images") or {}).items()}}
            _write(out / "etl_output.json", etl_doc)
            try:
                bundle = to_bundle(v2, case_id, images_dir=out / "images", asset_root=out)
            except ValueError as ex:
                raise PipelineError("features", str(ex)) from ex
        else:
            bundle, warns = doc, []
            errs = contracts.errors("COMBINED_FEATURE", bundle)
            if errs:
                raise PipelineError("features", "; ".join(errs[:5]))
        _write(out / "features_combined.json", bundle)
        met["synthetic"] = is_synthetic(v2) if v2 is not None else any(
            (s.get("provider") or "").startswith("SYNTHETIC") for s in bundle.get("sources", []))
        stage("features", "warning" if warns else "ok", t, warnings=warns,
              detail=f"{len(bundle['facts'])} facts, {len(bundle['sources'])} sources, {len(bundle['visuals'])} visuals, "
                     f"{len(bundle['unknown_feature_ids'])} unknown")

        # ---- 3. LLM
        t = time.perf_counter()
        system = contracts.SYSTEM_PROMPT.read_text(encoding="utf-8")
        user = generate.user_message(case_id, contracts.schema("OUTPUT"), json.dumps(bundle, ensure_ascii=False, indent=2))
        cfg_price = generate.load_configs()[model]["price_usd_per_mtok"]
        spend = generate.Spend(cfg_price, generate.DEFAULT_MAX_USD if max_usd is None else max_usd)
        met["llm_estimate"] = generate.pre_call_estimate(system, user, model)
        met["pricing_usd_per_mtok"] = cfg_price
        calls = []
        report, raw, cm = generate.call(model, system, user, spend, "generate")
        calls.append(cm)
        issues = validate(report, bundle)
        if summary(issues)["errors"] and report is not None and not (cm["error"] or "").startswith("budget"):
            fixed, raw2, cm2 = generate.call(model, system, user + generate.repair_message(raw, [i for i in issues if i["severity"] == "error"]),
                                             spend, "reference_repair")
            calls.append(cm2)
            if fixed is not None:
                report, raw, issues = fixed, raw2, validate(fixed, bundle)
        met["llm_calls"] = calls
        met["llm"] = {k: sum((c.get(k) or 0) for c in calls) for k in
                      ("api_calls", "retries", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "latency_s")}
        rt = [c["reasoning_tokens"] for c in calls if c["reasoning_tokens"] is not None]
        met["llm"]["reasoning_tokens"] = sum(rt) if rt else None
        met["llm"]["usd_estimated"] = round(sum(c["usd_estimated"] for c in calls), 6)
        billed = [c["usd_billed"] for c in calls]
        met["llm"]["usd_billed"] = round(sum(billed), 6) if all(b is not None for b in billed) else None
        llm_err = next((c["error"] for c in calls if c["error"]), None)
        stage("llm", "failed" if report is None else "ok", t, detail=f"{model}: {len(calls)} generation(s)", error=llm_err)

        # ---- 4. validation + output
        t = time.perf_counter()
        s = summary(issues)
        met["validation"] = {**s, "issues": issues}
        if report is not None and s["valid"]:
            _write(out / "output.json", report)
            (out / "output.invalid.json").unlink(missing_ok=True)
            met["status"] = "succeeded"
        else:
            if report is not None:
                _write(out / "output.invalid.json", report)
            else:
                (out / "output.invalid.txt").write_text(raw or "", encoding="utf-8")
            (out / "output.json").unlink(missing_ok=True)
            met["status"] = "invalid_report"
        stage("validate", "ok" if s["valid"] else "failed", t, detail=f"{s['errors']} errors, {s['warnings']} warnings")
    except PipelineError as ex:
        met["status"], met["error"] = "failed", {"stage": ex.stage, "message": ex.message}
        stages.append({"stage": ex.stage, "status": "failed", "error": ex.message})
    etl_usd = (met.get("etl") or {}).get("usd") or 0.0
    llm = met.get("llm") or {}
    met["total_usd"] = round(etl_usd + (llm.get("usd_billed") if llm.get("usd_billed") is not None else llm.get("usd_estimated", 0.0)), 6)
    met["finished_at"] = _now()
    met["duration_s"] = round(time.perf_counter() - t0, 2)
    _write(out / "metrics.json", met)
    return met
