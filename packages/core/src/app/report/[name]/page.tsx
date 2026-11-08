"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useParams } from "next/navigation"
import { useFrappe } from "@/hooks/useFrappe"
import { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell } from "@petal/ui"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ReportType = "Query Report" | "Script Report" | "Report Builder" | string

interface ReportDoc {
  name: string
  report_type: ReportType
  ref_doctype: string
  module: string
  is_standard: "Yes" | "No"
  disabled: 0 | 1
  filters_json?: string
}

interface FilterDef {
  fieldname: string
  label: string
  fieldtype: string
  options?: string
  default?: string
  reqd?: 0 | 1
}

// Columns can be objects OR "Label:Fieldtype/Options:Width" strings
type RawColumn =
  | { fieldname: string; label: string; fieldtype: string; options?: string; width?: number }
  | string

interface ReportResult {
  columns: RawColumn[]
  result: unknown[][]
  total_row?: unknown[] | null
  skip_total_row?: 0 | 1
  message?: string | null
}

// Normalised column (always object after parsing)
interface Column {
  fieldname: string
  label: string
  fieldtype: string
  options?: string
  width?: number
}

// ---------------------------------------------------------------------------
// Script Report filter parser
// ---------------------------------------------------------------------------

// Extract a balanced [...] or {...} block starting at `startIdx`
function extractBalanced(str: string, startIdx: number): string {
  const open = str[startIdx]
  const close = open === "[" ? "]" : "}"
  let depth = 0
  for (let i = startIdx; i < str.length; i++) {
    if (str[i] === open) depth++
    if (str[i] === close) { depth--; if (depth === 0) return str.slice(startIdx, i + 1) }
  }
  return str.slice(startIdx)
}

// Remove properties whose value is a JS function: key: function(...){...}
// Works by scanning for "function" and bracket-matching its body.
function stripFunctionProps(str: string): string {
  // Matches: ,? whitespace "key": function(...){...}  or  key: function
  // We'll do it character-scan style to handle nested braces.
  let out = ""
  let i = 0
  while (i < str.length) {
    const fIdx = str.indexOf("function", i)
    if (fIdx === -1) { out += str.slice(i); break }

    // Find the opening { of the function body
    const bodyStart = str.indexOf("{", fIdx)
    if (bodyStart === -1) { out += str.slice(i); break }

    // Walk back from fIdx to remove the "key:" prefix and any leading comma/whitespace
    let keyEnd = fIdx
    // while (keyEnd > i && /\s/.test(str[keyEnd - 1])) keyEnd--         // skip whitespace before "function"
    const ch = str[keyEnd - 1] ?? ""

    while (keyEnd > i && /\s/.test(ch)) {
      keyEnd--
    }
    let keyStart = keyEnd
    // Skip back over (params) if any — e.g. key: function(txt) — already handled, just find ":"
    // Actually we need to find the "propname:" that precedes this function
    // Walk back to find the colon
    let colonPos = -1
    for (let k = keyEnd - 1; k >= i; k--) {
      if (str[k] === ":") { colonPos = k; break }
      if (str[k] === "," || str[k] === "{") break
    }
    if (colonPos !== -1) {
      // Go back over the key name (quoted or unquoted)
      keyStart = colonPos - 1
      while (keyStart > i && /\s/.test(str[keyStart] ?? "")) keyStart--
      if (str[keyStart] === '"' || str[keyStart] === "'") {
        const q = str[keyStart]
        keyStart--
        while (keyStart > i && str[keyStart] !== q) keyStart--
      } else {
        // while (keyStart > i && /[a-zA-Z0-9_]/.test(str[keyStart - 1] ? "")) keyStart--
        while (keyStart > i && /[a-zA-Z0-9_]/.test(str[keyStart - 1] ?? "")) keyStart--
      }
      // Also eat the leading comma if present
      let beforeKey = keyStart
      while (beforeKey > i && /[\s,]/.test(str[beforeKey - 1] ?? "")) beforeKey--
      out += str.slice(i, beforeKey)
    } else {
      out += str.slice(i, fIdx)
    }

    // Skip past the function body
    const body = extractBalanced(str, bodyStart)
    i = bodyStart + body.length
    // skip trailing comma if any
    while (i < str.length && /[\s,]/.test(str[i] ?? "")) i++
    // put back a comma separator if needed to keep array valid
    // (we'll rely on trailing-comma cleanup later)
  }
  return out
}

