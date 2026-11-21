"""Final report: 1 LLM call over the 3 blocks + 25 features → structured findings, then a deterministic HTML render.

The LLM never formats HTML (that would waste tokens): it returns REPORT_SCHEMA JSON, Python renders it.
Without an LLM key, a rule-based fallback writes the public_data block only (0 token) so the pipeline still runs.
"""

import base64
import html
import json

from src.blocks import compact, llm_available
from src.features import CATALOG
from src.prompts import REPORT_PROMPT, REPORT_SCHEMA, SYSTEM


def _compact_features(features: list) -> str:
    rows = [{"f": x["feature"], "v": x["value"], "s": x["status"], "r": CATALOG[x["feature"]][1]} for x in features]
    return json.dumps(rows, ensure_ascii=False, separators=(",", ":"))


def write(blocks: dict, features: list) -> tuple[dict, dict | None]:
    if llm_available("synthesis"):
        from src.llm import llm_call
        prompt = REPORT_PROMPT.format(features=_compact_features(features), blocks=compact(blocks))
        return llm_call("synthesis", SYSTEM, prompt, REPORT_SCHEMA, "final_report", max_tokens=4000)
    rep = fallback(blocks)
    rep["missing_information"] = [x["feature"] for x in features if x["status"] == "unknown" and CATALOG[x["feature"]][1] >= 4]
    return rep, None


# ---------------------------------------------------------------- rule-based fallback (no LLM)
def _f(topic, fact, effect, direction, confidence="verified"):
    return {"topic": topic, "fact": fact, "effect": effect, "direction": direction, "confidence": confidence}


def fallback(blocks: dict) -> dict:
    d = blocks["public_data"]["data"]
    c, b, h = d["company"], d["building"], d["natural_hazards"]
    out = []
    risk = c.get("bankruptcy_risk") or {}
    if risk:
        out.append(_f("Financial solidity", f"Register signals: {risk.get('level')} ({'; '.join(risk.get('signals') or []) or 'no warning'})",
                      "A company in liquidation or with recent warnings is a counterparty risk for the policy.",
                      "increases_risk" if risk.get("level") in ("moderate", "high") else "neutral"))
    cond = b.get("condition") or {}
    if cond.get("state") and cond["state"] != "unknown":
        out.append(_f("Building age / condition", f"{cond['state']} ({cond.get('status')}), built {cond['construction'].get('from') or '?'}–{cond['construction'].get('to') or '?'}",
                      "Older buildings without renovation have higher fire, water-damage and maintenance exposure.",
                      "increases_risk" if cond["state"] == "old" else "decreases_risk" if cond["state"] == "new" else "neutral",
                      "verified" if cond.get("status") != "estimated" else "inferred"))
    heat = b.get("heating") or {}
    if heat.get("fire_relevant"):
        out.append(_f("Heating", f"{heat['energy_source']} heating ({heat.get('generator') or 'generator unknown'})",
                      "A combustion installation in the building is an ignition source; check boiler-room separation and maintenance.",
                      "increases_risk"))
    if h.get("seismic_zone_sia261"):
        z = h["seismic_zone_sia261"]
        out.append(_f("Earthquake", f"SIA 261 zone {z}" + (f", soil class {h['seismic_soil_class']}" if h.get("seismic_soil_class") else ""),
                      "Higher zones (Z2–Z3b) and soft soils (D–F) amplify shaking and structural damage.",
                      "increases_risk" if z in ("Z2", "Z3a", "Z3b") else "neutral"))
    if h.get("hail_50y_cm"):
        out.append(_f("Hail", f"{h['hail_50y_cm']} cm hailstones every 50 years",
                      "Roof, skylights, facades and solar panels are exposed above ~3 cm (prevention / special covers).",
                      "increases_risk" if h["hail_50y_cm"] >= 3.5 else "neutral"))
    for proc, v in (h.get("cantonal_hazard_map") or {}).items():
        out.append(_f(f"Cantonal hazard map – {proc}", f"level '{v['level']}' on {round(v['share'] * 100)}% of the footprint",
                      "Official hazard zone: prevention measures and special covers to discuss (no premium surcharge).",
                      "increases_risk" if v["level"].lower() in ("mittel", "erheblich", "gering") else "neutral"))
    if h.get("surface_runoff_perimeter_share"):
        s = h["surface_runoff_perimeter_share"]
        out.append(_f("Surface runoff", f"{round(s * 100)}% of the building perimeter in a runoff zone",
                      "Water can enter through ground-level openings, ramps and basements.", "increases_risk" if s > 0.3 else "neutral"))
    rc = b.get("reconstruction_cost") or {}
    if rc.get("best_estimate_chf"):
        out.append(_f("Reconstruction value", f"≈ {_chf(rc['best_estimate_chf'])} ({_chf(rc['low_chf'])}–{_chf(rc['high_chf'])})",
                      "Indicative sum insured (replacement value, excl. land and machinery) to validate.", "neutral", "inferred"))
    return {
        "executive_summary": "Rule-based summary of official data only (no LLM configured): image and website blocks were not analysed.",
        "attention_level": "moderate" if any(f["direction"] == "increases_risk" for f in out) else "low",
        "blocks": [{"block": "public_data", "summary": "Official registers and geodata.", "findings": out}],
        "key_risks": [f["topic"] for f in out if f["direction"] == "increases_risk"],
        "missing_information": [],
        "recommendations": ["Configure LLM_API_KEY + MODEL_* to analyse the orthophoto and the company website."],
    }


