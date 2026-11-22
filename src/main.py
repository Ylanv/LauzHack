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

from fastapi import FastAPI, HTTPException, Query, Response  # noqa: E402
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
        "cache": "upstash" if config.UPSTASH_REDIS_REST_URL else "file",
    }


@app.get("/api/footprint")
def footprint_for_map(address: str = Query(..., min_length=5, max_length=200)) -> dict:
    """Official footprint (WGS84 GeoJSON) of the building at this address, for the map animation. Public data only,
    no LLM and no credits. 404 when the building cannot be pinned down (the map keeps its fallback)."""
    from src.footprint_api import building_footprint
    fp = building_footprint(address.strip())
    if not fp:
        raise HTTPException(404, "No official footprint for this address.")
    return fp


@app.get("/api/industries")
def industries() -> list[dict]:
    return [{"key": k, "label": v[0]} for k, v in INDUSTRIES.items()]


@app.post("/api/llm-input")
def create_llm_input(req: LlmInputRequest, for_llm: bool = False) -> dict:
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
            _store_job(job_id, out)
        except Exception:
            logging.getLogger(__name__).exception("Report job %s failed", job_id)
            (out / "metrics.json").write_text(
                _json.dumps({"status": "failed", "stages": [], "error": {"message": "Report generation failed."}}),
                encoding="utf-8",
            )

    return job_id, out, threading.Thread(target=run_job, daemon=True)


@app.post("/api/reports", status_code=202)
def start_report(req: LlmInputRequest) -> dict:
    """Background job + polling (GET /api/reports/{id}). Long-running servers only: on Vercel the thread is suspended
    once this response is sent — use POST /api/reports/stream there."""
    job_id, _, thread = _new_job(req)
    thread.start()
    return {"job_id": job_id}


STREAM_MAX_S = 280  # under Vercel's 300 s function limit (Hobby, Fluid compute)


@app.post("/api/reports/stream")
def stream_report(req: LlmInputRequest) -> StreamingResponse:
    """Runs the report pipeline while the request stays open and streams its progress as NDJSON: one line per change,
    same shape as GET /api/reports/{id} ({job_id, status, stage, done_stages, error}), plus {"heartbeat": true}
    lines every 10 s. The last line has a final status (succeeded | invalid_report | failed). Works on Vercel because the
    function stays alive as long as the response is streaming."""
    job_id, out, thread = _new_job(req)
    thread.start()

    def events():
        last, t0, beat, imgs = None, _time.monotonic(), _time.monotonic(), False
        while True:
            p = _progress(job_id, out)
            if not imgs and "features" in p["done_stages"]:   # photos exist now: the map fetches them while the LLM still runs
                imgs = True
                _store_job(job_id, out, only_images=True)
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
    if path.is_file():
        return FileResponse(path, media_type="image/jpeg")
    if BLOB:  # Vercel: the job ran on another instance (its /tmp is not ours) → the photos were put in the Blob store
        from vercel.blob import sync as blob
        try:
            data = blob.get_blob(f"reports/{job_id}/images/{name}", access="private").body
        except blob.BlobNotFoundError:
            raise HTTPException(404) from None
        return Response(data, media_type="image/jpeg", headers={"Cache-Control": "private, max-age=3600"})
    raise HTTPException(404)


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

# ---------------------------------------------------------------- report storage (underwriter dashboard)
# Vercel Blob (private store) when BLOB_STORE_ID / BLOB_READ_WRITE_TOKEN is set — needed on Vercel, where REPORTS_DIR
# is a per-instance /tmp. Otherwise the local REPORTS_DIR folder. Same layout: reports/<job_id>/<file>.
# Hobby quota: 1 GB, 2,000 uploads/listings and 10,000 reads per month → listings are cached 60 s per instance and
# files (immutable once a job is finished) are cached in memory and in the browser.
BLOB = bool(_os.environ.get("BLOB_STORE_ID") or _os.environ.get("BLOB_READ_WRITE_TOKEN"))
CASE_FILES = {"output.json", "features_combined.json", "metrics.json", "validation.json", "output.invalid.json"}
_TYPES = {".json": "application/json", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png"}
_CASES_CACHE: dict = {"t": None, "ids": []}   # t = time.monotonic() of the last listing; None = never listed
_FILE_CACHE: dict[str, bytes] = {}


def _store_job(job_id: str, out: Path, only_images: bool = False) -> None:
    """Uploads a finished job's files (report, evidence, metrics, images) to the private Blob store. Never fails the job.
    only_images: just the photos, as soon as they are written (the web app shows them before the report is done)."""
    if not BLOB:
        return
    from vercel.blob import sync as blob
    for p in sorted(out.rglob("*")):
        rel = p.relative_to(out).as_posix()
        if p.is_file() and (rel.startswith("images/") if only_images else (rel in CASE_FILES or rel.startswith("images/"))):
            try:
                blob.put_blob(f"reports/{job_id}/{rel}", p.read_bytes(), access="private", allow_overwrite=True,
                              content_type=_TYPES.get(p.suffix.lower(), "application/octet-stream"))
            except Exception:  # noqa: BLE001
                logging.getLogger(__name__).exception("Blob upload failed for %s/%s", job_id, rel)
    if not only_images:
        _CASES_CACHE["t"] = None


@app.get("/api/cases")
def list_cases() -> list[str]:
    """Report folders available to the underwriter dashboard (newest first)."""
    # monotonic() counts from the machine's boot: on a fresh Vercel instance it is only a few seconds, so a 0.0
    # sentinel would skip the first listing and return [] for the instance's first minute — use None instead.
    if _CASES_CACHE["t"] is None or _time.monotonic() - _CASES_CACHE["t"] > 60:
        if BLOB:
            from vercel.blob import sync as blob
            ids = [e.prefix.rstrip("/").split("/")[-1] for e in blob.query_blob_entries(prefix="reports/")
                   if isinstance(e, blob.BlobPrefix)]
        else:
            ids = [d.name for d in REPORTS_DIR.iterdir() if d.is_dir()] if REPORTS_DIR.exists() else []
        _CASES_CACHE.update(t=_time.monotonic(), ids=sorted(ids, key=lambda i: i.split("-")[-3:-1], reverse=True))
    return _CASES_CACHE["ids"]


@app.get("/api/cases/{case_id}/files/{path:path}")
def case_file(case_id: str, path: str) -> Response:
    """One file of a case (output.json, features_combined.json, metrics.json, validation.json, images/…)."""
    if not _re.fullmatch(r"[a-z0-9-]{3,80}", case_id) or not (path in CASE_FILES or _re.fullmatch(r"images/[\w.-]+", path)):
        raise HTTPException(404)
    key = f"reports/{case_id}/{path}"
    data = _FILE_CACHE.get(key)
    if data is None:
        if BLOB:
            from vercel.blob import sync as blob
            try:
                data = blob.get_blob(key, access="private").body
            except blob.BlobNotFoundError:
                raise HTTPException(404) from None
        else:
            f = REPORTS_DIR / case_id / path
            if not f.is_file():
                raise HTTPException(404)
            data = f.read_bytes()
        if len(_FILE_CACHE) < 500:
            _FILE_CACHE[key] = data
    return Response(data, media_type=_TYPES.get(Path(path).suffix.lower(), "application/octet-stream"),
                    headers={"Cache-Control": "private, max-age=3600"})


if __name__ == "__main__":
    print("Run with: uvicorn src.main:app --reload")
