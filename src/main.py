"""FastAPI app — deployed on Vercel as a single Python function.

Local:  uvicorn src.main:app --reload
Vercel: zero-config FastAPI detection (exports `app`).
"""

import json
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

# Make `src.*` imports work whatever the working directory (local or Vercel).
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI, HTTPException  # noqa: E402
from pydantic import BaseModel  # noqa: E402

from src import config  # noqa: E402
from src.validate_report import validate  # noqa: E402

app = FastAPI(title="AXA Smart Property")

EXAMPLE = config.ROOT / "schemas" / "report.example.json"


class ReportRequest(BaseModel):
    client_name: str
    company_legal_name: str
    address: str


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "on_vercel": config.ON_VERCEL,
        "mock_mode": config.MOCK_MODE,
        "llm_configured": bool(config.LLM_API_KEY),
        "models": {role: bool(m) for role, m in config.MODELS.items()},
        "cache": "upstash" if config.UPSTASH_REDIS_REST_URL else "file",
    }


@app.post("/api/report")
def create_report(req: ReportRequest) -> dict:
    if not config.MOCK_MODE:
        # TODO: brancher la pipeline (resolve → tools en parallèle → assembler → synthesize).
        raise HTTPException(501, "Pipeline not implemented yet — set MOCK_MODE=1")

    report = json.loads(EXAMPLE.read_text(encoding="utf-8"))
    report["report_id"] = str(uuid.uuid4())
    report["generated_at"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    report["request"] = req.model_dump()

    errors = validate(report)
    if errors:
        raise HTTPException(500, {"validation_errors": errors})
    return report


if __name__ == "__main__":
    print("Run with: uvicorn src.main:app --reload")