# ---------------------------------------------------------------- HTML
CSS = """body{font:15px/1.5 system-ui,sans-serif;max-width:1040px;margin:32px auto;padding:0 20px;color:#1d2333}
h1{font-size:24px;margin:0}h2{font-size:18px;margin:32px 0 8px;border-bottom:2px solid #00008f;padding-bottom:4px}
.sub{color:#5b6475}.badge{display:inline-block;padding:2px 10px;border-radius:12px;font-weight:600;font-size:13px}
.low{background:#e6f4ea;color:#1e6b34}.moderate{background:#fff4d6;color:#7a5a00}.high,.very_high{background:#fde2e1;color:#9b1c1c}
table{width:100%;border-collapse:collapse;margin:8px 0}td,th{border-bottom:1px solid #e3e6ec;padding:6px 8px;text-align:left;vertical-align:top}
th{background:#f4f6fa;font-size:13px}.inc{color:#9b1c1c}.dec{color:#1e6b34}.photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
figure{margin:0}figure img{width:100%;border-radius:6px}figcaption{font-size:12px;color:#5b6475}.kv td:first-child{width:30%;color:#5b6475}
.box{background:#f4f6fa;border-radius:8px;padding:12px 16px}td.sub{font-size:12px}"""
BLOCK_TITLES = {"public_data": "1 · Official data (registers & geodata)", "aerial_image": "2 · Aerial image (vision)",
                "website": "3 · Company website (scraping)"}
ARROW = {"increases_risk": ("▲", "inc"), "decreases_risk": ("▼", "dec"), "neutral": ("●", ""), "unknown": ("?", "")}
GROUPS = {"building": "Building characteristics", "fire": "Industrial & fire risks", "protection": "Protection systems",
          "hazards": "External hazards", "maintenance": "Maintenance & history"}
STATUS_CLS = {"verified": "low", "observed": "moderate", "inferred": "moderate", "estimated": "moderate", "unknown": "high"}


def _e(x):
    return html.escape(str(x)) if x is not None else "—"


def _chf(v):
    return f"CHF {v:,.0f}".replace(",", "'") if isinstance(v, (int, float)) else "—"


def _val(v):
    if isinstance(v, dict):
        return ", ".join(f"{k}: {_chf(x) if k.endswith('chf') else x}" for k, x in v.items() if x is not None)
    if isinstance(v, list):
        return "; ".join(map(str, v))
    return v


