// Underwriter dashboard (back-office). Spec: docs/FRONTEND_INTEGRATION.md. Never linked from the client app.
// Narrative comes from output.json; every value, source, image and status from features_combined.json (§1).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  buildIndex, resolve, humanise, fmtInline, fmtRange, fmtShare, isRange, isSynthetic, loadFromApi, loadFromFiles,
  READINESS, STATUS, PRICING, TARGET, PRIORITY_ORDER, FINDING_TYPE, type CaseData, type Index,
} from "./data"

const TABS = ["Overview", "COPE", "Hazards", "Evidence", "Valuation", "Questions", "Export"] as const
type Tab = (typeof TABS)[number]

export default function Dashboard() {
  const [cases, setCases] = useState<CaseData[] | null>(null)
  const [api, setApi] = useState(true)
  const [open, setOpen] = useState<string | null>(() => new URLSearchParams(location.search).get("case"))
  const pick = useRef<HTMLInputElement>(null)

  const reload = () => loadFromApi().then((c) => { if (c) setCases(c); else { setApi(false); setCases((p) => p ?? []) } })
  useEffect(() => { reload() }, [])
  useEffect(() => { const u = new URL(location.href); if (open) u.searchParams.set("case", open); else { u.searchParams.delete("case"); u.searchParams.delete("tab") } history.replaceState(null, "", u) }, [open])
  const onFolder = async (e: React.ChangeEvent<HTMLInputElement>) => { if (e.target.files?.length) { const c = await loadFromFiles(e.target.files); setCases((p) => [...c, ...(p || []).filter((x) => !c.some((y) => y.id === x.id))]) } }

  const current = cases?.find((c) => c.id === open)
  return (
    <div className="db">
      <header className="db-top no-print">
        <button type="button" className="db-brand" onClick={() => setOpen(null)}>
          <i><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round"><path d="M3 11l9-7 9 7v9H3z" /><path d="M9 20v-6h6v6" /></svg></i>
          Alpenmark <span>Underwriting</span>
        </button>
        <div className="db-top-actions">
          {api && <button type="button" className="db-btn ghost" onClick={reload}>Refresh</button>}
          <button type="button" className="db-btn ghost" onClick={() => pick.current?.click()}>Open a case folder</button>
          <input ref={pick} type="file" hidden multiple onChange={onFolder} {...({ webkitdirectory: "", directory: "" } as any)} />
        </div>
      </header>
      {!cases ? <p className="db-muted db-pad">Loading cases…</p>
        : current ? <CasePage c={current} onBack={() => setOpen(null)} />
        : <CaseList cases={cases} api={api} onOpen={setOpen} />}
    </div>
  )
}

