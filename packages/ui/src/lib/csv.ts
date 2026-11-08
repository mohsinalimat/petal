// RFC 4180 CSV parsing and serialization — no dependencies, used by list export
// and the data-import wizard.

export type CsvTable = { headers: string[]; rows: string[][] }

/**
 * Parse CSV text into a header row and data rows.
 * Handles quoted fields, escaped quotes (""), embedded newlines, CRLF/LF line
 * endings, a UTF-8 BOM, and a custom delimiter. Blank lines are skipped.
 */
export function parseCsv(text: string, delimiter = ","): CsvTable {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text
  const records: string[][] = []
  let record: string[] = []
  let field = ""
  let inQuotes = false
  let i = 0

  function endField() {
    record.push(field)
    field = ""
  }
  function endRecord() {
    endField()
    if (!(record.length === 1 && record[0] === "")) records.push(record)
    record = []
  }

  while (i < src.length) {
    const ch = src[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue }
        inQuotes = false; i++; continue
      }
      field += ch; i++; continue
    }
    if (ch === '"' && field === "") { inQuotes = true; i++; continue }
    if (ch === delimiter) { endField(); i++; continue }
    if (ch === "\r") { endRecord(); i += src[i + 1] === "\n" ? 2 : 1; continue }
    if (ch === "\n") { endRecord(); i++; continue }
    field += ch; i++
  }
  if (field !== "" || record.length > 0) endRecord()

  const [headers = [], ...rows] = records
  return { headers: headers.map((h) => h.trim()), rows }
}

function escapeCell(value: unknown, delimiter: string): string {
  if (value == null) return ""
  const s = typeof value === "object" ? JSON.stringify(value) : String(value)
  // Prefix formula-leading characters so spreadsheet apps don't execute them.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s
  return /["\r\n]/.test(safe) || safe.includes(delimiter) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** Serialize rows to CSV. `columns` maps record keys to header labels, in order. */
export function toCsv(
  rows: Record<string, unknown>[],
  columns: { key: string; label: string }[],
  delimiter = ",",
): string {
  const lines = [columns.map((c) => escapeCell(c.label, delimiter)).join(delimiter)]
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCell(row[c.key], delimiter)).join(delimiter))
  }
  return lines.join("\r\n") + "\r\n"
}

/** Trigger a browser download of `content` as a file. No-op outside the browser. */
export function downloadText(filename: string, content: string, mime = "text/csv;charset=utf-8"): void {
  if (typeof document === "undefined") return
  const blob = new Blob(["﻿" + content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** Read a File as text, falling back to FileReader where Blob.text() is unavailable (older Safari). */
export function readFileText(file: Blob): Promise<string> {
  if (typeof file.text === "function") return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ""))
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"))
    reader.readAsText(file)
  })
}
