import { useEffect, useMemo, useRef, useState } from "react"
import { forLlm, type LlmInput } from "../pipeline"

/** Team review only: the backend's output (llm_input.json) with downloads, like the team's demo page. Never on client screens. */
export default function JsonPanel({ doc, onClose }: { doc: LlmInput; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const shown = useMemo(() => {   // photos shortened for reading; the downloads keep them
    const c = structuredClone(doc)
    Object.values(c.images || {}).forEach((i) => { if (i.data_url) i.data_url = i.data_url.slice(0, 48) + `…(${Math.round(i.data_url.length / 1024)} KB)` })
    return JSON.stringify(c, null, 2)
  }, [doc])
  const slug = (doc.identification?.company_name || "company").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
  const download = (obj: unknown, name: string) => {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }))
    a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  useEffect(() => {
    box.current?.focus()
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    addEventListener("keydown", k); return () => removeEventListener("keydown", k)
  }, [onClose])
  return (
    <div className="jpanel" role="dialog" aria-label="Output JSON" tabIndex={-1} ref={box}>
      <header>
        <b>Output JSON <small>llm_input.json</small></b>
        <button type="button" className="jclose" aria-label="Close" onClick={onClose}>×</button>
      </header>
      <div className="jactions">
        <button type="button" onClick={() => download(doc, `${slug}.llm_input.json`)}>Download full</button>
        <button type="button" onClick={() => download(forLlm(doc), `${slug}.llm_input.for_llm.json`)}>Download LLM version</button>
        <button type="button" onClick={() => navigator.clipboard.writeText(shown).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <pre>{shown}</pre>
    </div>
  )
}