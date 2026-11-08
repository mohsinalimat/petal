// Kanban board helpers: pick a grouping field and bucket rows into columns.

export type KanbanField = { fieldname: string; fieldtype: string; label: string; options?: string }

export type KanbanColumn = {
  value: string
  label: string
  rows: Record<string, unknown>[]
}

export const UNSET_COLUMN = "__unset__"

/** Fields a board can be grouped by: Select fields with options, plus Link fields. */
export function groupableFields(fields: KanbanField[]): KanbanField[] {
  return fields.filter(
    (f) => (f.fieldtype === "Select" && (f.options ?? "").trim() !== "") || f.fieldtype === "Link",
  )
}

/** Default grouping: a Select named "status", then any Select, then any Link. */
export function defaultGroupField(fields: KanbanField[]): string | null {
  const g = groupableFields(fields)
  return (
    g.find((f) => f.fieldtype === "Select" && f.fieldname === "status")?.fieldname ??
    g.find((f) => f.fieldtype === "Select")?.fieldname ??
    g[0]?.fieldname ??
    null
  )
}

export function selectOptions(field: KanbanField): string[] {
  return (field.options ?? "").split("\n").map((o) => o.trim()).filter(Boolean)
}

/**
 * Bucket rows into columns. Select fields get one column per option (in option
 * order, even when empty); Link fields get one column per distinct value seen.
 * Rows with an empty or unknown value land in a trailing "Not set" column,
 * which is omitted when empty.
 */
export function buildColumns(rows: Record<string, unknown>[], field: KanbanField): KanbanColumn[] {
  const values = field.fieldtype === "Select"
    ? selectOptions(field)
    : Array.from(new Set(rows.map((r) => String(r[field.fieldname] ?? "")).filter(Boolean))).sort()

  const cols = new Map<string, KanbanColumn>(values.map((v) => [v, { value: v, label: v, rows: [] }]))
  const unset: KanbanColumn = { value: UNSET_COLUMN, label: "Not set", rows: [] }

  for (const row of rows) {
    const v = String(row[field.fieldname] ?? "")
    ;(cols.get(v) ?? unset).rows.push(row)
  }
  const out = Array.from(cols.values())
  if (unset.rows.length) out.push(unset)
  return out
}

/** Optimistically move a row between columns. Returns new column array (input untouched). */
export function moveCard(
  columns: KanbanColumn[],
  name: string,
  toValue: string,
  fieldname: string,
): KanbanColumn[] {
  let moved: Record<string, unknown> | undefined
  const stripped = columns.map((c) => {
    const idx = c.rows.findIndex((r) => r.name === name)
    if (idx === -1) return c
    moved = c.rows[idx]
    return { ...c, rows: c.rows.filter((_, i) => i !== idx) }
  })
  if (!moved) return columns
  const updated = { ...moved, [fieldname]: toValue === UNSET_COLUMN ? "" : toValue }
  return stripped.map((c) => (c.value === toValue ? { ...c, rows: [updated, ...c.rows] } : c))
}
