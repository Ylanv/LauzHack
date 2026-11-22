// Underwriter dashboard (back-office), Jira-like: each generated report is a ticket in a queue.
// Data contract: docs/FRONTEND_INTEGRATION.md. Narrative from output.json; every value, source, image and status from
// features_combined.json. Never linked from the client app.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  buildIndex, resolve, humanise, fmtInline, fmtHazard, fmtRange, fmtShare, isRange, isSynthetic, loadFromApi, type LoadProblem,
  READINESS, STATUS, PRICING, TARGET, PRIORITY_ORDER, FINDING_TYPE, type CaseData, type Index,
} from "./data"
import DeskCompanion, { type DeskLine } from "./DeskCompanion"
import type { BaseEmotion, Reaction } from "../mascot/emotion"
import { getTicket, saveTicket, statusOf, inQueue, topPriority, QUEUES, STATUS_LABEL, STATUS_TONE, WORKFLOW, type Queue, type Status, type Ticket } from "./tickets"
import { Wordmark } from "../brand/Brand"

/** close a pop-up (menu, popover) on a click outside it or on Escape */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close() }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close() }
    document.addEventListener("pointerdown", onDown); document.addEventListener("keydown", onKey)
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey) }
  }, [open, close])
  return ref
}

const keyOf = (c: CaseData) => String(c.output?.case_id || c.bundle?.case?.case_id || c.id).toUpperCase()
/** Live job keys are long (COMPANY-SLUG-YYYYMMDD-HHMMSS-HASH). In the queue: company slug (max 12 chars) + the last 4
 *  hash characters, e.g. "CMDS-SA…19DF"; the full key shows on hover and on the ticket page. */
const shortKey = (k: string) => {
  const m = k.match(/^(.*?)-\d{8}-\d{6}-([0-9A-Z]+)$/)
  if (m) return (m[1].length > 12 ? m[1].slice(0, 12).replace(/-+$/, "") : m[1]) + "…" + m[2].slice(-4)
  return k.length > 16 ? k.slice(0, 14).replace(/-+$/, "") + "…" : k
}

export default function Dashboard() {
  const [cases, setCases] = useState<CaseData[] | null>(null)
  const [problem, setProblem] = useState<{ kind: LoadProblem; detail?: string } | null>(null)
  const [open, setOpen] = useState<string | null>(() => new URLSearchParams(location.search).get("case"))
  const [queue, setQueue] = useState<Queue>("open")
  const [, bump] = useState(0)   // re-render after a ticket change
  // the ticket list comes straight from the report folders; it refreshes itself every 20 s (new or finished tickets).
  // A failed refresh never empties a loaded list; with nothing loaded yet, the problem is shown and retried after 5 s.
  const retry = useRef<number | undefined>(undefined)
  const load = useCallback(() => {
    clearTimeout(retry.current)
    return loadFromApi().then((r) => {
      if ("cases" in r) { setCases(r.cases); setProblem(null); return }
      setProblem({ kind: r.problem, detail: r.detail })
      retry.current = window.setTimeout(load, 5000)
    })
  }, [])
  useEffect(() => {
    load(); const id = setInterval(load, 20000)
    return () => { clearInterval(id); clearTimeout(retry.current) }
  }, [load])
  useEffect(() => { const u = new URL(location.href); if (open) u.searchParams.set("case", open); else u.searchParams.delete("case"); history.replaceState(null, "", u) }, [open])
  // the companion: what it says, with the matching emotion
  const [line, setLine] = useState<DeskLine | null>(null)
  const say = (text: string, base?: BaseEmotion, react?: Reaction) => setLine((p) => ({ text, base, react, n: (p?.n ?? 0) + 1 }))

  const update = (id: string, patch: Partial<Ticket>) => {
    const before = getTicket(id), c = cases?.find((x) => x.id === id)
    saveTicket(id, patch); bump((n) => n + 1)
    if (patch.status) {
      if (patch.status === "resolved") say("Ticket resolved. Nice work!", "idle", "success")
      else if (patch.status === "in_progress") say("On it: moved to In progress.", "thinking", "happy")
      else if (patch.status === "waiting_client") say("Waiting for the client's answers.", "concerned")
      else say("Back to review.", "idle")
    } else if ("assignee" in patch) {
      say(patch.assignee === "me" ? "Assigned to you." : "Unassigned.", "idle", patch.assignee === "me" ? "happy" : undefined)
    } else if (patch.answered) {
      const total = c?.output?.open_questions?.length ?? 0, n = patch.answered.length
      if (n <= (before.answered?.length ?? 0)) say("Question reopened.", "idle")
      else if (total && n >= total) say("All questions answered!", "idle", "success")
      else say(`Question answered. ${total - n} left.`, "idle", "happy")
    }
  }

  const rows = (cases || []).map((c) => { const t = getTicket(c.id); return { c, t, s: statusOf(c, t) } })
  const current = rows.find((x) => x.c.id === open)

  // opening a ticket: the companion sums it up; back on the list: how many are open
  const openCount = rows.filter((x) => inQueue("open", x.s, x.t)).length
  useEffect(() => {
    if (!cases) return
    if (!current) { say(openCount ? `${openCount} open ticket${openCount > 1 ? "s" : ""}.` : "No open ticket. All clear!", "idle", openCount ? undefined : "happy"); return }
    const { c, s } = current, r = c.output, blocking = (r?.open_questions || []).filter((q: any) => q.blocking_initial_pricing).length
    if (s === "generating") say("This report is still being generated…", "thinking")
    else if (s === "failed") say(`This report failed${c.metrics?.error?.stage ? ` at ${c.metrics.error.stage}` : ""}.`, "concerned", "error")
    else switch (r?.executive_summary?.underwriting_readiness) {
      case "ready_for_initial_review": say("Ready for initial review.", "idle", "happy"); break
      case "requires_clarification": say(`Needs clarification: ${blocking} blocking question${blocking === 1 ? "" : "s"}.`, "concerned"); break
      case "specialist_review_recommended": say("Specialist review recommended.", "concerned"); break
      case "building_identity_unresolved": say("Building identity unresolved: check the address.", "concerned", "error"); break
      default: say("Here is the report.", "idle")
    }
  }, [open, !!cases]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="jr">
      <aside className="jr-side no-print">
        <button type="button" className="jr-brand" onClick={() => setOpen(null)}>
          <Wordmark size={22} />
        </button>
        <p className="jr-side-h">Queues</p>
        <nav>{QUEUES.map(([q, label]) => (
          <button key={q} type="button" className={"jr-q" + (q === queue && !current ? " on" : "")} onClick={() => { setQueue(q); setOpen(null) }}>
            <span>{label}</span><span className="jr-count">{rows.filter((x) => inQueue(q, x.s, x.t)).length}</span>
          </button>
        ))}</nav>
      </aside>
      <main className="jr-main">
        {cases && problem && <p className="jr-notice">Connection problem: showing the last loaded list, retrying…</p>}
        {!cases ? (problem
            ? <p className="jr-notice">Could not load the reports ({problem.kind === "network" ? "the report service is not reachable" : problem.detail || "server error"}). Retrying…</p>
            : <p className="jr-muted">Loading…</p>)
          : !cases.length && !current ? <p className="jr-empty">No report yet. Reports appear here as soon as a request submitted from the client app is finished.</p>
          : current ? <Issue c={current.c} t={current.t} s={current.s} onBack={() => setOpen(null)} update={(p) => update(current.c.id, p)} queueLabel={QUEUES.find(([q]) => q === queue)![1]} />
          : <QueueView rows={rows.filter((x) => inQueue(queue, x.s, x.t))} title={QUEUES.find(([q]) => q === queue)![1]} onOpen={setOpen} update={update} />}
      </main>
      <DeskCompanion line={line} />
    </div>
  )
}

