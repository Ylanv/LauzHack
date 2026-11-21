"""Key-value cache that works both locally and on Vercel.

- Upstash Redis REST (prod, persistent across invocations) if credentials are set.
- File cache otherwise: .cache/ locally, /tmp on Vercel (ephemeral, per instance).

Never put the client name in a key of shared public data (EGID, layers, URLs).
"""

import hashlib
import json
from pathlib import Path
from typing import Any

import httpx

from src import config


def make_key(namespace: str, payload: Any) -> str:
    digest = hashlib.sha256(json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return f"axa:{namespace}:{digest}"


class FileCache:
    def __init__(self, directory: Path):
        self.dir = directory
        self.dir.mkdir(parents=True, exist_ok=True)

    def _path(self, key: str) -> Path:
        return self.dir / (key.replace(":", "_") + ".json")

    def get(self, key: str) -> Any | None:
        p = self._path(key)
        return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None

    def set(self, key: str, value: Any) -> None:
        self._path(key).write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


class UpstashCache:
    def __init__(self, url: str, token: str, ttl_s: int):
        self.url, self.ttl = url.rstrip("/"), ttl_s
        self.headers = {"Authorization": f"Bearer {token}"}

    def _cmd(self, *args: Any) -> Any:
        r = httpx.post(self.url, headers=self.headers, json=list(args), timeout=5)
        r.raise_for_status()
        return r.json().get("result")

    def get(self, key: str) -> Any | None:
        try:
            raw = self._cmd("GET", key)
        except httpx.HTTPError:
            return None  # cache miss on error: never fail the pipeline because of the cache
        return json.loads(raw) if raw is not None else None

    def set(self, key: str, value: Any) -> None:
        try:
            self._cmd("SET", key, json.dumps(value, ensure_ascii=False), "EX", self.ttl)
        except httpx.HTTPError:
            pass


def get_cache() -> FileCache | UpstashCache:
    if config.UPSTASH_REDIS_REST_URL and config.UPSTASH_REDIS_REST_TOKEN:
        return UpstashCache(config.UPSTASH_REDIS_REST_URL, config.UPSTASH_REDIS_REST_TOKEN, config.CACHE_TTL_S)
    return FileCache(config.CACHE_DIR)


cache = get_cache()
