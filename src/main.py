"""FastAPI app — deployed on Vercel as a single Python function.

Local:  uvicorn src.main:app --reload
Vercel: zero-config FastAPI detection (exports `app`).

Scope: companies with their own activity building in the canton of Geneva.
Inputs: client_name, company_legal_name (exact, Zefix), address (Geneva), industry_type (drop-down).

GET  /                                → simple frontend (form + result)
POST /api/llm-input                    → llm_input.json (photos embedded as base64, for the report)
POST /api/llm-input?for_llm=true       → same JSON without the photos (what the final-report LLM receives)
GET  /api/industries                   → drop-down values for industry_type
GET  /api/health                       → configuration check
"""

import sys
from pathlib import Path
from typing import Literal

# Make `src.*` imports work whatever the working directory (local or Vercel).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI, Header, HTTPException  # noqa: E402
from fastapi.responses import HTMLResponse  # noqa: E402
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
        "access_code_required": bool(config.ACCESS_CODE),
        "cache": "upstash" if config.UPSTASH_REDIS_REST_URL else "file",
    }


@app.get("/api/industries")
def industries() -> list[dict]:
    return [{"key": k, "label": v[0]} for k, v in INDUSTRIES.items()]


@app.post("/api/llm-input")
def create_llm_input(req: LlmInputRequest, for_llm: bool = False,
                     x_access_code: str | None = Header(None)) -> dict:
    # The API spends OpenRouter + Google credits: on a public URL, require the team's access code.
    if config.ACCESS_CODE and x_access_code != config.ACCESS_CODE:
        raise HTTPException(401, "Invalid or missing access code (X-Access-Code header).")
    from src.pipeline import InputError, ServiceError, for_llm_text, run
    try:
        doc = run(req.client_name, req.company_legal_name, req.address, req.industry_type, req.website)
    except InputError as e:  # not found / ambiguous / out of scope → user error
        raise HTTPException(422, str(e)) from e
    except ServiceError as e:  # public data service down / timeout → retry
        raise HTTPException(503, f"A public data service did not respond, please retry ({e})") from e
    return for_llm_text(doc) if for_llm else doc


if __name__ == "__main__":
    print("Run with: uvicorn src.main:app --reload")