/* ---------------- queue (ticket list) ---------------- */
type SortKey = "type" | "key" | "summary" | "requester" | "assignee" | "priority" | "status" | "created"
const COLS: [SortKey, string][] = [["type", "Type"], ["key", "Key"], ["summary", "Summary"], ["requester", "Requester"], ["assignee", "Assignee"], ["priority", "Priority"], ["status", "Status"], ["created", "Created"]]
const STATUS_ORDER: Status[] = ["generating", "failed", "to_review", "in_progress", "waiting_client", "resolved"]
const createdOf = (c: CaseData) => String(c.metrics?.finished_at || c.metrics?.started_at || c.bundle?.case?.created_at || "")

function QueueView({ rows, title, onOpen, update }: { rows: { c: CaseData; t: Ticket; s: Status }[]; title: string; onOpen: (id: string) => void; update: (id: string, p: Partial<Ticket>) => void }) {
  // click a column header to sort by it (A→Z, then Z→A); Created sorts newest first, then oldest first
  const [sort, setSort] = useState<{ k: SortKey; dir: 1 | -1 }>({ k: "created", dir: -1 })
  const rowsX = rows.map((x) => {
    const ix = buildIndex(x.c.bundle, x.c.output), cs = x.c.bundle?.case || {}
    return { ...x, ix, cs, type: (ix.facts.get("ev.declared_industry")?.value?.label || "Building pre-assessment").split(" / ")[0], pr: topPriority(x.c.output) }
  })
  const val = (x: (typeof rowsX)[0]): string | number => {
    switch (sort.k) {
      case "type": return x.type
      case "key": return keyOf(x.c)
      case "summary": return x.cs.legal_company_name || keyOf(x.c)
      case "requester": return x.cs.client_name || ""
      case "assignee": return x.t.assignee === "me" ? "Me" : "~Unassigned"
      case "priority": return PRIORITY_ORDER[x.pr || "z"] ?? 9
      case "status": return STATUS_ORDER.indexOf(x.s)
      case "created": return createdOf(x.c)
    }
  }
  const sorted = [...rowsX].sort((a, b) => {
    const va = val(a), vb = val(b)
    const d = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), undefined, { sensitivity: "base", numeric: true })
    return d * sort.dir || createdOf(b.c).localeCompare(createdOf(a.c))
  })
  const click = (k: SortKey) => setSort((p) => (p.k === k ? { k, dir: (p.dir * -1) as 1 | -1 } : { k, dir: k === "created" ? -1 : 1 }))
  const dirLabel = (k: SortKey) => (k === "created" ? (sort.dir < 0 ? "newest first" : "oldest first") : k === "priority" ? (sort.dir > 0 ? "highest first" : "lowest first") : sort.dir > 0 ? "A to Z" : "Z to A")
  return (
    <>
      <h1 className="jr-h1">{title}</h1>
      {!sorted.length ? <p className="jr-empty">No case in this queue.</p> : (
        <table className="jr-table">
          <thead><tr>{COLS.map(([k, label]) => (
            <th key={k} aria-sort={sort.k === k ? (sort.dir > 0 ? "ascending" : "descending") : "none"}>
              <button type="button" className={"jr-sort" + (sort.k === k ? " on" : "")} onClick={() => click(k)} title={sort.k === k ? `Sorted ${dirLabel(k)}` : `Sort by ${label.toLowerCase()}`}>
                {label}<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{sort.k !== k ? <path d="M7 9l5-5 5 5M7 15l5 5 5-5" /> : sort.dir > 0 ? <path d="M6 15l6-6 6 6" /> : <path d="M6 9l6 6 6-6" />}</svg>
              </button>
            </th>
          ))}</tr></thead>
          <tbody>{sorted.map(({ c, t, s, cs, type, pr }) => (
            <tr key={c.id} className="jr-rowlink" tabIndex={0} aria-label={`Open ${cs.legal_company_name || keyOf(c)}`}
              onClick={(e) => { if (!(e.target as HTMLElement).closest("button, select, a, input, label, .jr-menu")) onOpen(c.id) }}
              onKeyDown={(e) => { if (e.key === "Enter" && e.target === e.currentTarget) onOpen(c.id) }}>
              <td><span className="jr-type"><TypeIcon />{type}</span></td>
              <td className="jr-key"><span title={keyOf(c)}>{shortKey(keyOf(c))}</span></td>
              <td><button type="button" className="jr-link" onClick={() => onOpen(c.id)}>{cs.legal_company_name || keyOf(c)}</button>{cs.building_address && <div className="jr-sub"><MapLink address={cs.building_address} /></div>}</td>
              <td>{cs.client_name || "—"}</td>
              <td><Assignee value={t.assignee} onChange={(a) => update(c.id, { assignee: a })} /></td>
              <td>{pr ? <Priority p={pr} /> : <span className="jr-muted">—</span>}</td>
              <td><StatusMenu s={s} onChange={(x) => update(c.id, { status: x })} />{isSynthetic(c) && <span className="jr-loz tone-purple small">Synthetic</span>}</td>
              <td className="jr-muted jr-date">{fmtDate(createdOf(c))}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </>
  )
}
const fmtDate = (iso: string) => { if (!iso) return "—"; const d = new Date(iso); return isNaN(+d) ? iso.slice(0, 10) : d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: iso.length > 10 ? "2-digit" : undefined, minute: iso.length > 10 ? "2-digit" : undefined }) }
/* ---------------- issue (one case) ---------------- */
type Tab = "findings" | "questions" | "risk" | "evidence" | "valuation"
function Issue({ c, t, s, onBack, update, queueLabel }: { c: CaseData; t: Ticket; s: Status; onBack: () => void; update: (p: Partial<Ticket>) => void; queueLabel: string }) {
  const r = c.output, b = c.bundle, m = c.metrics
  const ix = useMemo(() => buildIndex(b, r), [b, r])
  const [tab, setTab] = useState<Tab>(() => (new URLSearchParams(location.search).get("tab") as Tab) || "findings")
  const [menu, setMenu] = useState(false)
  const menuRef = useDismiss(menu, () => setMenu(false))
  const ok = !!r && (!m?.status || m.status === "succeeded")
  const es = r?.executive_summary || {}
  const etl = (m?.stages || []).find((x: any) => x.stage === "etl")
  const answered = new Set(t.answered || [])
  const counts: Record<Tab, number | null> = { findings: r?.priority_findings?.length ?? 0, questions: r?.open_questions?.length ?? 0, risk: null, evidence: null, valuation: null }
  const dl = (obj: unknown, name: string) => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" })); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000) }

  return (
    <div className="jr-issue">
      <div className="jr-col">
        <div className="jr-crumbs no-print"><button type="button" onClick={onBack}>{queueLabel}</button> <span>/</span> {keyOf(c)}</div>
        {isSynthetic(c) && <div className="jr-flag purple">Synthetic case: fictional data, not for real underwriting.</div>}
        {m?.status === "failed" && <div className="jr-flag red">Pipeline failed{m.error?.stage ? ` at ${m.error.stage}` : ""}: {m.error?.message}</div>}
        {m?.status === "invalid_report" && <div className="jr-flag red">The report did not pass validation and is not shown ({(m.validation?.issues || []).filter((i: any) => i.severity === "error").length} errors).</div>}
        {m?.status === "running" && <div className="jr-flag blue">Report being generated ({m.stages?.[m.stages.length - 1]?.stage || "starting"}).</div>}
        {etl?.status === "warning" && <div className="jr-flag yellow">Some sources were unavailable: {Object.entries(etl.evidence_blocks || {}).filter(([, v]) => v !== "ok").map(([k]) => humanise(k)).join(", ")}.</div>}

        <h1 className="jr-h1 issue">{es.headline || b?.case?.legal_company_name || keyOf(c)}</h1>
        <div className="jr-actions no-print">
          <StatusMenu s={s} onChange={(x) => update({ status: x })} big />
          {s !== "resolved" && s !== "failed" && s !== "generating" && <button type="button" className="jr-btn" onClick={() => update({ status: "resolved" })}>Resolve</button>}
          <div className="jr-more" ref={menuRef as React.RefObject<HTMLDivElement>}>
            <button type="button" className="jr-btn ghost icon" aria-expanded={menu} onClick={() => setMenu(!menu)} aria-label="Export" title="Export">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 14v5h14v-5" /></svg>
            </button>
            {menu && <div className="jr-menu">
              <button type="button" onClick={() => { setMenu(false); print() }}>Print / PDF</button>
              {r && <button type="button" onClick={() => dl(r, `${keyOf(c)}.output.json`)}>Download output.json</button>}
              {b && <button type="button" onClick={() => dl(b, `${keyOf(c)}.features_combined.json`)}>Download features_combined.json</button>}
            </div>}
          </div>
        </div>

        {ok && <>
          {es.key_takeaway && <p className="jr-lead">{es.key_takeaway}</p>}
          {r.underwriter_next_step && <div className="jr-next"><span className="jr-next-h">Next step</span>{r.underwriter_next_step}</div>}
          <h2 className="jr-h2">Description</h2>
          <Clamp text={es.overview} />

          <div className="jr-tabs no-print" role="tablist">
            {(["findings", "questions", "risk", "evidence", "valuation"] as Tab[]).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>
                {humanise(k)}{counts[k] !== null && <span className="jr-count">{counts[k]}</span>}
              </button>
            ))}
          </div>
          <Panel on={tab === "findings"} title="Findings"><Findings r={r} ix={ix} /></Panel>
          <Panel on={tab === "questions"} title="Questions"><Questions r={r} ix={ix} answered={answered} toggle={(id) => { const n = new Set(answered); if (n.has(id)) n.delete(id); else n.add(id); update({ answered: [...n] }) }} /></Panel>
          <Panel on={tab === "risk"} title="Risk"><Risk r={r} ix={ix} /></Panel>
          <Panel on={tab === "evidence"} title="Evidence"><Evidence c={c} r={r} b={b} ix={ix} /></Panel>
          <Panel on={tab === "valuation"} title="Valuation"><Valuation r={r} ix={ix} /></Panel>
        </>}
      </div>

      <aside className="jr-details">
        <div className="jr-box">
          <div className="jr-box-h">Details</div>
          <dl className="jr-kv">
            <div><dt>Key</dt><dd className="jr-fullkey">{keyOf(c)}</dd></div>
            <div><dt>Assignee</dt><dd><Assignee value={t.assignee} onChange={(a) => update({ assignee: a })} /></dd></div>
            <div><dt>Readiness</dt><dd>{es.underwriting_readiness ? <span className={"jr-loz tone-" + toneOfReadiness(es.underwriting_readiness)}>{READINESS[es.underwriting_readiness]?.[0]}</span> : "—"}</dd></div>
            <div><dt>Priority</dt><dd>{topPriority(r) ? <Priority p={topPriority(r)!} /> : "—"}</dd></div>
            <div><dt>Requester</dt><dd>{b?.case?.client_name || "—"}</dd></div>
            <div><dt>Company</dt><dd>{b?.case?.legal_company_name || "—"}</dd></div>
            <div><dt>Address</dt><dd>{b?.case?.building_address ? <MapLink address={b.case.building_address} /> : "—"}</dd></div>
            <div><dt>Activity</dt><dd>{ix.facts.get("ev.declared_industry")?.value?.label || "—"}</dd></div>
            <div><dt>EGID</dt><dd>{b?.building?.identity_resolution === "unique" && b?.building?.egid ? b.building.egid : <span className="jr-unknown">Unresolved</span>}</dd></div>
            <div><dt>UID</dt><dd>{b?.building?.company_uid || <span className="jr-unknown">Unknown</span>}</dd></div>
            <div><dt>Created</dt><dd>{(m?.finished_at || b?.case?.created_at || "").slice(0, 10) || "—"}</dd></div>
          </dl>
        </div>
        {m && <details className="jr-run no-print"><summary>Run details</summary>
          <p>{m.model_config || "?"} · {m.duration_s ?? "?"} s · {m.llm?.input_tokens ?? "?"} / {m.llm?.output_tokens ?? "?"} tokens · USD {m.total_usd ?? "?"}</p>
          <ul>{(m.stages || []).map((x: any, k: number) => <li key={k}>{x.stage}: {x.status}</li>)}</ul>
        </details>}
      </aside>
    </div>
  )
}
const toneOfReadiness = (k: string) => ({ ok: "green", amber: "yellow", orange: "yellow", red: "red" } as Record<string, string>)[READINESS[k]?.[1] || ""] || "grey"
function Panel({ on, title, children }: { on: boolean; title: string; children: ReactNode }) {
  return <section className={"jr-panel" + (on ? " on" : "")} role="tabpanel"><h2 className="jr-h2 print-only">{title}</h2>{children}</section>
}

