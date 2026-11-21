"""Shared adapter plumbing: result type, env loading, JSON extraction, schema helpers.

Key values are read from the environment / .env and never printed or logged.
"""
from __future__ import annotations

import copy
import json
import os
import re
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Callable

from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parent.parent
CONFIGS_PATH = ROOT / "models" / "configs.json"
CATALOG_PATH = ROOT / "models" / "catalog.json"


def load_dotenv() -> None:
    """Same minimal loader as src/config.py (kept local so models/ does not import the pre-LLM pipeline)."""
    env = ROOT / ".env"
    if not env.exists():
        return
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_dotenv()


@dataclass
class GenResult:
    text: str = ""
    parsed_json: dict | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    latency_ms: int = 0
    retries: int = 0              # extra HTTP attempts (transient errors + repair + truncation)
    repair_attempts: int = 0      # subset of retries caused by invalid JSON / schema
    error: str | None = None
    schema_valid: bool = False
    schema_valid_first_try: bool | None = None   # validity of the first complete (non-truncated) answer
    truncation_retries: int = 0
    validation_errors: list[str] = field(default_factory=list)
    finish_reason: str | None = None
    structured_mode: str | None = None   # tool/output_config/json_schema/json_object/none
    model_reported: str | None = None
    provider_cost_usd: float | None = None   # cost reported by the provider (OpenRouter usage accounting)
    reasoning_tokens: int | None = None      # reported reasoning tokens, a SUBSET of output_tokens (None = not reported separately)
    attempts: list[dict] = field(default_factory=list)  # per-HTTP-attempt tokens/latency/error

    def to_dict(self) -> dict:
        return asdict(self)


class BudgetExceeded(RuntimeError):
    pass


# guard(est_input_tokens, est_output_tokens) -> None, raises BudgetExceeded
Guard = Callable[[int, int], None]


# ---------- schema helpers ----------

# Keywords that strict structured-output engines (Anthropic output_config, OpenAI strict) reject.
# We strip them for the provider-side constraint and still validate the FULL schema client-side.
_UNSUPPORTED = {"maxLength", "minLength", "maxItems", "minItems", "minimum", "maximum",
                "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "pattern", "format",
                "uniqueItems", "$schema", "title", "description"}


def strip_for_strict(schema: dict) -> dict:
    def walk(node):
        if isinstance(node, dict):
            out = {}
            for k, v in node.items():
                if k in _UNSUPPORTED and not (k in ("title", "description") and isinstance(v, dict)):
                    continue
                if k == "properties" and isinstance(v, dict):
                    out[k] = {pk: walk(pv) for pk, pv in v.items()}
                else:
                    out[k] = walk(v)
            return out
        if isinstance(node, list):
            return [walk(x) for x in node]
        return node
    return walk(copy.deepcopy(schema))


def _err_msg(e) -> str:
    path = "/".join(map(str, e.absolute_path)) or "<root>"
    if e.validator == "maxLength":
        return f"{path}: string has {len(e.instance)} characters, maxLength is {e.validator_value} - rewrite it to at most {int(e.validator_value * 0.85)} characters"
    if e.validator == "maxItems":
        return f"{path}: array has {len(e.instance)} items, maxItems is {e.validator_value}"
    if e.validator == "enum":
        return f"{path}: {str(e.instance)[:60]!r} is not one of {e.validator_value}"
    if e.validator == "additionalProperties":
        return f"{path}: {e.message[:200]}"
    return f"{path}: {e.message[:250]}"


def validate(schema: dict, data) -> list[str]:
    v = Draft202012Validator(schema)
    return [_err_msg(e) for e in sorted(v.iter_errors(data), key=lambda e: list(map(str, e.absolute_path)))]


_THINK = re.compile(r"<think>.*?</think>", re.S)
_FENCE = re.compile(r"```(?:json)?\s*(.*?)```", re.S)


def extract_json(text: str):
    """Parse a JSON object from model text (tolerates <think> blocks and ``` fences)."""
    t = _THINK.sub("", text or "").strip()
    try:
        return json.loads(t)
    except json.JSONDecodeError:
        pass
    m = _FENCE.search(t)
    if m:
        try:
            return json.loads(m.group(1))
        except json.JSONDecodeError:
            pass
    i, j = t.find("{"), t.rfind("}")
    if i != -1 and j > i:
        return json.loads(t[i:j + 1])  # raises JSONDecodeError if still broken
    raise json.JSONDecodeError("no JSON object found", t, 0)


def estimate_tokens(text: str) -> int:
    """Cheap pre-call estimate (conservative). Real counts come from usage."""
    return int(len(text) / 2.5) + 50  # measured: 2.55 chars/token (Claude 4.7+ tokenizer, count_tokens)


def repair_message(errors: list[str]) -> str:
    return ("Your previous answer did not conform to the required JSON schema. Errors:\n- "
            + "\n- ".join(errors[:25])
            + "\nReturn the complete corrected JSON object only, no prose.")


def now_ms() -> float:
    return time.perf_counter() * 1000


# ---------- config / adapter factory ----------

def load_configs() -> dict:
    return json.loads(CONFIGS_PATH.read_text(encoding="utf-8"))["configs"]


def get_adapter(config_name: str):
    cfg = load_configs()[config_name]
    provider = cfg["provider"]
    if provider == "anthropic":
        from models.anthropic_adapter import AnthropicAdapter
        return AnthropicAdapter(config_name, cfg)
    if provider in ("together", "openrouter", "openai_compat"):
        from models.openai_compat import OpenAICompatAdapter
        return OpenAICompatAdapter(config_name, cfg)
    if provider == "mock":
        from models.mock_adapter import MockAdapter
        return MockAdapter(config_name, cfg)
    raise ValueError(f"unknown provider {provider}")


class Adapter:
    """Base class. Subclasses implement _call(messages_state) for one HTTP attempt."""

    provider: str = "base"

    def __init__(self, name: str, cfg: dict):
        self.name = name
        self.cfg = cfg
        self.model = cfg["model"]
        self.max_tokens = int(cfg.get("max_tokens", 8000))
        self.max_tokens_cap = int(cfg.get("max_tokens_cap", max(self.max_tokens, 32000)))
        self.vision = bool(cfg.get("vision", False))
        self.max_transient_retries = int(cfg.get("max_transient_retries", 2))
        self.max_repairs = int(cfg.get("max_repairs", 1))          # schema/JSON repair turns
        self.max_truncation_retries = int(cfg.get("max_truncation_retries", 1))  # separate budget

    def generate(self, system: str, user: str, schema: dict, images: list[dict] | None = None,
                 guard: Guard | None = None, schema_name: str = "underwriting_report") -> GenResult:
        raise NotImplementedError
