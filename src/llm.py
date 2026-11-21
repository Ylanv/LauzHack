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


USD_TO_CHF = 0.80  # hardcoded conversion rate (approximate, fine for tracking)


def _cost_chf_estimate(model: str, tokens_in: int, tokens_out: int) -> float:
    price_in, price_out = config.MODEL_PRICES_CHF_PER_MTOK.get(model, (0.0, 0.0))
    return (tokens_in * price_in + tokens_out * price_out) / 1_000_000


def _usage_fields(usage) -> tuple[int, int, int, float | None]:
    """(prompt, completion, reasoning, real cost in USD) from an OpenAI-compatible usage object.
    OpenRouter returns the real billed cost when the request asks for usage accounting."""
    if not usage:
        return 0, 0, 0, None
    extra = getattr(usage, "model_extra", None) or {}
    details = getattr(usage, "completion_tokens_details", None)
    reasoning = getattr(details, "reasoning_tokens", 0) or 0
    cost = getattr(usage, "cost", None)
    if cost is None:
        cost = extra.get("cost")
    return usage.prompt_tokens or 0, usage.completion_tokens or 0, reasoning, (float(cost) if cost is not None else None)


RETRY_DELAYS_S = (2, 6, 15)  # waits before attempts 2-4 on HTTP 429: the provider throttled > 4 s in a real series


def _create_with_backoff(**kwargs):
    """chat.completions.create, retried on rate limits (429): the provider throttles bursts of parallel calls."""
    from openai import RateLimitError
    for delay in (*RETRY_DELAYS_S, None):
        try:
            return client().chat.completions.create(**kwargs)
        except RateLimitError:
            if delay is None:
                raise
            time.sleep(delay)


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
        wrapped = isinstance(cached, dict) and "data" in cached and "usage" in cached
        return (cached["data"] if wrapped else cached), _metric(schema_name, started, model, cache_hit=True,
                                                                saved=cached["usage"] if wrapped else None)

    validator = Draft202012Validator(schema)
    tokens_in = tokens_out = reasoning = 0
    cost_usd: float | None = None
    last_error = ""
    extra_body = {"usage": {"include": True}} if "openrouter" in config.LLM_BASE_URL else None

    for _ in range(2):  # 1 attempt + 1 retry with the validation error
        resp = _create_with_backoff(
            model=model,
            messages=messages,
            max_tokens=max_tokens,
            temperature=0,
            response_format={
                "type": "json_schema",
                "json_schema": {"name": schema_name, "schema": schema, "strict": True},
            },
            extra_body=extra_body,
        )
        p, c, r, cost = _usage_fields(resp.usage)
        tokens_in, tokens_out, reasoning = tokens_in + p, tokens_out + c, reasoning + r
        if cost is not None:
            cost_usd = (cost_usd or 0.0) + cost

        text = resp.choices[0].message.content or ""
        try:
            data = json.loads(text)
            errors = [e.message for e in validator.iter_errors(data)]
        except json.JSONDecodeError as e:
            data, errors = None, [f"invalid JSON: {e}"]

        if not errors:
            usage = {"tokens_input": tokens_in, "tokens_output": tokens_out, "reasoning_tokens": reasoning, "cost_usd": cost_usd}
            cache.set(key, {"data": data, "usage": usage})
            return data, _metric(schema_name, started, model, **usage)

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


def build_metrics(calls: list[dict], duration_ms: int, fields_applicable: int, fields_filled: int,
                  external_calls: dict | None = None) -> dict:
    """Usage tracking: one record per LLM call + totals (real OpenRouter cost when available) + external API calls."""
    billed = [c for c in calls if not c["cache_hit"]]
    real = [c["cost_usd"] for c in billed if c.get("cost_usd") is not None]
    return {
        "fields_applicable": fields_applicable,
        "fields_filled": fields_filled,
        "tool_calls": calls,
        "tokens_input": sum(c["tokens_input"] for c in calls),
        "tokens_output": sum(c["tokens_output"] for c in calls),
        "reasoning_tokens": sum(c.get("reasoning_tokens", 0) for c in calls),
        "cost_usd": round(sum(real), 8) if real else (0.0 if not billed else None),
        "cost_chf": round(sum(c["cost_chf"] for c in calls), 8),
        "cost_source": "openrouter" if billed and len(real) == len(billed) else ("cache" if not billed else "estimate"),
        "usd_to_chf": USD_TO_CHF,
        "cache_hits": sum(c["cache_hit"] for c in calls),
        "tokens_saved_by_cache": sum(c.get("saved_tokens", 0) for c in calls),
        "external_calls": external_calls or {},
        "duration_ms": duration_ms,
    }


def _metric(tool: str, started: float, model: str, tokens_input: int = 0, tokens_output: int = 0, reasoning_tokens: int = 0,
            cost_usd: float | None = None, cache_hit: bool = False, saved: dict | None = None) -> dict:
    """One usage record per LLM call. A cache hit costs 0 (saved_* = what the original call used)."""
    if cache_hit:
        cost_chf, source = 0.0, "cache"
    elif cost_usd is not None:
        cost_chf, source = cost_usd * USD_TO_CHF, "openrouter"
    else:
        cost_chf, source = _cost_chf_estimate(model, tokens_input, tokens_output), "estimate"
    rec = {
        "tool": tool, "model": model, "cache_hit": cache_hit,
        "tokens_input": tokens_input, "tokens_output": tokens_output, "reasoning_tokens": reasoning_tokens,
        "cost_usd": round(cost_usd, 8) if cost_usd is not None else (0.0 if cache_hit else None),
        "cost_chf": round(cost_chf, 8), "cost_source": source,
        "duration_ms": int((time.perf_counter() - started) * 1000),
    }
    if saved:
        rec["saved_tokens"] = (saved.get("tokens_input") or 0) + (saved.get("tokens_output") or 0)
        rec["saved_cost_usd"] = saved.get("cost_usd")
    return rec