/* findings: one row each, details on demand */
function Findings({ r, ix }: { r: any; ix: Index }) {
  const fs = [...(r.priority_findings || [])].sort((x, y) => (PRIORITY_ORDER[x.priority] ?? 9) - (PRIORITY_ORDER[y.priority] ?? 9))
  if (!fs.length) return <p className="jr-empty">No finding.</p>
  return <><PriorityLegend /><ul className="jr-rows">{fs.map((f) => {
    const related = (r.open_questions || []).filter((q: any) => (q.trigger_finding_ids || []).includes(f.id))
    return (
      <li key={f.id} id={"finding-" + f.id}>
        <details>
          <summary><Priority p={f.priority} iconOnly /><span className="jr-row-t">{f.title}</span><span className="jr-loz tone-grey">{FINDING_TYPE[f.finding_type] || f.finding_type}</span></summary>
          <div className="jr-row-b">
            <dl className="jr-kv wide">
              <div><dt>Observation</dt><dd>{f.observation}</dd></div>
              <div><dt>Implication</dt><dd>{f.underwriting_implication}</dd></div>
              <div><dt>Action</dt><dd>{f.recommended_action}</dd></div>
              {related.length > 0 && <div><dt>Questions</dt><dd>{related.map((q: any) => <span key={q.id} className="jr-rel">{q.id} {q.blocking_initial_pricing && <span className="jr-loz tone-red small">Blocking</span>}</span>)}</dd></div>}
            </dl>
            <Chips ids={[...(f.fact_ids || []), ...(f.evidence_ids || [])]} ix={ix} />
          </div>
        </details>
      </li>
    )
  })}</ul></>
}

