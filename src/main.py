"""FastAPI app — deployed on Vercel as a single Python function.

Local:  uvicorn src.main:app --reload
Vercel: zero-config FastAPI detection (exports `app`).

Scope: companies with their own activity building in the canton of Geneva.
Inputs: client_name, company_legal_name (exact, Zefix), address (Geneva), industry_type (drop-down).

GET  /                                → simple frontend (form + result)
POST /api/llm-input                    → llm_input.json (photos embedded as base64, for the report)
POST /api/llm-input?for_llm=true       → same JSON without the photos (what the final-report LLM receives)
POST /api/reports                      → starts the full report pipeline (ETL → LLM → validated report) → {job_id}
GET  /api/reports/{job_id}             → progress of that job: status + current stage (never the report itself)
GET  /api/industries                   → drop-down values for industry_type
GET  /api/health                       → configuration check
"""

import logging
import sys
from pathlib import Path
from typing import Literal
from uuid import uuid4

# Make `src.*` imports work whatever the working directory (local or Vercel).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI, Header, HTTPException  # noqa: E402
from fastapi.responses import FileResponse, HTMLResponse, StreamingResponse  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from src import config  # noqa: E402
from src.industries import INDUSTRIES  # noqa: E402

app = FastAPI(title="AXA Smart Property")


class LlmInputRequest(BaseModel):
    client_name: str = Field(..., min_length=1, description="Contact person / client name", examples=["Marie Dupont"])
    company_legal_name: str = Field(..., description="Exact registered company name (Zefix)", examples=["CMDS SA"])
    address: str = Field(..., description="Building address in Geneva: 'Street N, NPA Town'",
                         examples=["Rue du Champ-Blanchod 7, 1228 Plan-les-Ouates"])
    industry_type: Literal[tuple(INDUSTRIES)] = Field(..., description="Declared by the client (see GET /api/industries)")
    website: str | None = Field(None, description="Optional technical hint (not in the client form)")


FRONTEND = config.ROOT / "frontend" / "index.html"


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
def frontend() -> str:
    return FRONTEND.read_text(encoding="utf-8")


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "on_vercel": config.ON_VERCEL,
        "llm_configured": bool(config.LLM_API_KEY),
        "models": {role: m or None for role, m in config.MODELS.items()},
        "streetview_configured": bool(config.GOOGLE_MAPS_API_KEY),
        "access_code_required": True,
        "cache": "upstash" if config.UPSTASH_REDIS_REST_URL else "file",
    }


@app.get("/api/industries")
def industries() -> list[dict]:
    return [{"key": k, "label": v[0]} for k, v in INDUSTRIES.items()]


def require_access_code(value: str | None) -> None:
    if not config.ACCESS_CODE:
        raise HTTPException(503, "The assessment service needs an access code configured.")
    if value != config.ACCESS_CODE:
        raise HTTPException(401, "Invalid or missing access code (X-Access-Code header).")


@app.post("/api/llm-input")
def create_llm_input(req: LlmInputRequest, for_llm: bool = False,
                     x_access_code: str | None = Header(None)) -> dict:
    # The API spends OpenRouter + Google credits: on a public URL, require the team's access code.
    require_access_code(x_access_code)
    from src.pipeline import InputError, ServiceError, for_llm_text, run
    try:
        doc = run(req.client_name, req.company_legal_name, req.address, req.industry_type, req.website)
    except InputError as e:  # not found / ambiguous / out of scope → user error
        raise HTTPException(422, str(e)) from e
    except ServiceError as e:  # public data service down / timeout → retry
        raise HTTPException(503, f"A public data service did not respond, please retry ({e})") from e
    return for_llm_text(doc) if for_llm else doc


# ---- Full report pipeline, run in the background so the client web app can follow its progress -------------------
# Each job writes its folder under REPORTS_DIR (default <repo>/reports, /tmp on Vercel): output.json, features_combined.json,
# metrics.json... read by the underwriter dashboard (webapp/dashboard.html). The client only gets status + stage.
# Note: a background thread does not outlive a serverless request; this is meant for a long-running server (local/VM).
import re as _re  # noqa: E402
import threading  # noqa: E402
import time as _time  # noqa: E402
import json as _json  # noqa: E402
import os as _os  # noqa: E402

REPORTS_DIR = Path(_os.environ.get("REPORTS_DIR") or ("/tmp/reports" if config.ON_VERCEL else config.ROOT / "reports"))
_JOBS: dict[str, Path] = {}


