"""VLM benchmark deliverables: chart (quality vs cost, quality vs time) + example page (image → extracted features).

    python -m benchmark.vlm.report      # writes benchmark/vlm/vlm_benchmark.{html,png} and example.{html,png}
"""
from __future__ import annotations

import base64
import html
import json
import math
import shutil
import statistics as st
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESULTS, SUMMARY, LABELS = HERE / "results.jsonl", HERE / "summary.json", json.loads((HERE / "labels.json").read_text())
e = html.escape

CSS = """
:root{--surface:#fcfcfb;--ink:#0b0b0b;--ink2:#52514e;--grid:#e6e5e0;--s1:#2a78d6;--s2:#eb6834;color-scheme:light}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--surface:#1a1a19;--ink:#fff;--ink2:#c3c2b7;--grid:#2e2e2c;--s1:#3987e5;--s2:#d95926;color-scheme:dark}}
:root[data-theme=dark]{--surface:#1a1a19;--ink:#fff;--ink2:#c3c2b7;--grid:#2e2e2c;--s1:#3987e5;--s2:#d95926;color-scheme:dark}
body{margin:0;background:var(--surface);color:var(--ink);font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:1040px;margin:0 auto;padding:20px 16px}h1{font-size:19px;margin:0 0 4px}h2{font-size:16px;margin:22px 0 6px}
p.sub{color:var(--ink2);margin:0 0 12px}svg{width:100%;height:auto;display:block}.grid{stroke:var(--grid)}.axis{stroke:var(--ink2)}
.tick,.axl{fill:var(--ink2);font-size:12px}.lbl{fill:var(--ink);font-size:11.5px}.pt circle{fill:var(--s1);stroke:var(--surface);stroke-width:2}
.pt.ref circle{fill:var(--s2)}.pt:hover circle{stroke:var(--ink)}.panels{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media (max-width:720px){.panels{grid-template-columns:1fr}}
table{border-collapse:collapse;width:100%;font-size:13px;margin-top:10px}th,td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--grid);vertical-align:top}
th{color:var(--ink2);font-weight:600}.wrap{overflow-x:auto}.note{color:var(--ink2);font-size:12.5px;margin-top:10px}
.ex{display:grid;grid-template-columns:300px 1fr;gap:16px;margin:12px 0 22px;align-items:start}.ex img{width:100%;border-radius:4px}
@media (max-width:720px){.ex{grid-template-columns:1fr}}.ok{color:#1b7f3b}.bad{color:#b3261e}.part{color:#a15c00}
.legend{display:flex;gap:16px;color:var(--ink2);font-size:13px;margin:4px 0}.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:5px;vertical-align:-1px}
"""