/* questions: a checklist (answered is kept per case) */
function Questions({ r, ix, answered, toggle }: { r: any; ix: Index; answered: Set<string>; toggle: (id: string) => void }) {
  const qs = [...(r.open_questions || [])].sort((a, b) => Number(!!b.blocking_initial_pricing) - Number(!!a.blocking_initial_pricing) || (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9))
  if (!qs.length) return <p className="jr-empty">No open question.</p>
  return <><PriorityLegend extra /><ul className="jr-rows">{qs.map((q) => (
    <li key={q.id} className={answered.has(q.id) ? "done" : ""}>
      <details>
        <summary>
          <input type="checkbox" checked={answered.has(q.id)} onChange={() => toggle(q.id)} onClick={(e) => e.stopPropagation()} aria-label={"Answered: " + q.question} />
          <Priority p={q.priority} iconOnly />
          <span className="jr-row-t">{q.question}</span>
          <span className="jr-muted">{TARGET[q.target] || q.target}</span>
          {q.blocking_initial_pricing && <span className="jr-loz tone-red">Blocking</span>}
        </summary>
        <div className="jr-row-b">
          <dl className="jr-kv wide">
            <div><dt>Why</dt><dd>{q.reason_for_underwriter}</dd></div>
            <div><dt>Expected</dt><dd>{q.expected_answer_or_document}</dd></div>
            {(q.trigger_finding_ids || []).length > 0 && <div><dt>Findings</dt><dd>{q.trigger_finding_ids.join(", ")}</dd></div>}
          </dl>
          <Chips ids={q.feature_ids || []} ix={ix} />
        </div>
      </details>
    </li>
  ))}</ul></>
}

