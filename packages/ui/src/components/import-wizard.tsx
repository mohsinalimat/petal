"use client"

import * as React from "react"
import { useMemo, useState } from "react"
import { cn } from "../lib/utils"
import { downloadText, parseCsv, readFileText, toCsv } from "../lib/csv"
import { autoMapColumns, importableFields, prepareImport, templateHeaders } from "../lib/import-mapping"
import type { ColumnMapping, ImportField } from "../lib/import-mapping"

export type ImportMode = "insert" | "update"

export type ImportResult = {
  succeeded: number
  failed: { row: number; message: string }[]
}

export type ImportWizardProps = {
  doctype: string
  fields: ImportField[]
  /** Persist docs. Report failures with 1-based row numbers matching the file; call onProgress with rows done. */
  onImport: (docs: Record<string, unknown>[], mode: ImportMode, onProgress: (done: number) => void) => Promise<ImportResult>
  onDone?: () => void
  className?: string
}

type Step = "upload" | "map" | "result"

const PREVIEW_ROWS = 5

export function ImportWizard({ doctype, fields, onImport, onDone, className }: ImportWizardProps) {
  const targets = useMemo(() => importableFields(fields), [fields])
  const [step, setStep] = useState<Step>("upload")
  const [fileName, setFileName] = useState("")
  const [headers, setHeaders] = useState<string[]>([])
  const [rows, setRows] = useState<string[][]>([])
  const [mapping, setMapping] = useState<ColumnMapping>([])
  const [mode, setMode] = useState<ImportMode>("insert")
  const [parseError, setParseError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ImportResult | null>(null)

  const prepared = useMemo(
    () => (step === "map" ? prepareImport(doctype, rows, mapping, targets) : null),
    [step, doctype, rows, mapping, targets],
  )
  const nameMapped = mapping.includes("name")

  async function readFile(file: File) {
    setParseError(null)
    try {
      const text = await readFileText(file)
      const delimiter = file.name.toLowerCase().endsWith(".tsv") ? "\t" : (text.split("\n")[0]?.includes(";") && !text.split("\n")[0]?.includes(",") ? ";" : ",")
      const table = parseCsv(text, delimiter)
      if (table.headers.length === 0) throw new Error("The file is empty")
      if (table.rows.length === 0) throw new Error("The file has a header row but no data")
      setFileName(file.name)
      setHeaders(table.headers)
      setRows(table.rows)
      setMapping(autoMapColumns(table.headers, targets))
      setStep("map")
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "Could not read file")
    }
  }

  function downloadTemplate() {
    const cols = templateHeaders(targets).map((label) => ({ key: label, label }))
    downloadText(`${doctype}-template.csv`, toCsv([], cols))
  }

  async function run() {
    if (!prepared) return
    setRunning(true); setProgress(0)
    try {
      const res = await onImport(prepared.docs, mode, setProgress)
      setResult(res)
    } catch (e) {
      setResult({ succeeded: 0, failed: [{ row: 0, message: e instanceof Error ? e.message : "Import failed" }] })
    } finally {
      setRunning(false)
      setStep("result")
    }
  }

  function reset() {
    setStep("upload"); setHeaders([]); setRows([]); setMapping([]); setResult(null); setFileName(""); setMode("insert")
  }

  const blocking = prepared?.issues.length ?? 0

  return (
    <div className={cn("rounded-xl border border-border bg-background", className)}>
      <ol className="flex border-b border-border text-xs font-medium">
        {(["upload", "map", "result"] as Step[]).map((s, i) => (
          <li key={s} className={cn("flex-1 px-4 py-2.5 text-center", s === step ? "text-primary border-b-2 border-primary" : "text-muted-foreground")}>
            {i + 1}. {s === "upload" ? "Upload" : s === "map" ? "Map & validate" : "Result"}
          </li>
        ))}
      </ol>

      <div className="p-4 sm:p-6">
        {step === "upload" && (
          <div className="space-y-4">
            <label
              className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-xl py-12 px-4 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void readFile(f) }}
            >
              <span className="text-sm font-medium text-foreground">Drop a CSV file here, or click to choose</span>
              <span className="text-xs text-muted-foreground">First row must contain column headers</span>
              <input
                type="file"
                accept=".csv,.tsv,text/csv"
                aria-label="CSV file"
                className="sr-only"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f) }}
              />
            </label>
            {parseError && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{parseError}</p>}
            <button type="button" onClick={downloadTemplate} className="text-sm text-primary hover:underline">
              Download a blank template for {doctype}
            </button>
          </div>
        )}

        {step === "map" && prepared && (
          <div className="space-y-5">
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{fileName}</span> — {rows.length} row{rows.length === 1 ? "" : "s"}, {headers.length} column{headers.length === 1 ? "" : "s"}
            </p>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-2 font-medium">Column in file</th>
                    <th className="text-left px-3 py-2 font-medium">Maps to field</th>
                    <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Sample</th>
                  </tr>
                </thead>
                <tbody>
                  {headers.map((h, c) => (
                    <tr key={c} className="border-t border-border/60">
                      <td className="px-3 py-2 font-medium">{h || <em className="text-muted-foreground">(blank)</em>}</td>
                      <td className="px-3 py-2">
                        <select
                          aria-label={`Field for column ${h}`}
                          value={mapping[c] ?? ""}
                          onChange={(e) => setMapping((m) => m.map((v, i) => (i === c ? e.target.value : v === e.target.value && e.target.value ? "" : v)))}
                          className="h-8 w-full min-w-[160px] rounded border border-border bg-background px-2 text-sm"
                        >
                          <option value="">— Don't import —</option>
                          <option value="name">ID (name)</option>
                          {targets.map((f) => (
                            <option key={f.fieldname} value={f.fieldname}>{f.label || f.fieldname}{f.reqd ? " *" : ""}</option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground truncate max-w-[200px] hidden sm:table-cell">{rows[0]?.[c] ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <fieldset className="space-y-1.5">
              <legend className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Mode</legend>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="import-mode" checked={mode === "insert"} onChange={() => setMode("insert")} /> Create new records
              </label>
              <label className={cn("flex items-center gap-2 text-sm", !nameMapped && "opacity-50")}>
                <input type="radio" name="import-mode" disabled={!nameMapped} checked={mode === "update"} onChange={() => setMode("update")} />
                Update existing records (matched by ID){!nameMapped && " — map an ID column first"}
              </label>
            </fieldset>

            {blocking > 0 ? (
              <div role="alert" className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 p-3 text-sm space-y-1">
                <p className="font-medium text-red-700 dark:text-red-400">{blocking} problem{blocking === 1 ? "" : "s"} to fix before importing</p>
                <ul className="text-red-700/90 dark:text-red-400/90 text-xs space-y-0.5 max-h-40 overflow-y-auto">
                  {prepared.issues.slice(0, 50).map((i, k) => <li key={k}>Row {i.row}: {i.message}</li>)}
                </ul>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Preview</p>
                <pre className="text-xs bg-muted/30 border border-border rounded-lg p-3 overflow-x-auto max-h-56">
                  {JSON.stringify(prepared.docs.slice(0, PREVIEW_ROWS), null, 2)}
                </pre>
              </div>
            )}

            <div className="flex flex-col-reverse sm:flex-row sm:justify-between gap-2">
              <button type="button" onClick={reset} disabled={running} className="h-9 px-4 rounded-lg border border-border text-sm hover:bg-accent">Choose another file</button>
              <button
                type="button"
                onClick={() => void run()}
                disabled={running || blocking > 0 || (mode === "update" && !nameMapped)}
                className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-60"
              >
                {running ? `Importing… ${progress}/${rows.length}` : `Import ${rows.length} row${rows.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        )}

        {step === "result" && result && (
          <div className="space-y-4">
            <p className="text-sm">
              <span className="font-semibold text-green-600 dark:text-green-400">{result.succeeded} imported</span>
              {result.failed.length > 0 && <span className="font-semibold text-red-600 dark:text-red-400">, {result.failed.length} failed</span>}
            </p>
            {result.failed.length > 0 && (
              <ul className="text-xs text-red-700 dark:text-red-400 space-y-0.5 max-h-60 overflow-y-auto border border-border rounded-lg p-3">
                {result.failed.map((f, k) => <li key={k}>{f.row ? `Row ${f.row}: ` : ""}{f.message}</li>)}
              </ul>
            )}
            <div className="flex gap-2">
              <button type="button" onClick={reset} className="h-9 px-4 rounded-lg border border-border text-sm hover:bg-accent">Import another file</button>
              {onDone && <button type="button" onClick={onDone} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold">Go to list</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