def panel(rows, xkey, xlabel, log=False, fmt=lambda v: f"{v:g}"):
    W, H, L, R, T, B = 500, 380, 52, 16, 16, 52
    xs = [r[xkey] for r in rows]
    if log:
        lo, hi = 10 ** math.floor(math.log10(min(xs))), 10 ** math.ceil(math.log10(max(xs)))
        X = lambda v: L + (math.log10(v) - math.log10(lo)) / (math.log10(hi) - math.log10(lo)) * (W - L - R)  # noqa: E731
        ticks = [lo * 10 ** i for i in range(int(round(math.log10(hi / lo))) + 1)]
    else:
        hi = math.ceil(max(xs) / 5) * 5 or 1
        X = lambda v: L + v / hi * (W - L - R)  # noqa: E731
        ticks = [hi * i / 5 for i in range(6)]
    qs = [r["quality"] for r in rows]
    ylo, yhi = math.floor(min(qs) * 20) / 20 - 0.05, min(1.0, math.ceil(max(qs) * 20) / 20 + 0.05)
    Y = lambda q: T + (yhi - q) / (yhi - ylo) * (H - T - B)  # noqa: E731
    g = [f'<svg viewBox="0 0 {W} {H}" role="img">']
    q = ylo
    while q <= yhi + 1e-9:
        g.append(f'<line class="grid" x1="{L}" x2="{W-R}" y1="{Y(q):.1f}" y2="{Y(q):.1f}"/><text class="tick" x="{L-6}" y="{Y(q)+4:.1f}" text-anchor="end">{q:.2f}</text>')
        q = round(q + 0.05, 2)
    for t in ticks:
        g.append(f'<line class="grid" x1="{X(t):.1f}" x2="{X(t):.1f}" y1="{T}" y2="{H-B}"/><text class="tick" x="{X(t):.1f}" y="{H-B+16}" text-anchor="middle">{fmt(t)}</text>')
    g.append(f'<line class="axis" x1="{L}" x2="{W-R}" y1="{H-B}" y2="{H-B}"/><text class="axl" x="{(L+W-R)/2}" y="{H-12}" text-anchor="middle">{e(xlabel)}</text>')
    g.append(f'<text class="axl" transform="translate(14 {(T+H-B)/2}) rotate(-90)" text-anchor="middle">Quality vs reference labels (0–1)</text>')
    pts = [(X(r[xkey]), Y(r["quality"]), r) for r in rows]
    boxes = [(x - 7, y - 7, x + 7, y + 7) for x, y, _ in pts]          # dots are obstacles too
    hit = lambda b: any(not (b[2] < o[0] or b[0] > o[2] or b[3] < o[1] or b[1] > o[3]) for o in boxes)  # noqa: E731
    for x, y, r in sorted(pts, key=lambda p: p[1]):
        w = 6.3 * len(r["model"]) + 4
        spots = [(10, 4), (-10, 4), (10, -12), (-10, -12), (10, 18), (-10, 18), (10, -26), (-10, -26), (10, 32), (-10, 32), (10, -40), (-10, 40)]
        for dx, dy in spots:
            lx, ly = x + dx, y + dy
            b = (lx, ly - 11, lx + w, ly + 3) if dx > 0 else (lx - w, ly - 11, lx, ly + 3)
            if b[0] >= L and b[2] <= W - R and b[1] >= T - 4 and b[3] <= H - B and not hit(b):
                break
        boxes.append(b)
        anchor = "start" if dx > 0 else "end"
        lead = f'<line x1="{x:.1f}" y1="{y:.1f}" x2="{lx - (2 if dx > 0 else -2):.1f}" y2="{ly - 4:.1f}" stroke="var(--ink2)" stroke-width="0.8"/>' if abs(dy) > 12 else ""
        tip = e(f'{r["model"]} ({r["model_id"]})\nquality {r["quality"]:.2f} (aerial {r["q_aerial"]:.2f}, facade {r["q_facade"]:.2f})\n'
                f'{r["latency_s"]:.1f} s/image · ${r["usd_per_building"]:.5f}/building · valid {r["valid"]}/{r["n"]}')
        g.append(f'<g class="pt{" ref" if "ref" in r["model"] else ""}" tabindex="0"><title>{tip}</title>{lead}<circle cx="{x:.1f}" cy="{y:.1f}" r="6"/>'
                 f'<text class="lbl" x="{lx:.1f}" y="{ly:.1f}" text-anchor="{anchor}">{e(r["model"])}</text></g>')
    return "".join(g) + "</svg>"


def chart_page(rows) -> str:
    plotted = [r for r in rows if r["valid"]]
    dropped = [r["model"] for r in rows if not r["valid"]]
    trs = "".join(f'<tr><td>{e(r["model"])}<br><span class="note">{e(r["model_id"])}</span></td><td>{r["quality"]:.2f}</td><td>{r["q_aerial"]:.2f}</td>'
                  f'<td>{r["q_facade"]:.2f}</td><td>{r["latency_s"]:.1f}</td><td>{r["p90_s"]:.1f}</td><td>${r["usd_per_building"]:.5f}</td>'
                  f'<td>{r["valid"]}/{r["n"]}</td><td>{r["in_tok"]}</td><td>{r["out_tok"]}</td></tr>' for r in sorted(rows, key=lambda r: -r["quality"]))
    return (f"<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
            f"<title>VLM benchmark</title><style>{CSS}</style></head><body><main><h1>Small vision models: quality vs cost and speed</h1>"
            f"<p class=sub>Together AI serverless models on the production image tasks (aerial orthophoto + street-level facade), 4 real Geneva "
            f"buildings × 2 runs, production prompts and JSON schemas. Quality = agreement with reference labels on clearly visible features.</p>"
            f"<div class=legend><span><span class=dot style='background:var(--s1)'></span>small / cheap models</span>"
            f"<span><span class=dot style='background:var(--s2)'></span>large reference model</span></div>"
            f"<div class=panels>{panel(plotted, 'usd_per_building', 'Cost per building (USD, 2 images, log scale)', log=True, fmt=lambda v: f'${v:g}')}"
            f"{panel(plotted, 'latency_s', 'Average time per image (s)')}</div>"
            + (f"<p class=note>Not plotted (no valid JSON in any run): {e(', '.join(dropped))}.</p>" if dropped else "") +
            f"<div class=wrap><table><thead><tr><th>Model</th><th>Quality</th><th>Aerial</th><th>Facade</th><th>Mean s</th><th>p90 s</th>"
            f"<th>$/building</th><th>Valid JSON</th><th>In tok</th><th>Out tok</th></tr></thead><tbody>{trs}</tbody></table></div>"
            f"<p class=note>Cost from token usage × Together list price. Reasoning tokens count as output. Upper-left is better in both panels; the quality axis is zoomed. "
            f"Labels: benchmark/vlm/labels.json (visual inspection, only unambiguous fields).</p></main></body></html>")