/* COPE + hazards */
const INDUSTRIAL = ["site_industrial_processes", "high_temperature_operations", "gas_installations", "flammable_material_storage", "business_sector"]
function Risk({ r, ix }: { r: any; ix: Index }) {
  const hz = r.hazard_interpretations || []
  const ind = INDUSTRIAL.map((k) => ix.byKey.get(k)).filter(Boolean)
  return (
    <>
      <h3 className="jr-h3">COPE</h3>
      <ul className="jr-rows">{(["construction", "occupancy", "protection", "exposure"] as const).map((k) => {
        const x = r.cope?.[k] || {}
        return (
          <li key={k}><details>
            <summary><span className="jr-cope">{humanise(k)}</span><span className="jr-row-t">{x.headline}</span>{(x.unknown_feature_ids || []).length > 0 && <span className="jr-loz tone-grey">{x.unknown_feature_ids.length} unknown</span>}</summary>
            <div className="jr-row-b"><p className="jr-text">{x.interpretation}</p><Chips ids={[...(x.fact_ids || []), ...(x.evidence_ids || [])]} ix={ix} />
              {(x.unknown_feature_ids || []).length > 0 && <div className="jr-chips">{x.unknown_feature_ids.map((id: string) => <span key={id} className="jr-chip s-grey">{humanise(ix.facts.get(id)?.field_key || id)}: unknown</span>)}</div>}</div>
          </details></li>
        )
      })}</ul>
      <h3 className="jr-h3">Natural hazards</h3>
      {!hz.length ? <p className="jr-empty">No hazard interpreted.</p> : (
        <table className="jr-table compact">
          <thead><tr><th>Peril</th><th>Measurement</th><th>Pricing role</th><th /></tr></thead>
          <tbody>{hz.map((h: any, k: number) => {
            const meas = (h.fact_ids || []).map((id: string) => ix.facts.get(id)).filter((f: any) => f && /_exposure$/.test(f.field_key))
            return (
              <tr key={k}>
                <td><b>{humanise(h.peril)}</b><div className="jr-sub">{h.interpretation}</div></td>
                <td>{meas.length ? meas.map((f: any) => <div key={f.id}><Value v={f.value} unit={f.unit} k={f.field_key} /></div>) : "—"}</td>
                <td>{PRICING[h.pricing_role] || h.pricing_role}</td>
                <td>{h.follow_up_needed && <span className="jr-loz tone-yellow">Follow-up</span>}</td>
              </tr>
            )
          })}</tbody>
        </table>
      )}
      <p className="jr-foot">Regulated tariff: hazard data supports underwriting and prevention, not an individual surcharge.</p>
      {ind.length > 0 && <>
        <h3 className="jr-h3">Industrial fire exposure</h3>
        <dl className="jr-kv wide">{ind.map((f: any) => <div key={f.id}><dt>{humanise(f.field_key)}</dt><dd><Value v={f.value} unit={f.unit} k={f.field_key} /> <StatusBadge f={f} /></dd></div>)}</dl>
      </>}
    </>
  )
}