/* ---------------- §2 case list ---------------- */
function CaseList({ cases, api, onOpen }: { cases: CaseData[]; api: boolean; onOpen: (id: string) => void }) {
  const rows = [...cases].sort((a, b) => String(b.metrics?.finished_at || "").localeCompare(String(a.metrics?.finished_at || "")))
  return (
    <main className="db-pad">
      <div className="db-head"><h1>Cases</h1><p className="db-muted">{rows.length} case{rows.length === 1 ? "" : "s"} · {api ? "reports/ folder" : "opened from disk"}</p></div>
      {!rows.length ? (
        <div className="db-card db-empty">
          <p><b>No case yet.</b> Generate one with <code>python -m src.report --input input.json --output reports/&lt;case&gt;</code> (repo root), then refresh — or open a case folder from disk.</p>
        </div>
      ) : (
        <div className="db-card db-tablewrap">
          <table className="db-table">
            <thead><tr><th>Case</th><th>Company · address</th><th>Client</th><th>Industry (declared / register)</th><th>Readiness</th><th className="num">Findings</th><th className="num">Questions</th><th>Report</th><th>Date</th></tr></thead>
            <tbody>
              {rows.map((c) => {
                const ix = buildIndex(c.bundle, c.output), cs = c.bundle?.case || {}, st = c.metrics?.status
                const qs = c.output?.open_questions || [], blocking = qs.filter((q: any) => q.blocking_initial_pricing).length
                const ready = c.output?.executive_summary?.underwriting_readiness
                const available = (st ? st === "succeeded" : true) && !!c.output
                return (
                  <tr key={c.id} onClick={() => onOpen(c.id)} tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") onOpen(c.id) }}>
                    <td><b>{c.output?.case_id || cs.case_id || c.id}</b>{isSynthetic(c) && <span className="db-tag synth">Synthetic</span>}</td>
                    <td>{cs.legal_company_name || "—"}<div className="db-muted">{cs.building_address || ""}</div></td>
                    <td>{cs.client_name || "—"}</td>
                    <td>{ix.facts.get("ev.declared_industry")?.value?.label || "—"}<div className="db-muted">{fmtInline(ix.facts.get("feat.business_sector")?.value) ?? "—"}</div></td>
                    <td>{ready ? <Pill kind={READINESS[ready]?.[1] || "grey"}>{READINESS[ready]?.[0] || ready}</Pill> : "—"}</td>
                    <td className="num">{c.output ? c.output.priority_findings?.length ?? 0 : "—"}</td>
                    <td className="num">{c.output ? <>{qs.length}{blocking ? <span className="db-muted"> · {blocking} blocking</span> : null}</> : "—"}</td>
                    <td><RunState st={st} available={available} /></td>
                    <td className="db-muted">{(c.metrics?.finished_at || cs.created_at || "").slice(0, 10) || "—"}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}
function RunState({ st, available }: { st?: string; available: boolean }) {
  if (st === "running") return <Pill kind="blue">Generating…</Pill>
  if (st === "invalid_report") return <Pill kind="red">Invalid report</Pill>
  if (st === "failed") return <Pill kind="red">Pipeline failed</Pill>
  return available ? <Pill kind="ok">Available</Pill> : <Pill kind="grey">No report</Pill>
}

/* ---------------- §3 case page ---------------- */
function CasePage({ c, onBack }: { c: CaseData; onBack: () => void }) {
  const [tab, setTab] = useState<Tab>(() => { const q = new URLSearchParams(location.search).get("tab"); return (TABS as readonly string[]).includes(q || "") ? (q as Tab) : "Overview" })
  useEffect(() => { const u = new URL(location.href); u.searchParams.set("tab", tab); history.replaceState(null, "", u) }, [tab])
  const r = c.output, b = c.bundle, m = c.metrics
  const ix = useMemo(() => buildIndex(b, r), [b, r])
  const synthetic = isSynthetic(c)
  const st = m?.status
  const etl = (m?.stages || []).find((s: any) => s.stage === "etl")
  const showReport = !!r && (!st || st === "succeeded")

  return (
    <main className="db-pad">
      <button type="button" className="db-back no-print" onClick={onBack}>← All cases</button>
      {synthetic && <div className="db-banner synth">SYNTHETIC CASE — fictional data for testing, not usable for real underwriting.</div>}

      {/* §6 pipeline states */}
      {st === "running" && <div className="db-banner info">Report being generated — current stage: <b>{m.stages?.[m.stages.length - 1]?.stage || "starting"}</b>.</div>}
      {st === "invalid_report" && (
        <div className="db-banner err"><b>The model's report did not pass validation.</b> It is not shown.
          <ul>{(m.validation?.issues || []).filter((i: any) => i.severity === "error").map((i: any, k: number) => <li key={k}><code>{i.code}</code> {i.path}: {i.message}</li>)}</ul>
        </div>
      )}
      {st === "failed" && <div className="db-banner err"><b>Pipeline failed</b>{m.error?.stage ? <> at stage <code>{m.error.stage}</code></> : null}: {m.error?.message || "no detail"}</div>}
      {etl?.status === "warning" && (
        <div className="db-banner warn">Some sources were unavailable — the report is valid but built on less evidence.
          {etl.evidence_blocks && <span className="db-muted"> {Object.entries(etl.evidence_blocks).filter(([, v]) => v !== "ok").map(([k, v]) => `${humanise(k)}: ${v}`).join(" · ")}</span>}
        </div>
      )}

      <div className="db-head">
        <h1>{r?.executive_summary?.headline || b?.case?.legal_company_name || c.id}</h1>
        <div className="db-head-meta">
          {r?.executive_summary?.underwriting_readiness && <Pill kind={READINESS[r.executive_summary.underwriting_readiness]?.[1] || "grey"} big>{READINESS[r.executive_summary.underwriting_readiness]?.[0]}</Pill>}
          <span className="db-muted">Case {r?.case_id || b?.case?.case_id || c.id}</span>
        </div>
      </div>

      <nav className="db-tabs no-print" role="tablist">
        {TABS.map((t) => <button key={t} type="button" role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{t}</button>)}
      </nav>

      {/* every panel is rendered; only the active one shows on screen, all of them in print */}
      <Panel on={tab === "Overview"} title="Overview">{showReport ? <Overview r={r} b={b} ix={ix} /> : <Identity b={b} />}</Panel>
      {showReport && <>
        <Panel on={tab === "COPE"} title="COPE"><Cope r={r} ix={ix} /></Panel>
        <Panel on={tab === "Hazards"} title="Hazards"><Hazards r={r} ix={ix} /></Panel>
        <Panel on={tab === "Evidence"} title="Evidence"><Evidence c={c} r={r} b={b} ix={ix} synthetic={synthetic} /></Panel>
        <Panel on={tab === "Valuation"} title="Valuation"><Valuation r={r} ix={ix} /></Panel>
        <Panel on={tab === "Questions"} title="Outstanding questions"><Questions r={r} ix={ix} /></Panel>
      </>}
      {!showReport && tab !== "Overview" && tab !== "Export" && <p className="db-muted">No valid report for this case.</p>}
      <Panel on={tab === "Export"} title="Export" noPrint><Export c={c} /></Panel>
    </main>
  )
}
function Panel({ on, title, children, noPrint }: { on: boolean; title: string; children: ReactNode; noPrint?: boolean }) {
  return <section className={"db-panel" + (on ? " on" : "") + (noPrint ? " no-print" : "")} role="tabpanel"><h2 className="print-only">{title}</h2>{children}</section>
}

/* §3.1 */
function Overview({ r, b, ix }: { r: any; b: any; ix: Index }) {
  const es = r.executive_summary || {}
  const top = [...(r.priority_findings || [])].sort((x, y) => (PRIORITY_ORDER[x.priority] ?? 9) - (PRIORITY_ORDER[y.priority] ?? 9)).slice(0, 5)
  return (
    <div className="db-grid2">
      <div className="db-stack">
        <div className="db-card"><div className="db-card-b"><p>{es.overview}</p>{es.key_takeaway && <div className="db-callout">{es.key_takeaway}</div>}<Chips ids={es.critical_fact_ids} ix={ix} /></div></div>
        {r.underwriter_next_step && <div className="db-card db-next"><div className="db-card-h">Next step for the underwriter</div><div className="db-card-b">{r.underwriter_next_step}</div></div>}
        <h3 className="db-h3">Priority findings</h3>
        {top.map((f) => <FindingCard key={f.id} f={f} r={r} ix={ix} />)}
        {(r.priority_findings || []).length > 5 && <p className="db-muted">{r.priority_findings.length - 5} more finding(s) in print.</p>}
      </div>
      <Identity b={b} />
    </div>
  )
}
function Identity({ b }: { b: any }) {
  const cs = b?.case || {}, bd = b?.building || {}
  const rows: [string, ReactNode][] = [
    ["Company", cs.legal_company_name], ["Building address", cs.building_address], ["Client", cs.client_name],
    ["Company UID", bd.company_uid || <span className="db-unknown">Unknown</span>],
    ["EGID", bd.identity_resolution === "unique" && bd.egid ? bd.egid : <span className="db-unknown">Unresolved</span>],
    ["Canton", bd.canton], ["Evidence date", cs.created_at],
  ]
  return (
    <aside className="db-card db-identity">
      <div className="db-card-h">Identity</div>
      <dl className="db-card-b db-kv">{rows.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v ?? <span className="db-unknown">Unknown</span>}</dd></div>)}</dl>
    </aside>
  )
}

/* §3.4 */
function FindingCard({ f, r, ix }: { f: any; r: any; ix: Index }) {
  const related = (r.open_questions || []).filter((q: any) => (q.trigger_finding_ids || []).includes(f.id))
  return (
    <article className={"db-card db-finding p-" + f.priority} id={"finding-" + f.id}>
      <div className="db-card-h">
        <Pill kind={f.priority === "critical" ? "red" : f.priority === "high" ? "orange" : f.priority === "medium" ? "amber" : "grey"}>{f.priority}</Pill>
        <b>{f.title}</b>
        <span className="db-muted db-right">{FINDING_TYPE[f.finding_type] || f.finding_type} · confidence {f.confidence}</span>
      </div>
      <div className="db-card-b db-finding-b">
        <div><h4>Observation</h4><p>{f.observation}</p></div>
        <div><h4>Implication</h4><p>{f.underwriting_implication}</p></div>
        <div><h4>Recommended action</h4><p>{f.recommended_action}</p></div>
      </div>
      <div className="db-card-f">
        <Chips ids={[...(f.fact_ids || []), ...(f.evidence_ids || [])]} ix={ix} />
        {(f.coverage_components || []).length > 0 && <div className="db-tags">{f.coverage_components.map((x: string) => <span key={x} className="db-tag">{humanise(x)}</span>)}</div>}
        {related.map((q: any) => <div key={q.id} className="db-related">Related question: <b>{q.id}</b> — {q.question}{q.blocking_initial_pricing && <Pill kind="red">Blocks initial pricing</Pill>}</div>)}
      </div>
    </article>
  )
}

/* §3.2 */
function Cope({ r, ix }: { r: any; ix: Index }) {
  return (
    <div className="db-grid2 even">
      {(["construction", "occupancy", "protection", "exposure"] as const).map((k) => {
        const c = r.cope?.[k] || {}
        return (
          <div key={k} className="db-card">
            <div className="db-card-h"><span className="db-muted db-cap">{k}</span><b>{c.headline}</b></div>
            <div className="db-card-b"><p>{c.interpretation}</p><Chips ids={[...(c.fact_ids || []), ...(c.evidence_ids || [])]} ix={ix} /></div>
            {(c.unknown_feature_ids || []).length > 0 && (
              <div className="db-card-f"><h4>Gaps</h4><div className="db-chips">{c.unknown_feature_ids.map((id: string) => <span key={id} className="db-chip s-grey">{humanise(ix.facts.get(id)?.field_key || id)} · Unknown</span>)}</div></div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* §3.3 */
const INDUSTRIAL = ["site_industrial_processes", "high_temperature_operations", "gas_installations", "flammable_material_storage", "business_sector"]
function Hazards({ r, ix }: { r: any; ix: Index }) {
  const hz = r.hazard_interpretations || []
  const fire = hz.find((h: any) => h.peril === "fire")
  const ind = INDUSTRIAL.map((k) => ix.byKey.get(k)).filter(Boolean)
  return (
    <div className="db-stack">
      <div className="db-card db-tablewrap">
        <table className="db-table static">
          <thead><tr><th>Peril</th><th>Measurement</th><th>Interpretation</th><th>Pricing role</th><th>Follow-up</th></tr></thead>
          <tbody>{!hz.length && <tr><td colSpan={5} className="db-muted">No hazard interpreted in this report.</td></tr>}{hz.map((h: any, k: number) => {
            const meas = (h.fact_ids || []).map((id: string) => ix.facts.get(id)).filter((f: any) => f && /_exposure$|hazard|zone/.test(f.field_key))
            return (
              <tr key={k}>
                <td><b>{humanise(h.peril)}</b></td>
                <td>{meas.length ? meas.map((f: any) => <div key={f.id}><Value v={f.value} unit={f.unit} k={f.field_key} /></div>) : <span className="db-muted">—</span>}</td>
                <td>{h.interpretation}<Chips ids={[...(h.fact_ids || []), ...(h.evidence_ids || [])]} ix={ix} /></td>
                <td>{PRICING[h.pricing_role] || h.pricing_role}</td>
                <td>{h.follow_up_needed ? <span className="db-flag" title="Follow-up needed">⚑ Needed</span> : <span className="db-muted">—</span>}</td>
              </tr>
            )
          })}</tbody>
        </table>
      </div>
      <p className="db-note">Swiss private natural-hazards cover is written at a regulated tariff; hazard data supports underwriting and prevention, not an individual surcharge.</p>
      {(ind.length > 0 || fire) && (
        <div className="db-card">
          <div className="db-card-h"><b>Industrial fire exposure</b></div>
          <div className="db-card-b">
            {fire && <p>{fire.interpretation}</p>}
            {ind.length > 0 && <dl className="db-kv">{ind.map((f: any) => <div key={f.id}><dt>{humanise(f.field_key)}</dt><dd><Value v={f.value} unit={f.unit} k={f.field_key} /> <StatusBadge f={f} /></dd></div>)}</dl>}
          </div>
        </div>
      )}
    </div>
  )
}

/* §3.5 + §5 */
function Evidence({ c, r, b, ix, synthetic }: { c: CaseData; r: any; b: any; ix: Index; synthetic: boolean }) {
  const cited = useMemo(() => new Set(JSON.stringify(r).match(/"(src_\d+|SRC\d+)"/g)?.map((s) => s.slice(1, -1)) || []), [r])
  const warns = [...(c.validation?.issues || []), ...(c.metrics?.validation?.issues || [])].filter((i: any) => i.severity === "warning")
  return (
    <div className="db-stack">
      {(r.visual_evidence || []).length > 0 && <><h3 className="db-h3">Images</h3><div className="db-grid2 even">{r.visual_evidence.map((v: any) => <VisualCard key={v.visual_id} sel={v} c={c} ix={ix} synthetic={synthetic} />)}</div></>}
      <h3 className="db-h3">Sources</h3>
      <div className="db-card"><ul className="db-sources">{(b.sources || []).map((s: any) => (
        <li key={s.id}><code>{s.id}</code> <b>{s.provider}</b> — {s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> : s.title}
          <span className="db-muted"> · retrieved {s.retrieved_at || "?"}{s.usage_or_attribution ? ` · ${s.usage_or_attribution}` : ""}</span>{!cited.has(s.id) && <span className="db-tag">not cited</span>}</li>
      ))}</ul></div>
      <h3 className="db-h3">Evidence register</h3>
      <div className="db-card db-tablewrap">
        <table className="db-table static">
          <thead><tr><th>ID</th><th>Field</th><th>Value</th><th>Status</th><th>Scope</th><th>Confidence</th><th>Sources</th></tr></thead>
          <tbody>{(b.facts || []).map((f: any) => (
            <tr key={f.id}>
              <td><code>{f.id}</code></td><td>{humanise(f.field_key)}</td><td className="db-val"><Value v={f.value} unit={f.unit} k={f.field_key} long /></td>
              <td><StatusBadge f={f} /></td><td>{scopeLabel(f.site_scope)}</td><td>{f.confidence}</td>
              <td><Chips ids={f.source_ids || []} ix={ix} /></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      {((b.quality_flags || []).length > 0 || warns.length > 0) && <>
        <h3 className="db-h3">Data quality notes</h3>
        <div className="db-card"><ul className="db-sources">
          {(b.quality_flags || []).map((q: string, k: number) => <li key={"q" + k}>{q.startsWith("CONFLICT") && <span className="db-warn">⚠ </span>}{q}</li>)}
          {warns.map((w: any, k: number) => <li key={"w" + k}><code>{w.code}</code> {w.message}</li>)}
        </ul></div>
      </>}
    </div>
  )
}
const scopeLabel = (s: string) => (s === "company" ? "company-wide, not confirmed at this building" : humanise(s || "unknown"))

function VisualCard({ sel, c, ix, synthetic }: { sel: any; c: CaseData; ix: Index; synthetic: boolean }) {
  const v = ix.visuals.get(sel.visual_id)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const [all, setAll] = useState(false)
  const src = v ? c.url(v.asset_uri) : null
  const shown = (v?.annotations || []).filter((a: any) => all || (sel.annotation_ids || []).includes(a.id))
  const pts = (a: any) => {
    const xs: number[] = a.coordinates_or_bbox || [], norm = xs.every((n) => n >= 0 && n <= 1)
    return xs.map((n, i) => (norm && size ? n * (i % 2 ? size.h : size.w) : n))
  }
  const style = (p: string) => (p === "geospatial_geometry" ? { stroke: "#d62828", dash: "" } : p === "vision_candidate" ? { stroke: "#f08c00", dash: "8 6" } : p === "human_annotation" ? { stroke: "#1f6feb", dash: "" } : { stroke: "#868e96", dash: "" })
  return (
    <article className="db-card db-visual">
      <div className="db-card-h"><b>{sel.title}</b>{synthetic && <span className="db-tag synth">Synthetic</span>}</div>
      <div className="db-img">
        {!v || !src || failed ? <div className="db-noimg">Image not available <code>{sel.visual_id}</code></div> : <>
          <img src={src} alt={v.alt_text || sel.title} onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} onError={() => setFailed(true)} />
          {size && <svg viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none" aria-hidden="true">
            {shown.map((a: any) => {
              const p = pts(a), s = style(a.provenance), sw = Math.max(2, size.w / 250), num = a.id.split(".").pop()?.replace(/^\D+/, "")
              const [x0, y0] = [p[0] ?? 0, p[1] ?? 0]
              return (
                <g key={a.id} fill="none" stroke={s.stroke} strokeWidth={sw} strokeDasharray={s.dash}>
                  {a.geometry_type === "bounding_box" ? <rect x={p[0]} y={p[1]} width={p[2] - p[0]} height={p[3] - p[1]} />
                    : a.geometry_type === "point" ? <circle cx={x0} cy={y0} r={sw * 4} />
                    : a.geometry_type === "line" ? <polyline points={p.join(" ")} />
                    : <polygon points={p.join(" ")} />}
                  <g transform={`translate(${x0},${y0})`}><circle r={sw * 6} fill={s.stroke} stroke="#fff" strokeWidth={sw / 2} /><text textAnchor="middle" dominantBaseline="central" fill="#fff" stroke="none" fontSize={sw * 6} fontWeight={700}>{num}</text></g>
                </g>
              )
            })}
          </svg>}
        </>}
      </div>
      <div className="db-card-b">
        <p>{sel.caption}</p>
        <p className="db-muted">{sel.underwriting_relevance}</p>
        {(v?.annotations || []).length > 0 && <ul className="db-legend">{(all ? v.annotations : shown).map((a: any) => <li key={a.id}><code>{a.id.split(".").pop()}</code> {a.label} <span className="db-muted">· {a.provenance === "vision_candidate" ? "AI candidate, to verify" : humanise(a.provenance)} · {a.confidence}</span></li>)}</ul>}
        {(v?.annotations || []).length > (sel.annotation_ids || []).length && <button type="button" className="db-link" onClick={() => setAll(!all)}>{all ? "Show selected annotations" : "Show all annotations"}</button>}
        <Chips ids={sel.fact_ids || []} ix={ix} />
        {v && <p className="db-attr">{(v.source_ids || []).map((id: string) => { const s = ix.sources.get(id); return s ? `${s.provider}${s.usage_or_attribution ? " — " + s.usage_or_attribution : ""}` : id }).join(" · ")} · {v.captured_or_published_at || "date unknown"} · {v.building_egid ? `building EGID ${v.building_egid}` : "not linked to the insured building"}</p>}
      </div>
    </article>
  )
}

/* §3.6 */
function Valuation({ r, ix }: { r: any; ix: Index }) {
  const vc = r.valuation_commentary || {}, f = ix.byKey.get("reconstruction_value_chf")
  return (
    <div className="db-grid2 even">
      <div className="db-card">
        <div className="db-card-h"><b>Reconstruction value</b></div>
        <div className="db-card-b">
          <p className="db-big">{f ? (isRange(f.value) ? fmtRange(f.value) : <Value v={f.value} unit={f.unit} k={f.field_key} />) : <span className="db-unknown">Unknown</span>} {f && <StatusBadge f={f} />}</p>
          {f?.method && <p className="db-small">{f.method}</p>}
          <p className="db-note">Indicative range, not an appraisal.</p>
          <p>{vc.reconstruction_value_comment}</p>
          <h4>Market value</h4><p>{vc.market_value_comment}</p>
          <Chips ids={vc.fact_ids || []} ix={ix} />
        </div>
      </div>
      <div className="db-card">
        <div className="db-card-h"><b>Missing valuation inputs</b></div>
        <div className="db-card-b">{(vc.missing_valuation_inputs || []).length ? <ul>{vc.missing_valuation_inputs.map((x: string, k: number) => <li key={k}>{x}</li>)}</ul> : <p className="db-muted">None listed.</p>}</div>
      </div>
    </div>
  )
}

/* §3.7 */
function Questions({ r, ix }: { r: any; ix: Index }) {
  const qs = [...(r.open_questions || [])].sort((a, b) => Number(!!b.blocking_initial_pricing) - Number(!!a.blocking_initial_pricing) || (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9))
  return (
    <div className="db-stack">
      {r.underwriter_next_step && <div className="db-card db-next"><div className="db-card-h">Next step for the underwriter</div><div className="db-card-b">{r.underwriter_next_step}</div></div>}
      <div className="db-card db-tablewrap">
        <table className="db-table static">
          <thead><tr><th>Priority</th><th>Question</th><th>Why</th><th>Recipient</th><th>Expected document</th><th>Blocking</th><th>Features</th><th>Findings</th></tr></thead>
          <tbody>{qs.map((q) => (
            <tr key={q.id}>
              <td><Pill kind={q.priority === "critical" ? "red" : q.priority === "high" ? "orange" : q.priority === "medium" ? "amber" : "grey"}>{q.priority}</Pill></td>
              <td><b>{q.question}</b> <span className="db-muted">{q.id}</span></td>
              <td>{q.reason_for_underwriter}</td><td>{TARGET[q.target] || q.target}</td><td>{q.expected_answer_or_document}</td>
              <td>{q.blocking_initial_pricing ? <b className="db-warn">Yes</b> : "No"}</td>
              <td><Chips ids={q.feature_ids || []} ix={ix} /></td>
              <td>{(q.trigger_finding_ids || []).map((id: string) => <a key={id} className="db-findlink" href={"#finding-" + id}>{id}</a>)}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}

/* §3.8 */
function Export({ c }: { c: CaseData }) {
  const dl = (obj: unknown, name: string) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000) }
  const id = c.output?.case_id || c.id
  return (
    <div className="db-card"><div className="db-card-b db-stack">
      <p>Print or save as PDF: every tab is printed in order (the synthetic banner is kept).</p>
      <div className="db-row">
        <button type="button" className="db-btn" onClick={() => print()}>Print / PDF</button>
        {c.output && <button type="button" className="db-btn ghost" onClick={() => dl(c.output, `${id}.output.json`)}>Download output.json</button>}
        {c.bundle && <button type="button" className="db-btn ghost" onClick={() => dl(c.bundle, `${id}.features_combined.json`)}>Download features_combined.json</button>}
      </div>
      <p className="db-muted">metrics.json and output.invalid.json are internal and never exported.</p>
      {c.metrics && <details className="db-run"><summary>Internal run details</summary>
        <p>Model {c.metrics.model_config || "?"} · {c.metrics.duration_s ?? "?"} s · tokens in {c.metrics.llm?.input_tokens ?? "?"} / out {c.metrics.llm?.output_tokens ?? "?"} · USD {c.metrics.total_usd ?? "?"}</p>
        <ul>{(c.metrics.stages || []).map((s: any, k: number) => <li key={k}><code>{s.stage}</code> {s.status} {s.detail ? "· " + s.detail : ""}</li>)}</ul>
      </details>}
    </div></div>
  )
}

/* ---------------- §4 chips, values, badges ---------------- */
function Chips({ ids, ix }: { ids?: string[]; ix: Index }) {
  if (!ids?.length) return null
  return <div className="db-chips">{[...new Set(ids)].map((id) => <Chip key={id} id={id} ix={ix} />)}</div>
}
function Chip({ id, ix }: { id: string; ix: Index }) {
  const [open, setOpen] = useState(false)
  const res = resolve(ix, id)
  if (res.kind === "unresolved") return <span className="db-chip s-off" title="Not found in the evidence register">{id} · unresolved</span>
  if (res.kind === "source") { const s = res.item; return s.url ? <a className="db-chip s-src" href={s.url} target="_blank" rel="noreferrer" title={s.title}>{id}</a> : <span className="db-chip s-src" title={`${s.provider} — ${s.title}`}>{id}</span> }
  if (res.kind === "visual" || res.kind === "annotation") return <span className="db-chip s-src" title={res.item.label || res.item.alt_text}>{res.kind === "visual" ? "Image" : "Annotation"} {id.split(".").pop()}</span>
  const f = res.item, [lab, cls] = STATUS[f.evidence_status] || [f.evidence_status, "grey"]
  return (
    <span className="db-chipwrap">
      <button type="button" className={"db-chip s-" + cls} aria-expanded={open} onClick={() => setOpen(!open)} title={lab}>{humanise(f.field_key)}</button>
      {open && <span className="db-pop" role="dialog">
        <b>{humanise(f.field_key)}</b> <code>{f.id}</code>
        <span className="db-pop-v"><Value v={f.value} unit={f.unit} k={f.field_key} long /></span>
        <span className="db-muted">{lab} · {scopeLabel(f.site_scope)} · confidence {f.confidence}</span>
        {f.method && <span className="db-small">{f.method}</span>}
        {(f.source_ids || []).length > 0 && <span>{f.source_ids.map((s: string) => { const so = ix.sources.get(s); return so?.url ? <a key={s} href={so.url} target="_blank" rel="noreferrer">{so.provider} </a> : <span key={s}>{so?.provider || s} </span> })}</span>}
      </span>}
    </span>
  )
}
function StatusBadge({ f }: { f: any }) { const [lab, cls] = STATUS[f.evidence_status] || [f.evidence_status, "grey"]; return <span className={"db-chip s-" + cls + " static"}>{cls === "conflict" ? "⚠ " : ""}{lab}</span> }
function Value({ v, unit, k, long }: { v: any; unit?: string | null; k: string; long?: boolean }): JSX.Element {
  const s = fmtInline(v, unit)
  if (s !== null) return v === null || v === undefined ? <span className="db-unknown">Unknown</span> : <>{s}</>
  if (Array.isArray(v)) return <ul className="db-list">{v.map((x, i) => <li key={i}><Value v={x} k={k} /></li>)}</ul>
  const entries = Object.entries(v)
  const body = <dl className="db-kv small">{entries.map(([kk, x]) => <div key={kk}><dt>{humanise(kk)}</dt><dd>{typeof x === "object" && x !== null ? <Value v={x} k={kk} /> : String(fmtShare(kk, x) ?? "Unknown")}</dd></div>)}</dl>
  return long && (k.startsWith("ev.") || entries.length > 4) ? <details><summary>{entries.length} fields</summary>{body}</details> : body
}
function Pill({ kind, children, big }: { kind: string; children: ReactNode; big?: boolean }) { return <span className={"db-pill k-" + kind + (big ? " big" : "")}>{children}</span> }
