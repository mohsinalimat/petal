"use client"

import { useEffect, useState } from "react"
import { cn } from "@petal/ui"
import { useFrappe } from "@/hooks/useFrappe"
import {
  describeRequest, parseJsonArray, parseJsonObject, pushHistory, toClientSnippet, toCurlSnippet, validateRequest,
} from "@/lib/playground/playground"
import type { HistoryEntry, PlaygroundRequest } from "@/lib/playground/playground"

const HISTORY_KEY = "petal_playground_history"

type Kind = PlaygroundRequest["kind"]

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : []
  } catch {
    return []
  }
}

function saveHistory(h: HistoryEntry[]) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h)) } catch {}
}

export function ApiPlayground() {
  const frappe = useFrappe()
  const [kind, setKind] = useState<Kind>("method")
  const [method, setMethod] = useState("frappe.client.get_count")
  const [args, setArgs] = useState('{\n  "doctype": "User"\n}')
  const [doctype, setDoctype] = useState("User")
  const [docName, setDocName] = useState("Administrator")
  const [fields, setFields] = useState('["name", "full_name"]')
  const [filters, setFilters] = useState("[]")
  const [limit, setLimit] = useState(20)
  const [running, setRunning] = useState(false)
  const [response, setResponse] = useState<{ ok: boolean; body: string; ms: number } | null>(null)
  const [snippet, setSnippet] = useState<"client" | "curl">("client")
  const [history, setHistory] = useState<HistoryEntry[]>([])

  useEffect(() => setHistory(loadHistory()), [])

  const req: PlaygroundRequest =
    kind === "method" ? { kind, method, args }
    : kind === "get_doc" ? { kind, doctype, name: docName }
    : { kind, doctype, fields, filters, limit }

  const validation = validateRequest(req)

  function restore(h: HistoryEntry) {
    setKind(h.kind)
    if (h.kind === "method") { setMethod(h.method); setArgs(h.args) }
    if (h.kind === "get_doc") { setDoctype(h.doctype); setDocName(h.name) }
    if (h.kind === "get_list") { setDoctype(h.doctype); setFields(h.fields); setFilters(h.filters); setLimit(h.limit) }
  }

  async function send() {
    if (validation) return
    setRunning(true)
    const t0 = performance.now()
    let ok = true
    let body: unknown
    try {
      if (req.kind === "method") {
        const parsed = parseJsonObject(req.args)
        body = await frappe.callMethod(req.method.trim(), parsed.ok ? parsed.value : {})
      } else if (req.kind === "get_doc") {
        frappe.invalidate(`/doc/${req.doctype}/`)
        body = await frappe.getDoc(req.doctype.trim(), req.name.trim())
      } else {
        const f = parseJsonArray(req.fields, "Fields")
        const flt = parseJsonArray(req.filters, "Filters")
        frappe.invalidate(`/doc/${req.doctype}?`)
        body = await frappe.getList({
          doctype: req.doctype.trim(),
          fields: f.ok && f.value.length ? (f.value as string[]) : ["name"],
          filters: (flt.ok ? flt.value : []) as never,
          limit: req.limit,
        })
      }
    } catch (e) {
      ok = false
      body = { error: e instanceof Error ? e.message : String(e) }
    }
    const ms = Math.round(performance.now() - t0)
    setResponse({ ok, ms, body: JSON.stringify(body ?? null, null, 2) })
    const next = pushHistory(history, { ...req, at: Date.now(), ok, ms })
    setHistory(next)
    saveHistory(next)
    setRunning(false)
  }

  const input = "w-full h-9 rounded-lg border border-border bg-background px-3 text-sm font-mono"
  const area = "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm font-mono"
  const backend = process.env.NEXT_PUBLIC_FRAPPE_BACKEND_URL ?? "https://your-site"

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
      <form
        onSubmit={(e) => { e.preventDefault(); void send() }}
        onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); void send() } }}
        className="border border-border bg-card rounded-xl p-4 sm:p-5 space-y-4 min-w-0"
      >
        <div role="tablist" aria-label="Request type" className="inline-flex rounded-lg border border-border p-0.5">
          {([["method", "Method"], ["get_doc", "Get doc"], ["get_list", "Get list"]] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={kind === k}
              onClick={() => setKind(k)}
              className={cn("h-7 px-3 rounded-md text-xs font-medium", kind === k ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground")}
            >
              {label}
            </button>
          ))}
        </div>

        {kind === "method" && (
          <>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Whitelisted method</span>
              <input aria-label="Method" value={method} onChange={(e) => setMethod(e.target.value)} className={input} spellCheck={false} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Arguments (JSON object)</span>
              <textarea aria-label="Arguments" value={args} onChange={(e) => setArgs(e.target.value)} rows={6} className={area} spellCheck={false} />
            </label>
          </>
        )}
        {kind !== "method" && (
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">DocType</span>
            <input aria-label="DocType" value={doctype} onChange={(e) => setDoctype(e.target.value)} className={input} spellCheck={false} />
          </label>
        )}
        {kind === "get_doc" && (
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Name</span>
            <input aria-label="Document name" value={docName} onChange={(e) => setDocName(e.target.value)} className={input} spellCheck={false} />
          </label>
        )}
        {kind === "get_list" && (
          <>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Fields (JSON array)</span>
              <input aria-label="Fields" value={fields} onChange={(e) => setFields(e.target.value)} className={input} spellCheck={false} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Filters (JSON array, e.g. [[&quot;enabled&quot;, &quot;=&quot;, 1]])</span>
              <input aria-label="Filters" value={filters} onChange={(e) => setFilters(e.target.value)} className={input} spellCheck={false} />
            </label>
            <label className="block space-y-1 max-w-[140px]">
              <span className="text-xs font-medium text-muted-foreground">Limit</span>
              <input aria-label="Limit" type="number" min={1} max={500} value={limit} onChange={(e) => setLimit(parseInt(e.target.value, 10) || 0)} className={input} />
            </label>
          </>
        )}

        {validation && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{validation}</p>}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={running || !!validation} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-60">
            {running ? "Sending…" : "Send"}
          </button>
          <span className="text-xs text-muted-foreground hidden sm:inline">⌘/Ctrl + Enter</span>
        </div>

        <div className="space-y-1.5">
          <div className="flex gap-3 text-xs">
            {(["client", "curl"] as const).map((s) => (
              <button key={s} type="button" onClick={() => setSnippet(s)} className={cn("font-medium", snippet === s ? "text-primary" : "text-muted-foreground hover:text-foreground")}>
                {s === "client" ? "Petal client" : "curl"}
              </button>
            ))}
          </div>
          <pre className="text-xs bg-muted/40 border border-border rounded-lg p-3 overflow-x-auto">
            {snippet === "client" ? toClientSnippet(req) : toCurlSnippet(req, backend)}
          </pre>
        </div>
      </form>

      <div className="space-y-4 min-w-0">
        <div className="border border-border bg-card rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Response</span>
            {response && (
              <span className={cn("text-xs font-medium", response.ok ? "text-green-600 dark:text-green-400" : "text-red-600 dark:text-red-400")}>
                {response.ok ? "OK" : "Error"} · {response.ms} ms
              </span>
            )}
          </div>
          <pre aria-label="Response body" className="text-xs p-4 overflow-auto max-h-[420px] min-h-[120px] text-foreground">
            {response ? response.body : <span className="text-muted-foreground">Send a request to see the response.</span>}
          </pre>
        </div>

        {history.length > 0 && (
          <div className="border border-border bg-card rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">History</span>
              <button type="button" onClick={() => { setHistory([]); saveHistory([]) }} className="text-xs text-muted-foreground hover:text-foreground">Clear</button>
            </div>
            <ul className="divide-y divide-border/60 max-h-60 overflow-y-auto">
              {history.map((h) => (
                <li key={h.at}>
                  <button type="button" onClick={() => restore(h)} className="w-full flex items-center gap-2 px-4 py-2 text-left text-sm hover:bg-accent">
                    <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", h.ok ? "bg-green-500" : "bg-red-500")} />
                    <span className="font-mono text-xs truncate flex-1">{describeRequest(h)}</span>
                    <span className="text-[11px] text-muted-foreground tabular-nums">{h.ms} ms</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