/* evidence: images first, the rest folded */
function Evidence({ c, r, b, ix }: { c: CaseData; r: any; b: any; ix: Index }) {
  const cited = useMemo(() => new Set(JSON.stringify(r).match(/"(src_\d+|SRC\d+)"/g)?.map((s) => s.slice(1, -1)) || []), [r])
  const warns = [...(c.validation?.issues || []), ...(c.metrics?.validation?.issues || [])].filter((i: any) => i.severity === "warning")
  return (
    <>
      {(r.visual_evidence || []).length > 0 && <div className="jr-visuals">{r.visual_evidence.map((v: any) => <VisualCard key={v.visual_id} sel={v} c={c} ix={ix} />)}</div>}
      {(() => {
        const chosen = new Set((r.visual_evidence || []).map((v: any) => v.visual_id)), rest = (b.visuals || []).filter((v: any) => !chosen.has(v.id))
        return rest.length > 0 && (
          <details className="jr-fold"><summary>Other images <span className="jr-count">{rest.length}</span></summary>
            <div className="jr-visuals">{rest.map((v: any) => <VisualCard key={v.id} sel={{ visual_id: v.id, title: humanise(v.id.replace(/^vis\./, "")), caption: v.alt_text, annotation_ids: [] }} c={c} ix={ix} />)}</div>
          </details>
        )
      })()}
      <details className="jr-fold" open={!(r.visual_evidence || []).length}>
        <summary>Sources <span className="jr-count">{(b.sources || []).length}</span></summary>
        <ul className="jr-list">{(b.sources || []).map((s: any) => (
          <li key={s.id}><span className="jr-key">{s.id}</span> {s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.provider}: {s.title}</a> : <>{s.provider}: {s.title}</>}{!cited.has(s.id) && <span className="jr-muted"> · not cited</span>}</li>
        ))}</ul>
      </details>
      <details className="jr-fold">
        <summary>Evidence register <span className="jr-count">{(b.facts || []).length}</span></summary>
        <table className="jr-table compact">
          <thead><tr><th>Field</th><th>Value</th><th>Status</th><th>Scope</th></tr></thead>
          <tbody>{(b.facts || []).map((f: any) => (
            <tr key={f.id}><td>{humanise(f.field_key)}</td><td className="jr-val"><Value v={f.value} unit={f.unit} k={f.field_key} long /></td><td><StatusBadge f={f} /></td><td className="jr-muted">{scopeLabel(f.site_scope)}</td></tr>
          ))}</tbody>
        </table>
      </details>
      {((b.quality_flags || []).length > 0 || warns.length > 0) && (
        <details className="jr-fold">
          <summary>Data quality <span className="jr-count">{(b.quality_flags || []).length + warns.length}</span></summary>
          <ul className="jr-list">{(b.quality_flags || []).map((q: string, k: number) => <li key={"q" + k}>{q.startsWith("CONFLICT") && "⚠ "}{q}</li>)}{warns.map((w: any, k: number) => <li key={"w" + k}>{w.message}</li>)}</ul>
        </details>
      )}
    </>
  )
}
const scopeLabel = (s: string) => (s === "company" ? "company-wide, not this building" : humanise(s || "unknown"))

