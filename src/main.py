"""FastAPI app — deployed on Vercel as a single Python function.

Local:  uvicorn src.main:app --reload
Vercel: zero-config FastAPI detection (exports `app`).

Scope: companies with their own activity building in the canton of Geneva.
Inputs: client_name, company_legal_name (exact, Zefix), address (Geneva), industry_type (drop-down).

POST /api/llm-input    → the pre-LLM JSON (identification, 19 features, evidence, sources) + images (base64)
POST /api/report       → full report (adds the final-report LLM call)
POST /api/report.html  → the rendered HTML report with photos
GET  /api/industries   → drop-down values for industry_type
"""

import sys
from pathlib import Path
from typing import Literal

# Make `src.*` imports work whatever the working directory (local or Vercel).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.responses import HTMLResponse  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from src import config  # noqa: E402
from src.industries import INDUSTRIES  # noqa: E402

app = FastAPI(title="AXA Smart Property")


class ReportRequest(BaseModel):
    client_name: str = Field(..., min_length=1, description="Contact person / client name", examples=["Marie Dupont"])
    company_legal_name: str = Field(..., description="Exact registered company name (Zefix)", examples=["CMDS SA"])
    address: str = Field(..., description="Building address in Geneva: 'Street N, NPA Town'",
                         examples=["Rue du Champ-Blanchod 7, 1228 Plan-les-Ouates"])
    industry_type: Literal[tuple(INDUSTRIES)] = Field(..., description="Declared by the client (see GET /api/industries)")
    website: str | None = Field(None, description="Optional technical hint (not in the client form)")


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


@app.get("/api/industries")
def industries() -> list[dict]:
    return [{"key": k, "label": v[0]} for k, v in INDUSTRIES.items()]


def _run(req: ReportRequest, **kw) -> dict:
    from src.pipeline import InputError, ServiceError, run
    try:
        return run(req.client_name, req.company_legal_name, req.address, req.industry_type, req.website, **kw)
    except InputError as e:  # not found / ambiguous / out of scope → user error, no report
        raise HTTPException(422, str(e)) from e
    except ServiceError as e:  # public data service down / timeout → retry
        raise HTTPException(503, f"A public data service did not respond, please retry ({e})") from e


@app.post("/api/llm-input")
def create_llm_input(req: ReportRequest) -> dict:
    """Everything up to the final LLM (vision included). Photos are embedded in llm_input.images[*].data_url."""
    return _run(req, final_report=False)["llm_input"]


@app.post("/api/report")
def create_report(req: ReportRequest) -> dict:
    res = _run(req)
    return {k: v for k, v in res.items() if k != "html"}


@app.post("/api/report.html", response_class=HTMLResponse)
def create_report_html(req: ReportRequest) -> str:
    return _run(req)["html"]


if __name__ == "__main__":
    print("Run with: uvicorn src.main:app --reload")