// Frappe Script Reports define filters in a companion .js file.
// Two common patterns:
//   1. Inline:   frappe.query_reports["X"] = { filters: [ {...}, ... ] }
//   2. Function: frappe.query_reports["X"] = { filters: get_filters() }
//                function get_filters() { let filters = [ {...}, ... ]; return filters; }
function parseFiltersFromScript(script: string): FilterDef[] {
  // Find where the filters array starts
  let bracketIdx = -1

  // Pattern 1: filters: [ — inline
  const inlineMatch = script.match(/\bfilters\s*:\s*\[/)
  if (inlineMatch?.index !== undefined) {
    bracketIdx = script.indexOf("[", inlineMatch.index)
  }

  // Pattern 2: let/var/const filters = [ — defined inside a helper function
  if (bracketIdx === -1) {
    const letMatch = script.match(/(?:let|var|const)\s+filters\s*=\s*\[/)
    if (letMatch?.index !== undefined) {
      bracketIdx = script.indexOf("[", letMatch.index)
    }
  }

  if (bracketIdx === -1) return []

  let str = extractBalanced(script, bracketIdx)

  // 1. Strip function-valued properties (on_change, get_data, formatter, etc.)
  str = stripFunctionProps(str)

  str = str
    // __("text") / __('text') → extract the string
    .replace(/__\("([^"]*?)"\)/g, '"$1"')
    .replace(/__\('([^']*?)'\)/g, '"$1"')
    // frappe.* and erpnext.* dynamic expressions → null
    .replace(/(?:frappe|erpnext)\.[^,}\]\n]*/g, "null")
    // leftover bare identifiers used as values (e.g. variable references) → null
    .replace(/:\s*([a-zA-Z_$][a-zA-Z0-9_$]*)\s*([,}\]])/g, ": null$2")
    // single-quoted strings → double-quoted
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, '"$1"')
    // unquoted JS keys → quoted  { fieldname: → { "fieldname":
    .replace(/([{,\[]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
    // trailing commas
    .replace(/,\s*([}\]])/g, "$1")

  try {
    const parsed: unknown[] = JSON.parse(str)
    return parsed
      .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
      .map((f) => {
        // options: [{value, label}] → "val1\nval2"
        if (Array.isArray(f.options)) {
          f.options = (f.options as Array<{ value?: string } | string>)
            .map((o) => (typeof o === "object" && o !== null ? (o.value ?? "") : String(o)))
            .join("\n")
        }
        return f as unknown as FilterDef
      })
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// function parseColumn(raw: RawColumn): Column {
//   if (typeof raw === "object" && raw !== null) return raw as Column

//   // "Label:Fieldtype/Options:Width"
//   const parts = (raw as string).split(":")
//   const label = parts[0] ?? ""
//   const typeAndOptions = parts[1] ?? ""
//   const width = parts[2] ? parseInt(parts[2], 10) : undefined
//   const [fieldtype, options] = typeAndOptions.includes("/")
//     ? typeAndOptions.split("/")
//     : [typeAndOptions, undefined]

//   return {
//     fieldname: label.toLowerCase().replace(/\s+/g, "_"),
//     label,
//     fieldtype: fieldtype || "Data",
//     options,
//     width: width && !isNaN(width) ? width : undefined,
//   }
// }

function parseColumn(raw: RawColumn): Column {
  if (typeof raw === "object" && raw !== null) {
    return raw as Column
  }

  // "Label:Fieldtype/Options:Width"
  const parts = (raw as string).split(":")
  const label = parts[0] ?? ""
  const typeAndOptions = parts[1] ?? ""
  const width = parts[2] ? parseInt(parts[2], 10) : undefined

  const [fieldtype, options] = typeAndOptions.includes("/")
    ? typeAndOptions.split("/")
    : [typeAndOptions, undefined]

  const column: Column = {
    fieldname: label.toLowerCase().replace(/\s+/g, "_"),
    label,
    fieldtype: fieldtype || "Data",
  }

  if (options !== undefined) {
    column.options = options
  }

  if (width !== undefined && !isNaN(width)) {
    column.width = width
  }

  return column
}

function formatCell(val: unknown, fieldtype: string): React.ReactNode {
  if (val == null || val === "") return <span className="text-muted-foreground/40">—</span>

  if (fieldtype === "Check") {
    return (
      <span
        className={`inline-flex items-center text-xs font-medium px-1.5 py-0.5 rounded-full ${val ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
            : "bg-muted text-muted-foreground"
          }`}
      >
        {val ? "Yes" : "No"}
      </span>
    )
  }

  if (fieldtype === "Currency" || fieldtype === "Float") {
    const num = parseFloat(String(val))
    if (!isNaN(num))
      return (
        <span className="font-mono">
          {num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      )
  }

  if (fieldtype === "Int" || fieldtype === "Percent") {
    const num = parseFloat(String(val))
    if (!isNaN(num))
      return (
        <span className="font-mono">
          {num.toLocaleString()}
          {fieldtype === "Percent" ? "%" : ""}
        </span>
      )
  }

  if (fieldtype === "Date" && typeof val === "string")
    return new Date(val).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })

  if (fieldtype === "Datetime" && typeof val === "string")
    return new Date(val).toLocaleString(undefined, {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    })

  return String(val)
}

function renderFilterInput(
  def: FilterDef,
  value: string,
  onChange: (v: string) => void,
) {
  const base =
    "h-8 px-2.5 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 w-full"

  if (def.fieldtype === "Check") {
    return (
      <input
        type="checkbox"
        checked={value === "1"}
        onChange={(e) => onChange(e.target.checked ? "1" : "0")}
        className="h-4 w-4 rounded border-border mt-2"
      />
    )
  }

  if (def.fieldtype === "Select" && def.options) {
    const opts = def.options.split("\n").filter(Boolean)
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)} className={base}>
        <option value="">All</option>
        {opts.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    )
  }

  if (def.fieldtype === "Date") {
    return (
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={base}
      />
    )
  }

  if (def.fieldtype === "Datetime") {
    return (
      <input
        type="datetime-local"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={base}
      />
    )
  }

  if (def.fieldtype === "Int" || def.fieldtype === "Float" || def.fieldtype === "Currency") {
    return (
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={def.label}
        className={base}
      />
    )
  }

  // Default: text / Link / Data
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={def.label}
      className={base}
    />
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ReportPage() {
  const params = useParams()
  const name = decodeURIComponent(params.name as string)
  const frappe = useFrappe()

  const [reportDoc, setReportDoc] = useState<ReportDoc | null>(null)
  const [filterDefs, setFilterDefs] = useState<FilterDef[]>([])
  const [filterVals, setFilterVals] = useState<Record<string, string>>({})
  const [result, setResult] = useState<ReportResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [metaLoading, setMetaLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState("")

  // Fetch report metadata + filter definitions via get_script (same as Frappe frontend)
  useEffect(() => {
    setMetaLoading(true)
    Promise.all([
      frappe.getDoc<any>("Report", name),
      frappe.callMethod<{ filters?: FilterDef[]; script?: string }>(
        "frappe.desk.query_report.get_script",
        { report_name: name },
      ).catch(() => ({ filters: undefined, script: undefined })),
    ])
      .then(([doc, scriptMeta]) => {
        setReportDoc(doc)

        let defs: FilterDef[] = []

        if (doc.report_type === "Query Report") {
          // Query Report: filters are stored as JSON in filters_json on the Report doc
          if (doc.filters_json) {
            try { defs = JSON.parse(doc.filters_json) } catch { /* ignore */ }
          }
        } else {
          // Script Report: filters are defined in the companion .js file.
          // get_script returns the raw JS string — parse it out.
          if (scriptMeta?.filters && Array.isArray(scriptMeta.filters) && scriptMeta.filters.length > 0) {
            // Some Frappe versions return already-parsed filters
            defs = scriptMeta.filters
          } else if ((scriptMeta as { script?: string })?.script) {
            defs = parseFiltersFromScript((scriptMeta as { script: string }).script)
          }
          // Last resort: filters_json on the doc
          if (defs.length === 0 && doc.filters_json) {
            try { defs = JSON.parse(doc.filters_json) } catch { /* ignore */ }
          }
        }

        setFilterDefs(defs)

        // Seed defaults — every filter gets an entry so required ones are never missing
        const defaults: Record<string, string> = {}
        for (const f of defs) {
          defaults[f.fieldname] = f.default != null ? String(f.default) : ""
        }
        setFilterVals(defaults)
      })
      .catch(() => setError("Could not load report metadata."))
      .finally(() => setMetaLoading(false))
  }, [frappe, name])

  // Run the report
  const runReport = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Send all filter values — required filters must be present even if empty
      const filters: Record<string, string | null> = {}
      for (const [k, v] of Object.entries(filterVals)) {
        filters[k] = v === "" ? null : v
      }

      const data = await frappe.callMethod<ReportResult>(
        "frappe.desk.query_report.run",
        { report_name: name, filters, ignore_prepared_report: 1 },
      )
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to run report.")
    } finally {
      setLoading(false)
    }
  }, [frappe, name, filterVals])

  // Auto-run once metadata is loaded — but only if all required filters have values
  const hasAutoRun = useRef(false)
  useEffect(() => {
    if (metaLoading || hasAutoRun.current) return
    const missingRequired = filterDefs.some((f) => f.reqd && !filterVals[f.fieldname])
    if (!missingRequired) {
      hasAutoRun.current = true
      runReport()
    }
  }, [metaLoading, filterDefs, filterVals, runReport])

  // Normalise columns
  const columns = useMemo<Column[]>(
    () => (result?.columns ?? []).map(parseColumn),
    [result?.columns],
  )

  // Frappe reports may return rows as arrays OR as dicts keyed by fieldname.
  // Normalise to arrays ordered by column index so cell rendering is uniform.
  const normalisedRows = useMemo(() => {
    const raw = result?.result ?? []
    if (raw.length === 0 || Array.isArray(raw[0])) return raw as unknown[][]
    // Dict rows → reorder by column fieldnames
    return (raw as unknown as Record<string, unknown>[]).map((row) =>
      columns.map((col) => row[col.fieldname]),
    )
  }, [result?.result, columns])

  // Filter rows by search
  const rows = useMemo(() => {
    if (!search) return normalisedRows
    const q = search.toLowerCase()
    return normalisedRows.filter((row) =>
      (row as unknown[]).some((cell) => String(cell ?? "").toLowerCase().includes(q)),
    )
  }, [normalisedRows, search])

  const totalRow = result?.total_row && !result.skip_total_row ? result.total_row : null

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (metaLoading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="h-7 w-64 bg-muted rounded" />
        <div className="h-4 w-40 bg-muted rounded" />
        <div className="h-10 bg-muted rounded-lg mt-6" />
        <div className="h-64 bg-muted rounded-lg" />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold text-foreground truncate">{name}</h1>
          {reportDoc && (
            <div className="flex items-center gap-2 mt-1">
              <span className="text-xs text-muted-foreground">{reportDoc.ref_doctype}</span>
              <span className="w-1 h-1 rounded-full bg-muted-foreground/40" />
              <span className="text-xs text-muted-foreground">{reportDoc.report_type}</span>
              {reportDoc.module && (
                <>
                  <span className="w-1 h-1 rounded-full bg-muted-foreground/40" />
                  <span className="text-xs text-muted-foreground">{reportDoc.module}</span>
                </>
              )}
            </div>
          )}
        </div>

        <button
          onClick={runReport}
          disabled={loading}
          className="inline-flex items-center gap-2 h-9 px-4 rounded-md bg-primary text-primary-foreground text-sm font-medium
                     hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors shrink-0"
        >
          {loading ? (
            <>
              <span className="w-4 h-4 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
              Running…
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Run Report
            </>
          )}
        </button>
      </div>

      {/* Filters */}
      {filterDefs.length > 0 && (
        <div className="bg-muted/30 border border-border rounded-lg p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Filters
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {filterDefs.map((def) => (
              <div key={def.fieldname}>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">
                  {def.label}
                  {def.reqd ? <span className="text-red-500 ml-0.5">*</span> : null}
                </label>
                {renderFilterInput(def, filterVals[def.fieldname] ?? "", (v) =>
                  setFilterVals((prev) => ({ ...prev, [def.fieldname]: v })),
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 dark:bg-red-900/10 dark:border-red-900/30 p-4 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Message from report */}
      {result?.message && (
        <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
          {result.message}
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <div className="space-y-3">
          {/* Results toolbar */}
          <div className="flex items-center gap-3 flex-wrap">
            <input
              type="text"
              placeholder="Search results…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 px-3 rounded-md border border-border bg-background text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 w-full max-w-xs"
            />
            <span className="text-xs text-muted-foreground ml-auto">
              {rows.length} row{rows.length !== 1 ? "s" : ""}
              {search && normalisedRows.length !== rows.length
                ? ` (filtered from ${normalisedRows.length})`
                : ""}
            </span>
          </div>

          {/* Table */}
          {columns.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No columns returned.</p>
          ) : (
            <div className="border border-border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    {columns.map((col, ci) => (
                      <TableHead
                        key={col.fieldname + ci}
                        className="whitespace-nowrap font-semibold"
                        style={col.width ? { minWidth: col.width } : undefined}
                      >
                        {col.label}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={columns.length} className="py-12 text-center text-sm text-muted-foreground">
                        No data found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    rows.map((row, ri) => (
                      <TableRow key={ri} className="hover:bg-accent/40">
                        {columns.map((col, ci) => (
                          <TableCell key={col.fieldname + ci} className="whitespace-nowrap text-foreground/80">
                            {formatCell((row as unknown[])[ci], col.fieldtype)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  )}
                </TableBody>

                {/* Total row */}
                {totalRow && (
                  <TableFooter>
                    <TableRow className="hover:bg-muted/50 font-semibold">
                      {columns.map((col, ci) => (
                        <TableCell key={col.fieldname + ci} className="whitespace-nowrap text-xs text-foreground">
                          {formatCell((totalRow as unknown[])[ci], col.fieldtype)}
                        </TableCell>
                      ))}
                    </TableRow>
                  </TableFooter>
                )}
              </Table>
            </div>
          )}
        </div>
      )}

      {/* Initial run: no result yet but loading */}
      {loading && !result && (
        <div className="flex items-center justify-center py-16 text-sm text-muted-foreground gap-2">
          <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Running report…
        </div>
      )}

      {/* Loading overlay when re-running (result already present) */}
      {loading && result && (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground gap-2">
          <span className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Running report…
        </div>
      )}
    </div>
  )
}