function VisualCard({ sel, c, ix }: { sel: any; c: CaseData; ix: Index }) {
  const v = ix.visuals.get(sel.visual_id)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const src = v ? c.url(v.asset_uri) : null
  const shown = (v?.annotations || []).filter((a: any) => (sel.annotation_ids || []).includes(a.id))
  const pts = (a: any) => { const xs: number[] = a.coordinates_or_bbox || [], norm = xs.every((n) => n >= 0 && n <= 1); return xs.map((n, i) => (norm && size ? n * (i % 2 ? size.h : size.w) : n)) }
  const stroke = (p: string) => (p === "geospatial_geometry" ? ["#d62828", ""] : p === "vision_candidate" ? ["#f08c00", "8 6"] : p === "human_annotation" ? ["#1f6feb", ""] : ["#868e96", ""])
  const srcs = v ? (v.source_ids || []).map((id: string) => ix.sources.get(id)?.provider || id).join(", ") : ""
  return (
    <figure className="jr-fig">
      <div className="jr-img">
        {!v || !src || failed ? <div className="jr-noimg">Image not available ({sel.visual_id})</div> : <>
          <img src={src} alt={v.alt_text || sel.title} onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} onError={() => setFailed(true)} />
          {size && <svg viewBox={`0 0 ${size.w} ${size.h}`} preserveAspectRatio="none" aria-hidden="true">
            {shown.map((a: any) => {
              const p = pts(a), [col, dash] = stroke(a.provenance), sw = Math.max(2, size.w / 250)
              return <g key={a.id} fill="none" stroke={col} strokeWidth={sw} strokeDasharray={dash}>
                {a.geometry_type === "bounding_box" ? <rect x={p[0]} y={p[1]} width={p[2] - p[0]} height={p[3] - p[1]} /> : a.geometry_type === "point" ? <circle cx={p[0]} cy={p[1]} r={sw * 4} /> : a.geometry_type === "line" ? <polyline points={p.join(" ")} /> : <polygon points={p.join(" ")} />}
              </g>
            })}
          </svg>}
        </>}
      </div>
      <figcaption>
        <b>{sel.title}</b>
        <span>{sel.caption}</span>
        {shown.length > 0 && <span className="jr-muted">{shown.map((a: any) => `${a.label}${a.provenance === "vision_candidate" ? " (AI candidate, to verify)" : ""}`).join(" · ")}</span>}
        <span className="jr-muted small">{srcs} · {v?.captured_or_published_at || "date unknown"}{v && !v.building_egid ? " · not linked to the insured building" : ""}</span>
      </figcaption>
    </figure>
  )
}

function Valuation({ r, ix }: { r: any; ix: Index }) {
  const vc = r.valuation_commentary || {}, f = ix.byKey.get("reconstruction_value_chf")
  // the status is already the badge: drop the "upstream status: estimated; " prefix and keep the formula, in capitals at the start
  const method = String(f?.method || "").replace(/^upstream status:[^;]*;?\s*/i, "").replace(/^./, (c) => c.toUpperCase())
  return (
    <dl className="jr-kv wide">
      <div><dt>Reconstruction value</dt><dd><b>{f ? (isRange(f.value) ? fmtRange(f.value) : <Value v={f.value} unit={f.unit} k={f.field_key} />) : <span className="jr-unknown">Unknown</span>}</b> {f && <StatusBadge f={f} />}<div className="jr-sub">Indicative range, not an appraisal.</div>{method && <div className="jr-sub">{method}</div>}</dd></div>
      <div><dt>Comment</dt><dd>{vc.reconstruction_value_comment}</dd></div>
      <div><dt>Market value</dt><dd>{vc.market_value_comment}</dd></div>
      {(vc.missing_valuation_inputs || []).length > 0 && <div><dt>Missing inputs</dt><dd><ul className="jr-list tight">{vc.missing_valuation_inputs.map((x: string, k: number) => <li key={k}>{x}</li>)}</ul></dd></div>}
    </dl>
  )
}

