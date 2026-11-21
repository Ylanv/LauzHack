"""Deterministic validation of a generated report (OUTPUT) against its evidence bundle (COMBINED_FEATURE).

    issues = validate(report, bundle)      # list of {"severity": "error"|"warning", "code", "path", "message"}

Errors make the report invalid (one bounded repair is attempted by the pipeline); warnings are recorded
in validation.json and shown in the manifest, never hidden.
"""
from __future__ import annotations

import re

from src.report import contracts

REGULATED_PERILS = {"river_flood", "surface_runoff", "hail", "windstorm", "landslide"}
PROTECTION_TERMS = {
    "feat.sprinklers": r"sprinkler",
    "feat.fire_alarm_detection": r"fire alarm|smoke detect|detection system|automatic detection",
    "feat.fire_compartmentation": r"compartment",
    "feat.prior_losses": r"loss history|claims history|prior loss|previous loss|loss-free|claims-free",
}
NEGATION = r"\b(no|not|unknown|undocumented|unverified|whether|confirm|verify|ask|request|missing|absent from|cannot|without|if|unless|gap|question|lack|evidence|record|records|documented|documentation|information|data)\b"
ASSERT = r"\b(is|are|has|have|was|were)\s+(installed|equipped|fitted|present|in place|operational)\b|\bequipped with\b|\bloss-free\b|\bclaims-free\b|\bno (prior )?(claims|losses)\b|\bno sprinkler"
PREMIUM = re.compile(r"\bpremium\b[^.;]{0,40}\bCHF\s?[\d'.,]+|\bCHF\s?[\d'.,]+[^.;]{0,30}\bpremium\b|\bpremium (of|is|would be|amounts to)\s+[\d'.,]+", re.I)


def _issue(sev, code, path, msg):
    return {"severity": sev, "code": code, "path": path, "message": msg}


def _strings(node, path=""):
    if isinstance(node, str):
        yield path, node
    elif isinstance(node, dict):
        for k, v in node.items():
            yield from _strings(v, f"{path}/{k}" if path else k)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            yield from _strings(v, f"{path}/{i}")


def _numbers_in(obj) -> set[float]:
    out: set[float] = set()
    for _, s in _strings(obj):
        for m in re.finditer(r"\d[\d'’,]*(?:\.\d+)?", s):
            try:
                out.add(float(re.sub(r"['’,]", "", m.group(0))))
            except ValueError:
                pass
    def walk(x):
        if isinstance(x, bool):
            return
        if isinstance(x, (int, float)):
            out.add(float(x))
        elif isinstance(x, dict):
            for v in x.values():
                walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
    walk(obj)
    return out


