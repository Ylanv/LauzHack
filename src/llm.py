"""Single entry point for every LLM call: model routing, structured output, cache, metrics.

Usage:
    result, call = llm_call(
        role="vision",
        system=SYSTEM_PROMPT,
        user="Describe the roof.",
        images=[jpeg_bytes],
        schema=ROOF_SUBSCHEMA,       # JSON Schema of the sub-object this call fills
        schema_name="analyze_roof",
    )
    metrics["tool_calls"].append(call)
"""

import base64
import json
import time

from jsonschema import Draft202012Validator
from openai import OpenAI

from src import config
from src.cache import cache, make_key

_client: OpenAI | None = None


def client() -> OpenAI:
    global _client
    if _client is None:
        if not config.LLM_API_KEY:
            raise RuntimeError("LLM_API_KEY is not set (see .env.example)")
        _client = OpenAI(base_url=config.LLM_BASE_URL, api_key=config.LLM_API_KEY)
    return _client


def _cost_chf(model: str, tokens_in: int, tokens_out: int) -> float:
    price_in, price_out = config.MODEL_PRICES_CHF_PER_MTOK.get(model, (0.0, 0.0))
    return (tokens_in * price_in + tokens_out * price_out) / 1_000_000


def _messages(system: str, user: str, images: list[bytes], mime: str) -> list[dict]:
    content: list[dict] = [{"type": "text", "text": user}]
    for img in images:
        b64 = base64.b64encode(img).decode()
        content.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}})
    return [{"role": "system", "content": system}, {"role": "user", "content": content}]


def llm_call(
    role: str,
    system: str,
    user: str,
    schema: dict,
    schema_name: str,
    images: list[bytes] | None = None,
    image_mime: str = "image/jpeg",
    max_tokens: int = 800,
) -> tuple[dict, dict]:
    """Returns (parsed_json, tool_call_metric). Retries once if output fails the schema."""
    model = config.MODELS[role]
    if not model:
        raise RuntimeError(f"MODEL_{role.upper()} is not set (see .env.example)")

    messages = _messages(system, user, images or [], image_mime)
    key = make_key("llm", {"model": model, "messages": messages, "schema": schema})
    started = time.perf_counter()

    cached = cache.get(key)
    if cached is not None:
        return cached, _metric(schema_name, started, 0, 0, model, cache_hit=True)

    validator = Draft202012Validator(schema)
    tokens_in = tokens_out = 0
    last_error = ""

    for _ in range(2):  # 1 attempt + 1 retry with the validation error
        resp = client().chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=max_tokens,
            temperature=0,
            response_format={
                "type": "json_schema",
                "json_schema": {"name": schema_name, "schema": schema, "strict": True},
            },
        )
        if resp.usage:
            tokens_in += resp.usage.prompt_tokens or 0
            tokens_out += resp.usage.completion_tokens or 0

        text = resp.choices[0].message.content or ""
        try:
            data = json.loads(text)
            errors = [e.message for e in validator.iter_errors(data)]
        except json.JSONDecodeError as e:
            data, errors = None, [f"invalid JSON: {e}"]

        if not errors:
            cache.set(key, data)
            return data, _metric(schema_name, started, tokens_in, tokens_out, model)

        finish = resp.choices[0].finish_reason
        last_error = "; ".join(errors[:5]) + f" [finish_reason={finish}, chars={len(text)}]"
        (config.CACHE_DIR / f"last_fail_{schema_name}.txt").write_text(text, encoding="utf-8") if not config.ON_VERCEL else None
        if finish == "length":  # truncated output: same request with twice the room (re-sending a cut JSON makes it worse)
            max_tokens *= 2
            continue
        messages = messages + [
            {"role": "assistant", "content": text},
            {"role": "user", "content": f"Your JSON is invalid: {last_error}. Return corrected JSON only."},
        ]

    raise ValueError(f"{schema_name}: model output failed schema twice: {last_error}")


def build_metrics(calls: list[dict], duration_ms: int, fields_applicable: int, fields_filled: int) -> dict:
    """Aggregate tool calls into report.json → metrics (strips internal _model/_cost_chf keys)."""
    public = [{k: v for k, v in c.items() if not k.startswith("_")} for c in calls]
    return {
        "fields_applicable": fields_applicable,
        "fields_filled": fields_filled,
        "tool_calls": public,
        "tokens_input": sum(c["tokens_input"] for c in public),
        "tokens_output": sum(c["tokens_output"] for c in public),
        "cost_chf": round(sum(c.get("_cost_chf", 0.0) for c in calls), 6),
        "duration_ms": duration_ms,
    }


def _metric(tool: str, started: float, tokens_in: int, tokens_out: int, model: str, cache_hit: bool = False) -> dict:
    """One metric per LLM call (aggregated by build_metrics; _model/_cost_chf are internal)."""
    return {
        "tool": tool,
        "duration_ms": int((time.perf_counter() - started) * 1000),
        "tokens_input": tokens_in,
        "tokens_output": tokens_out,
        "cache_hit": cache_hit,
        "_model": model,
        "_cost_chf": _cost_chf(model, tokens_in, tokens_out),
    }