/* ---------------- small parts ---------------- */
function StatusMenu({ s, onChange, big }: { s: Status; onChange: (s: Status) => void; big?: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  if (s === "generating" || s === "failed") return <span className={"jr-loz tone-" + STATUS_TONE[s] + (big ? " big" : "")}>{STATUS_LABEL[s]}</span>
  return (
    <span className="jr-statusmenu" ref={ref as React.RefObject<HTMLSpanElement>}>
      <button type="button" className={"jr-loz tone-" + STATUS_TONE[s] + (big ? " big" : "") + " btn"} aria-expanded={open} onClick={(e) => { e.stopPropagation(); setOpen(!open) }}>
        {STATUS_LABEL[s]}<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && <span className="jr-menu">{WORKFLOW.filter((x) => x !== s).map((x) => (
        <button key={x} type="button" onClick={() => { setOpen(false); onChange(x) }}><span className={"jr-loz tone-" + STATUS_TONE[x]}>{STATUS_LABEL[x]}</span></button>
      ))}</span>}
    </span>
  )
}
function Assignee({ value, onChange }: { value?: string; onChange: (v: string | undefined) => void }) {
  return (
    <label className="jr-assignee">
      <span className={"jr-avatar" + (value === "me" ? " me" : "")} aria-hidden="true">{value === "me" ? "Me" : <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7z" /></svg>}</span>
      <select value={value || ""} onChange={(e) => onChange(e.target.value || undefined)} aria-label="Assignee">
        <option value="">Unassigned</option><option value="me">Me</option>
      </select>
    </label>
  )
}
function Priority({ p, iconOnly }: { p: string; iconOnly?: boolean }) {
  const col = p === "critical" ? "#c9372c" : p === "high" ? "#e2483d" : p === "medium" ? "#d97008" : "#2684ff"
  const path = p === "critical" ? "M6 13l6-6 6 6M6 19l6-6 6 6" : p === "high" ? "M6 15l6-6 6 6" : p === "medium" ? "M5 9h14M5 15h14" : "M6 9l6 6 6-6"
  return <span className="jr-prio" title={humanise(p)}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={col} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d={path} /></svg>{!iconOnly && humanise(p)}</span>
}
function TypeIcon() { return <svg className="jr-typeicon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"><path d="M3 21V8l6-4v17M9 21V10l12 3v8M3 21h18M13 15h4M13 18h4" /></svg> }

function Chips({ ids, ix }: { ids?: string[]; ix: Index }) {
  if (!ids?.length) return null
  return <div className="jr-chips">{[...new Set(ids)].map((id) => <Chip key={id} id={id} ix={ix} />)}</div>
}
function Chip({ id, ix }: { id: string; ix: Index }) {
  const [open, setOpen] = useState(false)
  const ref = useDismiss(open, () => setOpen(false))
  const res = resolve(ix, id)
  if (res.kind === "unresolved") return <span className="jr-chip s-off" title="Not found in the evidence register">{id}: unresolved</span>
  if (res.kind === "source") { const s = res.item; return s.url ? <a className="jr-chip s-src" href={s.url} target="_blank" rel="noreferrer" title={s.title}>{s.provider}</a> : <span className="jr-chip s-src" title={s.title}>{s.provider}</span> }
  if (res.kind === "visual" || res.kind === "annotation") return <span className="jr-chip s-src">{res.kind === "visual" ? "Image" : "Annotation"}</span>
  const f = res.item, [lab, cls] = STATUS[f.evidence_status] || [f.evidence_status, "grey"]
  return (
    <span className="jr-chipwrap" ref={ref as React.RefObject<HTMLSpanElement>}>
      <button type="button" className={"jr-chip s-" + cls} aria-expanded={open} onClick={() => setOpen(!open)} title={lab}>{humanise(f.field_key)}</button>
      {open && <span className="jr-pop" role="dialog">
        <b>{humanise(f.field_key)}</b>
        <span><Value v={f.value} unit={f.unit} k={f.field_key} long /></span>
        <span className="jr-muted">{lab} · {scopeLabel(f.site_scope)} · {f.confidence}</span>
        {(f.source_ids || []).length > 0 && <span>{f.source_ids.map((s: string) => { const so = ix.sources.get(s); return so?.url ? <a key={s} href={so.url} target="_blank" rel="noreferrer">{so.provider} </a> : <span key={s}>{so?.provider || s} </span> })}</span>}
      </span>}
    </span>
  )
}
/** One word per row. The catch-all "Estimated / inferred / declared" (derived_estimate) is replaced by what the row actually is
 *  (Estimated, Inferred or Declared), read from the upstream status the evidence builder keeps in `method`. */
function StatusBadge({ f }: { f: any }) {
  const [lab, cls] = STATUS[f.evidence_status] || [f.evidence_status, "grey"]
  let t = lab.split(" — ")[0].split(" (")[0]
  if (f.evidence_status === "derived_estimate") { const up = /upstream status:\s*(\w+)/i.exec(String(f.method || ""))?.[1]; t = up ? up[0].toUpperCase() + up.slice(1).toLowerCase() : /^declared/i.test(String(f.method || "")) ? "Declared" : "Estimated" }
  return <span className={"jr-chip static s-" + cls}>{t}</span>
}
function Value({ v, unit, k, long }: { v: any; unit?: string | null; k: string; long?: boolean }): JSX.Element {
  const s = fmtInline(v, unit) ?? fmtHazard(k, v)
  if (s !== null) return v === null || v === undefined ? <span className="jr-unknown">Unknown</span> : <>{s}</>
  if (Array.isArray(v)) return <ul className="jr-list tight">{v.map((x, i) => <li key={i}><Value v={x} k={k} /></li>)}</ul>
  const entries = Object.entries(v)
  const body = <dl className="jr-kv small">{entries.map(([kk, x]) => <div key={kk}><dt>{humanise(kk)}</dt><dd>{typeof x === "object" && x !== null ? <Value v={x} k={kk} /> : String(fmtShare(kk, x) ?? "Unknown")}</dd></div>)}</dl>
  return long && (k.startsWith("ev.") || entries.length > 4) ? <details><summary>{entries.length} fields</summary>{body}</details> : body
}
/** long text shown on 3 lines, with "Show more" */
function Clamp({ text }: { text?: string }) {
  const [open, setOpen] = useState(false)
  if (!text) return null
  return <div className="jr-clampwrap"><p className={"jr-text" + (open ? "" : " jr-clamp")}>{text}</p>{text.length > 260 && <button type="button" className="jr-more-btn no-print" onClick={() => setOpen(!open)}>{open ? "Show less" : "Show more"}</button>}</div>
}
/** what the icons mean (findings and questions) */
function PriorityLegend({ extra }: { extra?: boolean }) {
  return (
    <div className="jr-legend" aria-label="Legend">
      {(["critical", "high", "medium", "low"] as const).map((p) => <Priority key={p} p={p} />)}
      {extra && <><span className="jr-legend-sep" /><span className="jr-legend-i"><span className="jr-box-ic" aria-hidden="true" />Answered</span><span className="jr-legend-i"><span className="jr-loz tone-red small">Blocking</span>blocks initial pricing</span></>}
    </div>
  )
}
/** address -> Google Maps in a new tab */
function MapLink({ address }: { address: string }) {
  return (
    <a className="jr-maplink" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`} target="_blank" rel="noreferrer" title="Open in Google Maps">
      {address}<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></svg>
    </a>
  )
}
