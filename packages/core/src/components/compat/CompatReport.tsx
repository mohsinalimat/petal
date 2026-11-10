"use client"
/**
 * A query/script report driven by its real `frappe.query_reports[name]`
 * settings (lib/frappe-compat/report.ts): Desk filter controls in the form
 * bar, the script's buttons in the header, and cells through its formatter.
 */
import { useEffect, useMemo, useState } from "react"
import type { FrappeCompatConfig } from "@petal/sdk"
import { openQueryReport, type CompatQueryReport } from "@/lib/frappe-compat"
import { startCompat } from "@/lib/frappe-compat/browser"
import { HtmlHost } from "@/app/form/[doctype]/[name]/components/FieldWrapper"
import { PageLoader } from "@/components/shell/PageLoader"
import { FrappeHtml } from "./FrappeHtml"
import { PageHeader } from "./PageHeader"

const NUMERIC = new Set(["Currency", "Float", "Int", "Percent"])

export function CompatReport({ name, config }: { name: string; config: FrappeCompatConfig }) {
  const [report, setReport] = useState<CompatQueryReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [, setVersion] = useState(0)
  const [search, setSearch] = useState("")

  useEffect(() => {
    let cancelled = false
    setReport(null)
    setError(null)
    void (async () => {
      try {
        await startCompat(config)
        const r = openQueryReport(name)
        if (cancelled) return
        setReport(r)
        await r.load()
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => { cancelled = true }
  }, [name, config])

  useEffect(() => {
    if (!report) return
    const unsubscribe = report.subscribe(() => setVersion((v) => v + 1))
    setVersion((v) => v + 1) // catch up on changes made before subscribing
    return unsubscribe
  }, [report])

  const rows = useMemo(() => {
    const data = report?.data ?? []
    if (!search) return data.map((d, i) => ({ d, i }))
    const q = search.toLowerCase()
    return data.map((d, i) => ({ d, i })).filter(({ d }) => Object.values(d ?? {}).some((v) => String(v ?? "").toLowerCase().includes(q)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report, report?.data, search])

  if (error) return <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>
  if (!report) return <PageLoader label="Loading report…" />

  const columns = report.columns.filter((c) => !c.hidden)
  return (
    <div className="space-y-4 min-w-0">
      <PageHeader page={report.page} fallbackTitle={name} />
      {/* The report's filters: Desk controls the script set up (page form) */}
      <HtmlHost el={report.wrapper} />

      <div className="flex items-center justify-between gap-3">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search results…"
          aria-label="Search results"
          className="h-8 w-full max-w-xs rounded-lg border border-border bg-background px-3 text-sm"
        />
        <span className="text-xs text-muted-foreground" aria-live="polite">
          {report.loading ? "Running…" : `${report.data.length.toLocaleString()} row${report.data.length === 1 ? "" : "s"}`}
        </span>
      </div>

      {report.error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{report.error}</p>}
      {report.message && !report.loading && <FrappeHtml html={report.message} className="text-sm text-muted-foreground" />}

      {columns.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border bg-background">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                {columns.map((c) => (
                  <th key={c.fieldname} scope="col" style={c.width ? { minWidth: c.width } : undefined}
                    className={`px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground ${NUMERIC.has(c.fieldtype) ? "text-right" : "text-left"}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={report.loading ? "opacity-50" : ""}>
              {rows.map(({ d, i }) => (
                <tr key={i} className="border-b border-border/50 last:border-0">
                  {columns.map((c) => (
                    <td key={c.fieldname} className={`px-3 py-2 align-top ${NUMERIC.has(c.fieldtype) ? "text-right tabular-nums" : ""}`}>
                      <FrappeHtml html={report.format_cell(d?.[c.fieldname], i, c, d)} className="inline" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
