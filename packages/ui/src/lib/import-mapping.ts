// Data-import helpers: map CSV columns to DocType fields, coerce values by
// fieldtype, and validate rows before they are sent to Frappe.

export type ImportField = {
  fieldname: string
  fieldtype: string
  label: string
  reqd?: 0 | 1
  options?: string
  read_only?: 0 | 1
  hidden?: 0 | 1
}

/** column index → fieldname ("" = skip this column) */
export type ColumnMapping = string[]

export type RowIssue = { row: number; fieldname: string; message: string }

export type PreparedImport = {
  docs: Record<string, unknown>[]
  issues: RowIssue[]
}

const NON_DATA_TYPES = new Set([
  "Section Break", "Column Break", "Tab Break", "HTML", "Button", "Fold",
  "Heading", "Table", "Table MultiSelect", "Image", "Attach Image",
])

/** Fields a user can sensibly import into (excludes layout, tables and read-only). */
export function importableFields(fields: ImportField[]): ImportField[] {
  return fields.filter((f) => !NON_DATA_TYPES.has(f.fieldtype) && f.read_only !== 1)
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\*$/, "").replace(/[^a-z0-9]/g, "")
}

/** Guess a mapping by matching header text against fieldname or label (case/punctuation-insensitive). */
export function autoMapColumns(headers: string[], fields: ImportField[]): ColumnMapping {
  const byKey = new Map<string, string>()
  for (const f of fields) {
    byKey.set(normalize(f.fieldname), f.fieldname)
    if (f.label) byKey.set(normalize(f.label), f.fieldname)
  }
  byKey.set("id", "name")
  byKey.set("name", "name")

  const used = new Set<string>()
  return headers.map((h) => {
    const match = byKey.get(normalize(h))
    if (!match || used.has(match)) return ""
    used.add(match)
    return match
  })
}

const TRUE_VALUES  = new Set(["1", "yes", "y", "true", "t", "on"])
const FALSE_VALUES = new Set(["0", "no", "n", "false", "f", "off", ""])

/** Convert DD-MM-YYYY, DD/MM/YYYY or YYYY-MM-DD to Frappe's YYYY-MM-DD. */
export function normalizeDate(raw: string): string | null {
  const s = raw.trim()
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s)
  if (m) return fmtDate(+m[1]!, +m[2]!, +m[3]!)
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s)
  if (m) return fmtDate(+m[3]!, +m[2]!, +m[1]!)
  return null
}

function fmtDate(y: number, mo: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null
  return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`
}

/** Coerce a raw CSV cell to the value Frappe expects for `field`. Throws with a user-facing message. */
export function coerceValue(raw: string, field: ImportField): unknown {
  const s = raw.trim()
  switch (field.fieldtype) {
    case "Int": {
      if (s === "") return null
      const n = Number(s.replace(/,/g, ""))
      if (!Number.isInteger(n)) throw new Error(`"${raw}" is not a whole number`)
      return n
    }
    case "Float": case "Currency": case "Percent": {
      if (s === "") return null
      const n = Number(s.replace(/,/g, ""))
      if (Number.isNaN(n)) throw new Error(`"${raw}" is not a number`)
      return n
    }
    case "Check": {
      const v = s.toLowerCase()
      if (TRUE_VALUES.has(v)) return 1
      if (FALSE_VALUES.has(v)) return 0
      throw new Error(`"${raw}" is not Yes/No`)
    }
    case "Date": {
      if (s === "") return null
      const d = normalizeDate(s)
      if (!d) throw new Error(`"${raw}" is not a valid date`)
      return d
    }
    case "Datetime": {
      if (s === "") return null
      const [datePart = "", timePart = "00:00:00"] = s.split(/[ T]/)
      const d = normalizeDate(datePart)
      if (!d || !/^\d{1,2}:\d{2}(:\d{2})?$/.test(timePart)) throw new Error(`"${raw}" is not a valid date/time`)
      const [hh = "0", mm = "0", ss = "0"] = timePart.split(":")
      if (+hh > 23 || +mm > 59 || +ss > 59) throw new Error(`"${raw}" is not a valid date/time`)
      return `${d} ${[hh, mm, ss].map((p) => p.padStart(2, "0")).join(":")}`
    }
    case "Select": {
      if (s === "") return ""
      const opts = (field.options ?? "").split("\n").map((o) => o.trim()).filter(Boolean)
      if (opts.length && !opts.includes(s)) throw new Error(`"${raw}" is not one of: ${opts.join(", ")}`)
      return s
    }
    default:
      return s
  }
}

/** Build Frappe documents from CSV rows using `mapping`, collecting per-cell issues. */
export function prepareImport(
  doctype: string,
  rows: string[][],
  mapping: ColumnMapping,
  fields: ImportField[],
): PreparedImport {
  const fieldMap = new Map(fields.map((f) => [f.fieldname, f]))
  fieldMap.set("name", { fieldname: "name", fieldtype: "Data", label: "ID" })
  const required = fields.filter((f) => f.reqd === 1 && f.hidden !== 1)
  const docs: Record<string, unknown>[] = []
  const issues: RowIssue[] = []

  rows.forEach((cells, r) => {
    const rowNum = r + 1
    const doc: Record<string, unknown> = { doctype }
    mapping.forEach((fieldname, c) => {
      if (!fieldname) return
      const field = fieldMap.get(fieldname)
      if (!field) return
      try {
        const v = coerceValue(cells[c] ?? "", field)
        if (v !== null && v !== "") doc[fieldname] = v
      } catch (e) {
        issues.push({ row: rowNum, fieldname, message: (e as Error).message })
      }
    })
    for (const f of required) {
      if (doc[f.fieldname] == null && !issues.some((i) => i.row === rowNum && i.fieldname === f.fieldname)) {
        issues.push({ row: rowNum, fieldname: f.fieldname, message: `${f.label || f.fieldname} is required` })
      }
    }
    docs.push(doc)
  })

  return { docs, issues }
}

/** Header row for a downloadable import template. Required fields are suffixed with `*`. */
export function templateHeaders(fields: ImportField[]): string[] {
  return importableFields(fields).map((f) => (f.reqd === 1 ? `${f.label || f.fieldname}*` : f.label || f.fieldname))
}

/** Split an array into chunks of `size`. */
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}