def validate(report: dict | None, bundle: dict) -> list[dict]:
    if not isinstance(report, dict):
        return [_issue("error", "not_json_object", "<root>", "model output is not a JSON object")]
    issues = [_issue("error", "schema", e.split(":", 1)[0], e) for e in contracts.errors("OUTPUT", report)]

    case_id = (bundle.get("case") or {}).get("case_id")
    if report.get("case_id") != case_id:
        issues.append(_issue("error", "case_id_mismatch", "case_id", f"report case_id {report.get('case_id')!r} != {case_id!r}"))

    facts = {f["id"]: f for f in bundle.get("facts", [])}
    sources = {s["id"] for s in bundle.get("sources", [])}
    visuals = {v["id"]: v for v in bundle.get("visuals", [])}
    anns = {a["id"] for v in visuals.values() for a in v.get("annotations", [])}
    evidence_ok = set(facts) | sources | set(visuals) | anns
    findings = {f.get("id") for f in report.get("priority_findings", []) if isinstance(f, dict)}

    def check(ids, allowed, path, what):
        for i in ids or []:
            if i not in allowed:
                issues.append(_issue("error", "unknown_reference", path, f"{what} {i!r} does not exist in the evidence bundle"))

    es = report.get("executive_summary") or {}
    check(es.get("critical_fact_ids"), facts, "executive_summary/critical_fact_ids", "fact_id")
    for dom, c in (report.get("cope") or {}).items():
        check(c.get("fact_ids"), facts, f"cope/{dom}/fact_ids", "fact_id")
        check(c.get("evidence_ids"), evidence_ok, f"cope/{dom}/evidence_ids", "evidence_id")
        check(c.get("unknown_feature_ids"), facts, f"cope/{dom}/unknown_feature_ids", "feature_id")
    for n, f in enumerate(report.get("priority_findings") or []):
        check(f.get("fact_ids"), facts, f"priority_findings/{n}/fact_ids", "fact_id")
        check(f.get("evidence_ids"), evidence_ok, f"priority_findings/{n}/evidence_ids", "evidence_id")
    for n, h in enumerate(report.get("hazard_interpretations") or []):
        check(h.get("fact_ids"), facts, f"hazard_interpretations/{n}/fact_ids", "fact_id")
        check(h.get("evidence_ids"), evidence_ok, f"hazard_interpretations/{n}/evidence_ids", "evidence_id")
        if h.get("peril") in REGULATED_PERILS and h.get("pricing_role") == "potential_individual_pricing_input":
            issues.append(_issue("error", "regulated_peril_priced", f"hazard_interpretations/{n}/pricing_role",
                                 f"{h['peril']} belongs to the regulated natural-hazards cover: no individual pricing input"))
        elif h.get("peril") in REGULATED_PERILS and h.get("pricing_role") == "coverage_dependent":
            issues.append(_issue("warning", "regulated_peril_role", f"hazard_interpretations/{n}/pricing_role",
                                 f"{h['peril']} is regulated natural-hazards cover: expected regulated_component_underwriting_only or not_assessed"))
    vc = report.get("valuation_commentary") or {}
    check(vc.get("fact_ids"), facts, "valuation_commentary/fact_ids", "fact_id")
    for n, ve in enumerate(report.get("visual_evidence") or []):
        vid = ve.get("visual_id")
        if vid not in visuals:
            issues.append(_issue("error", "unknown_reference", f"visual_evidence/{n}/visual_id", f"visual_id {vid!r} does not exist"))
        else:
            check(ve.get("annotation_ids"), {a["id"] for a in visuals[vid].get("annotations", [])},
                  f"visual_evidence/{n}/annotation_ids", f"annotation of {vid}")
        check(ve.get("fact_ids"), facts, f"visual_evidence/{n}/fact_ids", "fact_id")
    for n, q in enumerate(report.get("open_questions") or []):
        check(q.get("feature_ids"), facts, f"open_questions/{n}/feature_ids", "feature_id")
        check(q.get("trigger_finding_ids"), findings, f"open_questions/{n}/trigger_finding_ids", "finding id")

    # required content
    for path, val in (("executive_summary/headline", es.get("headline")), ("executive_summary/overview", es.get("overview")),
                      ("underwriter_next_step", report.get("underwriter_next_step"))):
        if not (isinstance(val, str) and val.strip()):
            issues.append(_issue("error", "missing_section", path, "required narrative is empty"))
    for dom in ("construction", "occupancy", "protection", "exposure"):
        if not ((report.get("cope") or {}).get(dom) or {}).get("interpretation"):
            issues.append(_issue("error", "missing_section", f"cope/{dom}", "COPE domain has no interpretation"))

    # unknowns must stay unknown and become questions
    asked = {i for q in report.get("open_questions") or [] for i in q.get("feature_ids") or []}
    asked |= {i for c in (report.get("cope") or {}).values() for i in c.get("unknown_feature_ids") or []}
    missing_q = [i for i in bundle.get("unknown_feature_ids", []) if i not in asked]
    if missing_q:
        issues.append(_issue("warning", "unknown_not_asked", "open_questions",
                             f"{len(missing_q)} unknown feature(s) neither asked nor listed as a COPE gap: {', '.join(missing_q[:10])}"))
    texts = list(_strings(report))
    for fid, term in PROTECTION_TERMS.items():
        f = facts.get(fid)
        if not f or f.get("evidence_status") != "unknown":
            continue
        for path, s in texts:
            if path.startswith("open_questions"):
                continue
            for sent in re.split(r"(?<=[.;!?])\s+", s):
                if "?" in sent:
                    continue
                if re.search(term, sent, re.I) and re.search(ASSERT, sent, re.I) and not re.search(NEGATION, sent.replace("no sprinkler", ""), re.I):
                    issues.append(_issue("error", "unknown_asserted", path,
                                         f"{fid} is unknown in the evidence but the report asserts: {sent[:160]!r}"))

    # no premiums; CHF amounts must come from the evidence
    known = _numbers_in(bundle)
    for path, s in texts:
        if PREMIUM.search(s):
            issues.append(_issue("error", "premium_quoted", path, f"report quotes a premium: {PREMIUM.search(s).group(0)[:120]!r}"))
        for m in re.finditer(r"CHF\s?(\d[\d'’,]*(?:\.\d+)?)\s?(M|m|million|k)?\b", s):
            v = float(re.sub(r"['’,]", "", m.group(1)))
            mult = {"M": 1e6, "m": 1e6, "million": 1e6, "k": 1e3}.get(m.group(2) or "", 1)
            cand = {v, v * mult}
            if not any(abs(c - k) <= 0.02 * max(abs(k), 1) for c in cand for k in known):
                issues.append(_issue("warning", "untraceable_amount", path,
                                     f"amount {m.group(0)!r} not found in the evidence (check it is derived, not invented)"))
    return issues


def summary(issues: list[dict]) -> dict:
    errs = [i for i in issues if i["severity"] == "error"]
    return {"valid": not errs, "errors": len(errs), "warnings": len(issues) - len(errs),
            "codes": sorted({i["code"] for i in issues})}