def example_page(best: str, ref: str) -> str:
    recs = [json.loads(x) for x in RESULTS.read_text().splitlines()]
    pick = {(r["model"], r["task"], r["case"]): r for r in recs if r["rep"] == 0}
    blocks = []
    for task, img_name in (("aerial", "orthophoto.jpg"), ("facade", "facade_streetview.jpg")):
        case = "cmds-sa"
        b64 = base64.b64encode((HERE / "images" / f"{case}__{img_name}").read_bytes()).decode()
        cols = []
        for m in (best, ref):
            r = pick.get((m, task, case))
            if not r:
                continue
            marks = " · ".join(f'<span class="{ "ok" if v == 1 else "part" if v > 0 else "bad"}">{e(k)} {"✓" if v == 1 else "~" if v > 0 else "✗"}</span>'
                               for k, v in r["fields"].items())
            cols.append(f'<h3>{e(m)} <span class=note>quality {r["quality"]:.2f} · {r["latency_s"]:.1f} s · ${r["usd"]:.5f}</span></h3>'
                        f'<p class=note>{marks}</p><pre style="white-space:pre-wrap;font-size:12px">{e(json.dumps(r["output"], ensure_ascii=False, indent=1))}</pre>')
        blocks.append(f'<h2>{"Aerial orthophoto" if task == "aerial" else "Street-level facade"} — {e(LABELS["cases"][case]["company"])}</h2>'
                      f'<div class=ex><div><img src="data:image/jpeg;base64,{b64}" alt="{e(img_name)}"><p class=note>Input image '
                      f'({"SWISSIMAGE orthophoto, insured footprint outlined in red" if task == "aerial" else "Google Street View, demo source"}). '
                      f'Reference: {e(LABELS[task][case].get("_notes", ""))}</p></div><div>{"".join(cols)}</div></div>')
    return (f"<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content='width=device-width,initial-scale=1'>"
            f"<title>VLM extraction example</title><style>{CSS}</style></head><body><main><h1>Example: image → extracted features</h1>"
            f"<p class=sub>Same prompt and JSON schema as production (src/prompts.py). ✓ matches the reference label, ~ partly, ✗ wrong.</p>"
            + "".join(blocks) + "</main></body></html>")


def shot(page: Path, png: Path, height: int):
    chrome = shutil.which("google-chrome") or shutil.which("chromium")
    if chrome:
        subprocess.run([chrome, "--headless=new", "--no-sandbox", "--hide-scrollbars", "--force-device-scale-factor=2",
                        f"--window-size=1060,{height}", f"--screenshot={png.resolve()}", page.resolve().as_uri()], capture_output=True, timeout=120)


def main():
    rows = json.loads(SUMMARY.read_text())
    (HERE / "vlm_benchmark.html").write_text(chart_page(rows), encoding="utf-8")
    shot(HERE / "vlm_benchmark.html", HERE / "vlm_benchmark.png", 520 + 34 * len(rows) + 260)
    small = [r for r in rows if "ref" not in r["model"] and r["valid"] == r["n"]] or rows
    best = max(small, key=lambda r: (r["quality"], -r["usd_per_building"]))["model"]
    ref = next((r["model"] for r in rows if "ref" in r["model"]), best)
    (HERE / "example.html").write_text(example_page(best, ref), encoding="utf-8")
    shot(HERE / "example.html", HERE / "example.png", 1700)
    print("best small model:", best, "| reference:", ref)


if __name__ == "__main__":
    main()
