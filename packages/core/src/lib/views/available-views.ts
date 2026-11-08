// Decide which alternate views a doctype supports and which fields they use.

import { dateFields, defaultGroupField, groupableFields } from "@petal/ui"
import type { DocViewKey } from "@petal/ui"

type ViewField = { fieldname: string; fieldtype: string; label: string; options?: string; hidden?: 0 | 1 }
type ViewMeta = { fields: ViewField[]; is_tree?: 0 | 1; issingle?: 0 | 1 }

function visible(fields: ViewField[]): ViewField[] {
  return fields.filter((f) => f.hidden !== 1)
}

export function availableViews(meta: ViewMeta): DocViewKey[] {
  if (meta.issingle === 1) return []
  const fields = visible(meta.fields)
  const dates = dateFields(fields)
  const views: DocViewKey[] = ["list"]
  if (groupableFields(fields).length > 0) views.push("kanban")
  if (dates.length > 0) views.push("calendar")
  if (dates.length > 1) views.push("gantt")
  if (meta.is_tree === 1) views.push("tree")
  return views
}

const START_HINTS = ["start_date", "from_date", "exp_start_date", "starts_on", "start", "date", "posting_date", "transaction_date"]
const END_HINTS = ["end_date", "to_date", "exp_end_date", "ends_on", "end", "due_date", "expected_end_date"]

function pick(names: string[], hints: string[], exclude?: string | null): string | null {
  for (const h of hints) if (names.includes(h) && h !== exclude) return h
  return null
}

/** Best-guess start/end date fields for calendar and gantt views. */
export function defaultDateFields(meta: ViewMeta): { start: string | null; end: string | null } {
  const names = dateFields(visible(meta.fields)).map((f) => f.fieldname)
  if (names.length === 0) return { start: null, end: null }
  const start = pick(names, START_HINTS) ?? names[0]!
  const end = pick(names, END_HINTS, start) ?? names.find((n) => n !== start) ?? null
  return { start, end }
}

export function defaultKanbanField(meta: ViewMeta): string | null {
  return defaultGroupField(visible(meta.fields))
}

/** First numeric 0–100 style field usable as a gantt progress bar. */
export function defaultProgressField(meta: ViewMeta): string | null {
  const f = visible(meta.fields).find(
    (x) => x.fieldtype === "Percent" || (["Float", "Int"].includes(x.fieldtype) && /progress|percent|complete/.test(x.fieldname)),
  )
  return f?.fieldname ?? null
}

export function viewPath(view: DocViewKey, doctype: string): string {
  const dt = encodeURIComponent(doctype)
  switch (view) {
    case "list": return `/list/${dt}`
    case "tree": return `/tree/${dt}`
    case "report": return `/list/${dt}?view=list`
    default: return `/${view}/${dt}`
  }
}
