"""Runtime configuration, read from environment variables (.env locally, Vercel env in prod)."""

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    """Minimal .env loader for local dev (Vercel injects env vars itself)."""
    env = ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip())


_load_dotenv()

ON_VERCEL = bool(os.environ.get("VERCEL"))

# --- LLM provider (any OpenAI-compatible API: OpenRouter, Together, Nebius Token Factory) ---
LLM_BASE_URL = os.environ.get("LLM_BASE_URL", "https://openrouter.ai/api/v1")
LLM_API_KEY = os.environ.get("LLM_API_KEY", "")

MODELS = {
    "vision": os.environ.get("MODEL_VISION", ""),          # orthophoto + photos du site
    "extraction": os.environ.get("MODEL_EXTRACTION", ""),  # extraction industrielle (texte)
    "synthesis": os.environ.get("MODEL_SYNTHESIS", ""),    # 1 appel final
}

# Prix en CHF par million de tokens (input, output), hardcodés et approximatifs.
# Clé = nom du modèle tel que dans MODEL_*. À remplir par la team ; 0 si inconnu.
MODEL_PRICES_CHF_PER_MTOK: dict[str, tuple[float, float]] = {
    # "provider/model-name": (0.10, 0.40),
}

# --- Cache ---
# Prod (Vercel) : Upstash Redis via REST (Marketplace) si configuré.
# Sinon : fichiers dans .cache/ en local, /tmp sur Vercel (éphémère, best effort).
UPSTASH_REDIS_REST_URL = os.environ.get("UPSTASH_REDIS_REST_URL") or os.environ.get("KV_REST_API_URL", "")
UPSTASH_REDIS_REST_TOKEN = os.environ.get("UPSTASH_REDIS_REST_TOKEN") or os.environ.get("KV_REST_API_TOKEN", "")
CACHE_DIR = Path("/tmp/axa-cache") if ON_VERCEL else ROOT / ".cache"
CACHE_TTL_S = int(os.environ.get("CACHE_TTL_S", str(30 * 24 * 3600)))

# Mock : /api/report renvoie l'exemple, pour que le front avance sans brûler de tokens.
MOCK_MODE = os.environ.get("MOCK_MODE", "1") == "1"
