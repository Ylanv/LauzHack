"""Claude API adapter (official `anthropic` SDK).

Structured output: `output_config.format = {type: json_schema, schema}` (GA structured outputs).
The provider-side schema has unsupported keywords stripped (maxLength, maxItems, ...); the full
schema is validated client-side, with 1 repair turn on violation.
Thinking: Opus 5.5 / Sonnet 5.5 cannot disable thinking -> depth is set via `effort` in the config.
Haiku 4.5 takes no thinking/effort params. No refusal fallback (it would swap the model under test);
a refusal is recorded as an error.
"""
from __future__ import annotations

import base64
import json
import time

import anthropic

from models.base import (Adapter, BudgetExceeded, GenResult, estimate_tokens, extract_json,
                         now_ms, repair_message, strip_for_strict, validate)


class AnthropicAdapter(Adapter):
    provider = "anthropic"
    # schema sha -> True when the API rejected its grammar ("compiled grammar is too large").
    # The frozen llm_report_output.schema.json hits this limit (2026-11-21, Haiku 5.5 and Opus 5.5),
    # so we fall back to prompt-only JSON (schema is in the user message) + client validation + 1 repair.
    _grammar_rejected: dict[str, bool] = {}

    def __init__(self, name, cfg):
        super().__init__(name, cfg)
        self._client = None

    def client(self):
        if self._client is None:
            # SDK retries disabled: we count retries ourselves.
            self._client = anthropic.Anthropic(max_retries=0, timeout=float(self.cfg.get("timeout_s", 900)))
        return self._client

    def _user_content(self, user: str, images: list[dict] | None):
        if not images:
            return user
        blocks = []
        for img in images:
            blocks.append({"type": "image", "source": {
                "type": "base64", "media_type": img["mime"],
                "data": base64.standard_b64encode(img["bytes"]).decode()}})
        blocks.append({"type": "text", "text": user})
        return blocks

    def generate(self, system, user, schema, images=None, guard=None, schema_name="underwriting_report"):
        import hashlib
        strict_schema = strip_for_strict(schema)
        skey = hashlib.sha256(json.dumps(strict_schema, sort_keys=True).encode()).hexdigest()
        use_format = self.cfg.get("structured", "json_schema") == "json_schema" and not self._grammar_rejected.get(skey)
        res = GenResult(structured_mode="output_config.json_schema" if use_format else "prompt_only+validate")
        messages = [{"role": "user", "content": self._user_content(user, images)}]
        max_tokens = self.max_tokens
        output_config = {"format": {"type": "json_schema", "schema": strict_schema}} if use_format else {}
        if self.cfg.get("effort"):
            output_config["effort"] = self.cfg["effort"]
        extra = {}
        if self.cfg.get("thinking"):
            extra["thinking"] = self.cfg["thinking"]
        img_tokens = 1600 * len(images or [])
        transient = repairs = truncs = 0
        t0 = now_ms()
        while True:
            est_in = estimate_tokens(system + json.dumps(strict_schema) + json.dumps(
                [m["content"] if isinstance(m["content"], str) else user for m in messages])) + img_tokens
            if guard:
                try:
                    guard(est_in, int(self.cfg.get("expected_output_tokens", min(max_tokens, 4000))))
                except BudgetExceeded as e:
                    res.error = f"budget: {e}"
                    break
            a0 = now_ms()
            try:
                # streaming: required by the SDK for max_tokens >~21k (long requests); same billing
                with self.client().messages.stream(
                        model=self.model, max_tokens=max_tokens, system=system,
                        messages=messages, **({"output_config": output_config} if output_config else {}),
                        **extra) as stream:
                    resp = stream.get_final_message()
            except (anthropic.RateLimitError, anthropic.InternalServerError,
                    anthropic.APIConnectionError, anthropic.APITimeoutError) as e:
                res.attempts.append({"error": type(e).__name__, "latency_ms": int(now_ms() - a0)})
                if transient < self.max_transient_retries:
                    transient += 1
                    res.retries += 1
                    time.sleep(min(30, 2 ** transient * 2))
                    continue
                res.error = f"transient: {type(e).__name__}: {str(e)[:300]}"
                break
            except anthropic.BadRequestError as e:
                res.attempts.append({"error": "400", "latency_ms": int(now_ms() - a0)})
                if "grammar is too large" in str(e.message) and "format" in output_config:
                    self._grammar_rejected[skey] = True
                    output_config.pop("format")
                    res.structured_mode = "prompt_only+validate (grammar too large)"
                    continue  # rejected request is not billed; not counted as a retry
                res.error = f"api 400: {str(e.message)[:400]}"
                break
            except anthropic.APIStatusError as e:  # other 4xx: not retryable
                res.attempts.append({"error": f"{e.status_code}", "latency_ms": int(now_ms() - a0)})
                res.error = f"api {e.status_code}: {str(e.message)[:400]}"
                break
            u = resp.usage
            in_tok = (u.input_tokens or 0)
            cr = getattr(u, "cache_read_input_tokens", 0) or 0
            cw = getattr(u, "cache_creation_input_tokens", 0) or 0
            res.input_tokens += in_tok
            res.cache_read_tokens += cr
            res.cache_write_tokens += cw
            res.output_tokens += u.output_tokens or 0
            res.finish_reason = resp.stop_reason
            res.model_reported = resp.model
            res.attempts.append({"input_tokens": in_tok, "output_tokens": u.output_tokens,
                                 "stop_reason": resp.stop_reason, "latency_ms": int(now_ms() - a0)})
            text = "".join(b.text for b in resp.content if b.type == "text")
            res.text = text
            if resp.stop_reason == "refusal":
                cat = getattr(getattr(resp, "stop_details", None), "category", None)
                res.error = f"refusal (category={cat})"
                break
            if resp.stop_reason == "max_tokens" and truncs < self.max_truncation_retries and max_tokens < self.max_tokens_cap:
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