def render_html(result: dict, blocks: dict) -> str:
    rq, idt, report = result["request"], result["identification"], result["report"]
    metrics, cov = result["metrics"], result["feature_coverage"]
    src = {s["id"]: s for s in result["sources"]}
    photos = [p for k in ("aerial_image", "website") for p in blocks.get(k, {}).get("photos", [])]
    p = [f"<!doctype html><meta charset=utf-8><title>AXA Smart Property – {_e(rq['company_legal_name'])}</title><style>{CSS}</style>",
         f"<h1>{_e(rq['company_legal_name'])}</h1><div class=sub>{_e(rq['building_address'])} · client: {_e(rq['client_name'])}"
         f" · generated {_e(result['generated_at'][:16].replace('T', ' '))} UTC</div>",
         f"<p><span class='badge {report['attention_level']}'>Attention: {_e(report['attention_level'])}</span> "
         f"<span class=sub>Features found: {cov['all']['filled']}/{cov['all']['total']} (P0 {cov['P0']['filled']}/{cov['P0']['total']}"
         f" · P1 {cov['P1']['filled']}/{cov['P1']['total']} · P2 {cov['P2']['filled']}/{cov['P2']['total']})</span></p>",
         f"<div class=box>{_e(report['executive_summary'])}</div>"]

    risk = idt.get("bankruptcy_risk_signals") or {}
    rows = [("Company", _e(idt.get("company_name"))), ("UID", _e(idt.get("company_uid"))),
            ("Register status", f"{_e(idt.get('company_register_status'))} · bankruptcy-risk signals: <b>{_e(risk.get('level'))}</b> "
                                f"<span class=sub>{_e('; '.join(risk.get('signals') or []))}</span>"),
            ("Building EGID / canton", f"{_e(idt.get('building_egid'))} · {_e(idt.get('canton'))} ({_e(idt.get('cantonal_insurance_regime'))})"),
            ("Annual revenue", f"— <span class=sub>({_e(idt.get('annual_revenue_note'))})</span>"),
            ("Market value · requested coverages", "— · —"),
            ("Premium estimate", f"— <span class=sub>({_e(idt.get('insurance_premium_note'))})</span>")]
    p.append("<h2>Identification</h2><table class=kv>" + "".join(f"<tr><td>{k}</td><td>{v}</td></tr>" for k, v in rows) + "</table>")

    if photos:
        p.append("<h2>Photos</h2><div class=photos>")
        for ph in photos:
            b64 = "data:image/jpeg;base64," + base64.b64encode(ph["jpeg"]).decode()
            p.append(f"<figure><img src='{b64}' alt='{_e(ph['label'])}'><figcaption>{_e(ph['label'])} · {_e(ph.get('credit'))}</figcaption></figure>")
        p.append("</div>")

    p.append("<h2>Risk features (25)</h2><table><tr><th>Feature</th><th>Value</th><th>Status</th><th>Rel.</th><th>Covers</th><th>Source · note</th></tr>")
    for g, title in GROUPS.items():
        p.append(f"<tr><th colspan=6>{title}</th></tr>")
        for x in (f for f in result["features"] if CATALOG[f["feature"]][0] == g):
            group, rel, comps, prio = CATALOG[x["feature"]]
            ev = result.get("feature_evidence", {}).get(x["feature"], {})
            srcs = ", ".join(src[i]["provider"] for i in ev.get("source_ids", []) if i in src)
            note = f" · {_e(ev['note'])}" if ev.get("note") else ""
            p.append(f"<tr><td>{_e(x['feature'])} <span class=sub>{prio}</span></td><td>{_e(_val(x['value']))}</td>"
                     f"<td><span class='badge {STATUS_CLS.get(x['status'], '')}'>{_e(x['status'])}</span></td><td>{rel}/5</td>"
                     f"<td class=sub>{_e(', '.join(comps))}</td><td class=sub>{_e(srcs)}{note}</td></tr>")
    p.append("</table><p class=sub>Natural-hazard exposure is shown for underwriting, prevention and special covers only — it is not used as "
             "an individual premium surcharge for the regulated natural-hazards cover. Relevance scores are team priorities, not AXA pricing weights.</p>")

    done = {blk["block"] for blk in report["blocks"]}
    for key in ("public_data", "aerial_image", "website"):
        p.append(f"<h2>{BLOCK_TITLES[key]}</h2>")
        blk = next((x for x in report["blocks"] if x["block"] == key), None)
        if key not in done or not blk:
            st = blocks.get(key, {})
            p.append(f"<p class=sub>Not analysed: {_e(st.get('note') or st.get('status'))}</p>")
            continue
        p.append(f"<p>{_e(blk['summary'])}</p><table><tr><th></th><th>Topic</th><th>Fact</th><th>Effect on risk</th><th>Confidence</th></tr>")
        for f in blk["findings"]:
            sym, cls = ARROW.get(f["direction"], ("", ""))
            p.append(f"<tr><td class={cls}>{sym}</td><td>{_e(f['topic'])}</td><td>{_e(f['fact'])}</td><td>{_e(f['effect'])}</td><td>{_e(f['confidence'])}</td></tr>")
        p.append("</table>")

    for title, key in (("Key risks", "key_risks"), ("Missing information — ask the client", "missing_information"), ("Recommendations", "recommendations")):
        items = [x for x in report.get(key) or [] if x]
        if items:
            p.append(f"<h2>{title}</h2><ul>" + "".join(f"<li>{_e(x)}</li>" for x in items) + "</ul>")

    p.append("<h2>Sources</h2><ul class=sub>" + "".join(
        f"<li>{s['id']} · {_e(s['provider'])} ({_e(s['reliability'])}){' · ' + _e(s['url']) if s.get('url') else ''}</li>"
        for s in result["sources"]) + "</ul>")
    p.append(f"<h2>Efficiency</h2><p class=sub>LLM calls: {len(metrics['tool_calls'])} · tokens in/out: {metrics['tokens_input']}/{metrics['tokens_output']}"
             f" · cost ≈ CHF {metrics['cost_chf']:.4f} · total {metrics['duration_ms'] / 1000:.1f} s</p>")
    return "\n".join(p)
