// Pure document helpers shared by the form engine: defaults, validation,
// duplicate and amend. Kept free of React so they are unit-testable.

type FieldLike = {
  fieldname: string
  fieldtype: string
  label?: string
  default?: string | number
  reqd?: 0 | 1
  no_copy?: 0 | 1
  hidden?: 0 | 1
}

/** System fields that must never be copied into a new document. */
export const SYSTEM_FIELDS = [
  "name", "docstatus", "creation", "modified", "modified_by", "owner",
  "amended_from", "__islocal", "__unsaved", "idx",
] as const

const CHILD_SYSTEM_FIELDS = new Set([...SYSTEM_FIELDS, "parent"])

function todayKey(now: Date): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

/**
 * Resolve DocField defaults for a new document. Handles literal values,
 * "Today" for Date/Datetime, and the current-user tokens; dynamic `eval:`
 * expressions and `__last` are skipped because they need server context.
 */
export function computeDefaults(
  fields: FieldLike[],
  ctx: { user?: string | null; now?: Date } = {},
): Record<string, unknown> {
  const now = ctx.now ?? new Date()
  const out: Record<string, unknown> = {}
  for (const f of fields) {
    const def = f.default
    if (def == null || def === "") continue
    if (typeof def !== "string") { out[f.fieldname] = def; continue }
    if ((f.fieldtype === "Date" || f.fieldtype === "Datetime") && def.toLowerCase() === "today") {
      out[f.fieldname] = todayKey(now)
    } else if (f.fieldtype === "Datetime" && def.toLowerCase() === "now") {
      out[f.fieldname] = `${todayKey(now)} ${now.toTimeString().slice(0, 8)}`
    } else if (def === "__user" || def === "eval:frappe.session.user" || def === "user") {
      if (ctx.user) out[f.fieldname] = ctx.user
    } else if (def === "__last" || def.startsWith("eval:")) {
      // needs server/session context — leave unset
    } else if (f.fieldtype === "Check" || f.fieldtype === "Int") {
      const n = parseInt(def, 10)
      out[f.fieldname] = Number.isNaN(n) ? def : n
    } else if (["Float", "Currency", "Percent"].includes(f.fieldtype)) {
      const n = parseFloat(def)
      out[f.fieldname] = Number.isNaN(n) ? def : n
    } else {
      out[f.fieldname] = def
    }
  }
  return out
}

function isEmpty(v: unknown): boolean {
  return v == null || v === "" || (Array.isArray(v) && v.length === 0)
}

/** Fieldnames that are mandatory, visible, and empty. */
export function missingRequired(
  fields: FieldLike[],
  values: Record<string, unknown>,
  behaviors: Record<string, { hidden?: boolean }> = {},
): string[] {
  return fields
    .filter((f) => f.reqd === 1 && f.hidden !== 1 && !behaviors[f.fieldname]?.hidden && isEmpty(values[f.fieldname]))
    .map((f) => f.fieldname)
}

function stripRow(row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(row).filter(([k]) => !CHILD_SYSTEM_FIELDS.has(k as never)))
}

/**
 * Copy a document for "Duplicate": drops system fields and `no_copy` fields,
 * and strips identity from child-table rows so they are re-inserted.
 */
export function stripForCopy(
  values: Record<string, unknown>,
  fields: FieldLike[] = [],
  opts: { keepNoCopy?: boolean } = {},
): Record<string, unknown> {
  const noCopy = opts.keepNoCopy ? new Set<string>() : new Set(fields.filter((f) => f.no_copy === 1).map((f) => f.fieldname))
  const sys = new Set<string>(SYSTEM_FIELDS)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(values)) {
    if (sys.has(k) || noCopy.has(k)) continue
    out[k] = Array.isArray(v)
      ? v.map((r) => (r && typeof r === "object" ? stripRow(r as Record<string, unknown>) : r))
      : v
  }
  return out
}

/**
 * Build the draft for amending a cancelled document. Frappe names the new doc
 * `<original>-1`, `-2`, … based on `amended_from`; `no_copy` fields are kept,
 * matching Desk's amend behaviour.
 */
export function buildAmendment(values: Record<string, unknown>, name: string, fields: FieldLike[] = []): Record<string, unknown> {
  return { ...stripForCopy(values, fields, { keepNoCopy: true }), amended_from: name, docstatus: 0 }
}

/** Session-storage key used to hand prefilled values to /form/:doctype/new. */
export function prefillKey(doctype: string): string {
  return `petal_quick_entry_${doctype}`
}
