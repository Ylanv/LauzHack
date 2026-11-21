"""Provider adapters for the report-model benchmark (owner: benchmark-engineer).

Common interface (see base.Adapter.generate):
    generate(system, user, schema, images=None, guard=None) -> GenResult
    GenResult = {text, parsed_json, input_tokens, output_tokens, latency_ms, retries, error, ...}
"""
from models.base import GenResult, get_adapter  # noqa: F401
