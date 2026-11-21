"""OpenAI-compatible adapter for Together AI and OpenRouter (same client pattern as src/llm.py).

Structured output, in order of preference (config key `structured`):
  json_schema  -> response_format {type: json_schema, strict: true} (provider-side constraint)
  json_object  -> JSON mode; schema enforced by client-side validation + 1 repair turn
  none         -> plain text, JSON extracted + validated + 1 repair turn
If the provider rejects json_schema with a 400, we fall back once to json_object (recorded in
`structured_mode`). The prompt always contains the schema, so the model input is identical across modes.
"""
from __future__ import annotations

import base64
import json
import os
import time

import openai
from openai import OpenAI

from models.base import (Adapter, BudgetExceeded, GenResult, estimate_tokens, extract_json,
                         now_ms, repair_message, strip_for_strict, validate)

PROVIDER_DEFAULTS = {
    "together": {"key_env": "TOGETHER_API_KEY", "base_url": "https://api.together.xyz/v1"},
    "openrouter": {"key_env": "OPENROUTER_API_KEY", "base_url": "https://openrouter.ai/api/v1"},
    "openai_compat": {"key_env": "LLM_API_KEY", "base_url_env": "LLM_BASE_URL"},
}


def resolve_endpoint(provider: str, cfg: dict | None = None) -> tuple[str | None, str | None]:
    cfg = cfg or {}
    d = {**PROVIDER_DEFAULTS.get(provider, {}), **{k: v for k, v in cfg.items() if k in ("key_env", "base_url", "base_url_env")}}
    key = os.environ.get(d.get("key_env", ""), "") or None
    base = os.environ.get(d["base_url_env"], "") if d.get("base_url_env") else None
    base = base or d.get("base_url")
    return key, base


