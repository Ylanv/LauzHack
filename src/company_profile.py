"""Company financial profile from public sources. 0 LLM token.

What is (and is not) public for a Swiss private SME:
- revenue / company valuation: NOT published (only listed companies publish accounts) → null + reason.
- bankruptcy risk: no official score, but the commercial register (Zefix / SHAB) exposes hard signals:
  status (liquidation, bankruptcy, composition), capital, age, frequency of board changes.
  We return a *signal-based level* (low / moderate / high / unknown) with the signals — not a probability.

Source: the JSON API behind zefix.ch (no key). NB: unofficial — the official ZefixPublicREST
needs free credentials (request at zefix.admin.ch) and should replace it in production.
"""

import re
from datetime import date, datetime

import httpx

ZEFIX = "https://www.zefix.ch/ZefixREST/api/v1"
_client = httpx.Client(timeout=30, headers={"User-Agent": "axa-smart-property/0.1", "Accept": "application/json"})

# Mutation keys seen in SHAB publications (Zefix). Anything containing these is a hard warning.
HARD = {"konkurs": "bankruptcy proceedings", "nachlass": "composition proceedings (Nachlassstundung)",
        "aufl": "dissolution", "liq": "liquidation", "loesch": "deletion"}
SOFT = {"kapitalherabsetzung": "capital reduction", "sitzverlegung": "seat transfer"}
BAD_STATUS = {"IN_AUFLOESUNG": "in dissolution/liquidation", "IN_LIQUIDATION": "in liquidation",
              "GELOESCHT": "deleted from the register", "KONKURS": "bankruptcy"}


def _parse_date(s):
    try:
        return datetime.strptime(s[:10], "%Y-%m-%d").date()
    except (TypeError, ValueError):
        return None


def _capital(messages):
    m = re.search(r"(?:Stammkapital|Aktienkapital|Grundkapital|capital social|capital-actions|capitale sociale)"
                  r"[^.;]{0,40}?(?:CHF|Fr\.)\s?([\d'’ ]+(?:\.\d{2})?)", messages)
    if not m:
        return None
    try:
        return float(re.sub(r"[^\d.]", "", m.group(1)))
    except ValueError:
        return None


def company_profile(uid_or_name: str) -> dict:
    """uid_or_name: 'CHE-105.977.463' or exact name. Returns financial profile + bankruptcy-risk signals."""
    s = _client.post(f"{ZEFIX}/firm/search.json", json={"name": uid_or_name, "languageKey": "de", "maxEntries": 5}).json()
    firms = s.get("list") or []
    uid_digits = re.sub(r"\D", "", uid_or_name)
    firm = next((f for f in firms if uid_digits and re.sub(r"\D", "", f.get("uid", "")) == uid_digits), firms[0] if firms else None)
    if not firm:
        return {"status": "not_found"}
    d = _client.get(f"{ZEFIX}/firm/{firm['ehraid']}.json").json()
    pubs = d.get("shabPub") or []
    keys = [m["key"] for p in pubs for m in p.get("mutationTypes", [])]
    messages = " ".join(re.sub(r"<[^>]+>", "", p.get("message", "")) for p in pubs)

    today = date.today()
    founded = next((_parse_date(p["shabDate"]) for p in pubs if any(m["key"] == "status.neu" for m in p.get("mutationTypes", []))), None)
    board_changes_24m = sum(1 for p in pubs if any(m["key"] == "aenderungorgane" for m in p.get("mutationTypes", []))
                            and (_parse_date(p["shabDate"]) or date.min) > date(today.year - 2, today.month, min(today.day, 28)))

    signals, level = [], "low"
    if d.get("status") in BAD_STATUS:
        signals.append(f"register status: {BAD_STATUS[d['status']]}")
        level = "high"
    for k in keys:
        for frag, label in HARD.items():
            if frag in k and label not in " ".join(signals):
                signals.append(f"SHAB publication: {label}")
                level = "high"
        for frag, label in SOFT.items():
            if frag in k and label not in " ".join(signals):
                signals.append(f"SHAB publication: {label}")
                level = "moderate" if level == "low" else level
    if founded and (today - founded).days < 3 * 365:
        signals.append(f"young company (registered {founded.isoformat()})")
        level = "moderate" if level == "low" else level
    if board_changes_24m >= 3:
        signals.append(f"{board_changes_24m} board/management changes in 24 months")
        level = "moderate" if level == "low" else level
    if not pubs:
        signals.append("no SHAB publication in the digital archive (stable, older company — or very little history)")

    return {
        "status": "ok",
        "register_status": d.get("status"),
        "founded_or_registered": founded.isoformat() if founded else None,
        "share_capital_chf": _capital(messages),
        "has_statutory_auditor": bool(d.get("auditFirms")),  # no auditor = opting-out, typical for < 10 FTE
        "shab_publications": len(pubs),
        "last_shab_publication": d.get("shabDate"),
        "old_names": [o.get("name") for o in d.get("oldNames") or []][:5],
        "cantonal_excerpt_url": d.get("cantonalExcerptWeb"),
        "bankruptcy_risk": {"level": level, "signals": signals,
                            "method": "rule-based signals from the commercial register (not a probability, no actuarial score)"},
        "annual_revenue_chf": None,
        "annual_revenue_note": "not public: Swiss private companies do not publish their accounts",
        "company_value_chf": None,
        "company_value_note": "not public: requires financial statements (ask the client / credit bureau)",
    }
