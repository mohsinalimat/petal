"use client"

import * as React from "react"
import { useEffect, useMemo, useState } from "react"

export type BulkEditField = { fieldname: string; fieldtype: string; label: string; options?: string; read_only?: 0 | 1; hidden?: 0 | 1 }

export type BulkEditDialogProps = {
  open: boolean
  count: number
  fields: BulkEditField[]
  onApply: (fieldname: string, value: unknown) => Promise<void>
  onClose: () => void
}

const EDITABLE = new Set([
  "Data", "Select", "Link", "Check", "Int", "Float", "Currency", "Percent",
  "Date", "Datetime", "Small Text", "Text", "Long Text", "Phone", "Rating", "Color",
])

export function bulkEditableFields(fields: BulkEditField[]): BulkEditField[] {
  return fields
    .filter((f) => EDITABLE.has(f.fieldtype) && f.read_only !== 1 && f.hidden !== 1)
    .sort((a, b) => (a.label || a.fieldname).localeCompare(b.label || b.fieldname))
}

function coerce(fieldtype: string, raw: string | boolean): unknown {
  if (fieldtype === "Check") return raw ? 1 : 0
  if (["Int"].includes(fieldtype)) return raw === "" ? null : parseInt(String(raw), 10)
  if (["Float", "Currency", "Percent", "Rating"].includes(fieldtype)) return raw === "" ? null : Number(raw)
  if (fieldtype === "Datetime" && typeof raw === "string") return raw.replace("T", " ")
  return raw
}

/** Set one field to the same value on every selected record. */
export function BulkEditDialog({ open, count, fields, onApply, onClose }: BulkEditDialogProps) {
  const editable = useMemo(() => bulkEditableFields(fields), [fields])
  const [fieldname, setFieldname] = useState("")
  const [value, setValue] = useState<string | boolean>("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const field = editable.find((f) => f.fieldname === fieldname)

  useEffect(() => {
    if (open) { setFieldname(editable[0]?.fieldname ?? ""); setValue(""); setError(null) }
  }, [open, editable])

  if (!open) return null

  async function apply(e: React.FormEvent) {
    e.preventDefault()
    if (!field) return
    setSaving(true); setError(null)
    try {
      await onApply(field.fieldname, coerce(field.fieldtype, value))
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : "Update failed")
    } finally {
      setSaving(false)
    }
  }

  const inputCls = "w-full h-9 rounded-lg border border-border bg-background px-3 text-sm"

  return (
    <div className="fixed inset-0 z-[700] flex items-end sm:items-center justify-center bg-black/50 backdrop-blur-sm" onClick={(e) => { if (e.target === e.currentTarget && !saving) onClose() }}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-edit-title"
        onSubmit={apply}
        className="w-full sm:max-w-md sm:mx-4 rounded-t-2xl sm:rounded-2xl border border-border bg-background p-5 sm:p-6 shadow-2xl space-y-4"
      >
        <div>
          <h2 id="bulk-edit-title" className="text-base font-semibold text-foreground">Edit {count} record{count === 1 ? "" : "s"}</h2>
          <p className="text-sm text-muted-foreground mt-1">The chosen field will be set to the same value on every selected record.</p>
        </div>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Field</span>
          <select aria-label="Field" value={fieldname} onChange={(e) => { setFieldname(e.target.value); setValue("") }} className={inputCls}>
            {editable.map((f) => <option key={f.fieldname} value={f.fieldname}>{f.label || f.fieldname}</option>)}
          </select>
        </label>
        {field && (
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">New value</span>
            {field.fieldtype === "Select" ? (
              <select aria-label="New value" value={String(value)} onChange={(e) => setValue(e.target.value)} className={inputCls}>
                {(field.options ?? "").split("\n").map((o) => <option key={o} value={o}>{o || "(empty)"}</option>)}
              </select>
            ) : field.fieldtype === "Check" ? (
              <span className="flex items-center gap-2 h-9">
                <input aria-label="New value" type="checkbox" checked={value === true} onChange={(e) => setValue(e.target.checked)} />
                <span className="text-sm">{value === true ? "Yes" : "No"}</span>
              </span>
            ) : (
              <input
                aria-label="New value"
                value={String(value)}
                onChange={(e) => setValue(e.target.value)}
                type={
                  field.fieldtype === "Date" ? "date"
                  : field.fieldtype === "Datetime" ? "datetime-local"
                  : ["Int", "Float", "Currency", "Percent", "Rating"].includes(field.fieldtype) ? "number"
                  : "text"
                }
                step="any"
                placeholder={field.fieldtype === "Link" ? `${field.options ?? ""} name` : ""}
                className={inputCls}
              />
            )}
          </label>
        )}
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="h-9 px-4 rounded-lg border border-border text-sm hover:bg-accent">Cancel</button>
          <button type="submit" disabled={saving || !field} className="h-9 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold disabled:opacity-60">
            {saving ? "Updating…" : "Update"}
          </button>
        </div>
      </form>
    </div>
  )
}