class OpenAICompatAdapter(Adapter):
    def __init__(self, name, cfg):
        super().__init__(name, cfg)
        self.provider = cfg["provider"]
        self._client = None

    def client(self):
        if self._client is None:
            key, base = resolve_endpoint(self.provider, self.cfg)
            if not key or not base:
                raise RuntimeError(f"{self.provider}: API key or base URL env var not set")
            self._client = OpenAI(api_key=key, base_url=base, max_retries=0,
                                  timeout=float(self.cfg.get("timeout_s", 900)))
        return self._client

    @staticmethod
    def _user_content(user, images):
        if not images:
            return user
        content = [{"type": "text", "text": user}]
        for img in images:
            b64 = base64.b64encode(img["bytes"]).decode()
            content.append({"type": "image_url", "image_url": {"url": f"data:{img['mime']};base64,{b64}"}})
        return content

    def _response_format(self, mode, schema, schema_name):
        if mode == "json_schema":
            return {"type": "json_schema", "json_schema": {"name": schema_name, "schema": strip_for_strict(schema), "strict": True}}
        if mode == "json_object":
            return {"type": "json_object"}
        return None

    def generate(self, system, user, schema, images=None, guard=None, schema_name="underwriting_report"):
        mode = self.cfg.get("structured", "json_schema")
        res = GenResult(structured_mode=mode)
        messages = [{"role": "system", "content": system},
                    {"role": "user", "content": self._user_content(user, images)}]
        max_tokens = self.max_tokens
        img_tokens = 1600 * len(images or [])
        transient = repairs = truncs = 0
        t0 = now_ms()
        extra = dict(self.cfg.get("extra_body", {}))
        if self.provider == "openrouter":
            extra.setdefault("usage", {"include": True})  # actual cost in usage.cost
            if self.cfg.get("openrouter_provider"):
                extra.setdefault("provider", self.cfg["openrouter_provider"])
        while True:
            est_in = estimate_tokens(json.dumps([m["content"] if isinstance(m["content"], str) else user for m in messages])) + img_tokens
            if guard:
                try:
                    guard(est_in, int(self.cfg.get("expected_output_tokens", min(max_tokens, 4000))))
                except BudgetExceeded as e:
                    res.error = f"budget: {e}"
                    break
            kwargs = dict(model=self.model, messages=messages, max_tokens=max_tokens,
                          temperature=self.cfg.get("temperature", 0))
            rf = self._response_format(mode, schema, schema_name)
            if rf:
                kwargs["response_format"] = rf
            if extra:
                kwargs["extra_body"] = extra
            a0 = now_ms()
            try:
                resp = self.client().chat.completions.create(**kwargs)
            except openai.BadRequestError as e:
                res.attempts.append({"error": "400", "latency_ms": int(now_ms() - a0)})
                msg = str(e).lower()
                if mode == "json_schema" and any(w in msg for w in ("schema", "response_format", "grammar", "json")):
                    # provider/model rejects strict json_schema -> JSON mode (+ validation + repair)
                    mode = "json_object"
                    res.structured_mode = "json_object(fallback from json_schema)"
                    continue
                res.error = f"api 400: {str(e)[:400]}"
                break
            except (openai.RateLimitError, openai.InternalServerError,
                    openai.APIConnectionError, openai.APITimeoutError) as e:
                res.attempts.append({"error": type(e).__name__, "latency_ms": int(now_ms() - a0)})
                if transient < self.max_transient_retries:
                    transient += 1
                    res.retries += 1
                    time.sleep(min(30, 2 ** transient * 2))
                    continue
                res.error = f"transient: {type(e).__name__}: {str(e)[:300]}"
                break
            except openai.APIStatusError as e:
                res.attempts.append({"error": str(e.status_code), "latency_ms": int(now_ms() - a0)})
                res.error = f"api {e.status_code}: {str(e)[:400]}"
                break
            u = resp.usage
            in_tok = (u.prompt_tokens or 0) if u else 0
            out_tok = (u.completion_tokens or 0) if u else 0
            res.input_tokens += in_tok
            res.output_tokens += out_tok
            det = getattr(u, "completion_tokens_details", None) if u else None
            rt = getattr(det, "reasoning_tokens", None) if det else None
            if rt is not None:  # subset of completion_tokens (already billed as output; never add twice)
                res.reasoning_tokens = (res.reasoning_tokens or 0) + int(rt)
            cost = getattr(u, "cost", None) if u else None
            if cost is None and u is not None and getattr(u, "model_extra", None):
                cost = u.model_extra.get("cost")
            if cost is not None:
                res.provider_cost_usd = (res.provider_cost_usd or 0.0) + float(cost)
            ch = resp.choices[0]
            res.finish_reason = ch.finish_reason
            res.model_reported = getattr(resp, "model", None)
            res.attempts.append({"input_tokens": in_tok, "output_tokens": out_tok,
                                 "finish_reason": ch.finish_reason, "latency_ms": int(now_ms() - a0)})
            text = ch.message.content or ""
            res.text = text
            if ch.finish_reason == "length" and truncs < self.max_truncation_retries and max_tokens < self.max_tokens_cap:
                truncs += 1
                res.truncation_retries += 1
                res.retries += 1
                max_tokens = min(max_tokens * 2, self.max_tokens_cap)
                continue
            try:
                data = extract_json(text)
                errs = validate(schema, data)
            except (json.JSONDecodeError, ValueError) as e:
                data, errs = None, [f"invalid JSON: {e}"]
            res.parsed_json = data if isinstance(data, dict) else None
            res.validation_errors = errs
            res.schema_valid = not errs
            if res.schema_valid_first_try is None:
                res.schema_valid_first_try = not errs
            if not errs or repairs >= self.max_repairs:
                if errs and res.parsed_json is None:
                    res.error = "invalid_json"
                break
            repairs += 1
            res.retries += 1
            res.repair_attempts += 1
            messages = messages + [{"role": "assistant", "content": text or "{}"},
                                   {"role": "user", "content": repair_message(errs)}]
        res.latency_ms = int(now_ms() - t0)
        return res