def _new_job(req: "LlmInputRequest") -> tuple[str, Path, threading.Thread]:
    """Creates the job folder and returns (job_id, folder, thread that runs the report pipeline — not started)."""
    from src.report import pipeline as report_pipeline
    slug = _re.sub(r"[^a-z0-9]+", "-", req.company_legal_name.lower()).strip("-")[:35] or "case"
    job_id = f"{slug}-{_time.strftime('%Y%m%d-%H%M%S')}-{uuid4().hex[:12]}"
    out = REPORTS_DIR / job_id
    out.mkdir(parents=True)
    (out / "metrics.json").write_text(_json.dumps({"status": "running", "stages": []}), encoding="utf-8")
    doc = {"schema_version": "1.0-customer-request", "case_id": job_id, "client_name": req.client_name,
           "company_legal_name": req.company_legal_name, "building_address": req.address,
           "industry_type": req.industry_type, "website": req.website}
    _JOBS[job_id] = out
    def run_job() -> None:
        try:
            report_pipeline.run(doc, out)
        except Exception:
            logging.getLogger(__name__).exception("Report job %s failed", job_id)
            (out / "metrics.json").write_text(
                _json.dumps({"status": "failed", "stages": [], "error": {"message": "Report generation failed."}}),
                encoding="utf-8",
            )

    return job_id, out, threading.Thread(target=run_job, daemon=True)


@app.post("/api/reports", status_code=202)
def start_report(req: LlmInputRequest, x_access_code: str | None = Header(None)) -> dict:
    """Background job + polling (GET /api/reports/{id}). Long-running servers only: on Vercel the thread is suspended
    once this response is sent — use POST /api/reports/stream there."""
    require_access_code(x_access_code)
    job_id, _, thread = _new_job(req)
    thread.start()
    return {"job_id": job_id}


STREAM_MAX_S = 280  # under Vercel's 300 s function limit (Hobby, Fluid compute)


@app.post("/api/reports/stream")
def stream_report(req: LlmInputRequest, x_access_code: str | None = Header(None)) -> StreamingResponse:
    """Runs the report pipeline while the request stays open and streams its progress as NDJSON: one line per change,
    same shape as GET /api/reports/{id} ({job_id, status, stage, done_stages, error}), plus {"heartbeat": true}
    lines every 10 s. The last line has a final status (succeeded | invalid_report | failed). Works on Vercel because the
    function stays alive as long as the response is streaming."""
    require_access_code(x_access_code)
    job_id, out, thread = _new_job(req)
    thread.start()

    def events():
        last, t0, beat = None, _time.monotonic(), _time.monotonic()
        while True:
            p = _progress(job_id, out)
            if p != last:
                yield _json.dumps(p) + "\n"
                last, beat = p, _time.monotonic()
            if p["status"] != "running" and not thread.is_alive():
                return
            if _time.monotonic() - t0 > STREAM_MAX_S:
                yield _json.dumps({**p, "status": "failed", "stage": None,
                                   "error": {"stage": p.get("stage"), "message": "Report generation timed out."}}) + "\n"
                return
            if _time.monotonic() - beat > 10:
                yield '{"heartbeat": true}\n'
                beat = _time.monotonic()
            _time.sleep(0.5)

    return StreamingResponse(events(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/reports/{job_id}/photos/{name}")
def building_photo(job_id: str, name: Literal["orthophoto.jpg", "facade_streetview.jpg"]) -> FileResponse:
    if not _re.fullmatch(r"[a-z0-9-]{3,80}", job_id):
        raise HTTPException(404)
    path = REPORTS_DIR / job_id / "images" / name
    if not path.is_file():
        raise HTTPException(404)
    return FileResponse(path, media_type="image/jpeg")


@app.get("/api/reports/{job_id}")
def report_status(job_id: str) -> dict:
    out = _JOBS.get(job_id) or (REPORTS_DIR / job_id if _re.fullmatch(r"[a-z0-9-]{3,80}", job_id) else None)
    if not out or not (out / "metrics.json").exists():
        raise HTTPException(404, "Unknown report job.")
    return _progress(job_id, out)


def _progress(job_id: str, out: Path) -> dict:
    """Status of a job from its metrics.json: {job_id, status, stage running now, done_stages, error}."""
    try:
        m = _json.loads((out / "metrics.json").read_text(encoding="utf-8"))
    except ValueError:  # being written
        return {"job_id": job_id, "status": "running", "stage": None, "done_stages": []}
    done = [s["stage"] for s in m.get("stages", []) if s.get("status") != "failed"]
    nxt = {None: "etl", "etl": "features", "features": "llm", "llm": "validate"}
    stage = None if m.get("status") != "running" else nxt.get(done[-1] if done else None, "validate")
    err = m.get("error") or {}
    return {"job_id": job_id, "status": m.get("status", "running"), "stage": stage, "done_stages": done,
            "error": {"stage": err.get("stage"), "message": err.get("message")} if err else None}

if __name__ == "__main__":
    print("Run with: uvicorn src.main:app --reload")
