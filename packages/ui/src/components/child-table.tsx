"use client"

import { useState } from "react"
import { createPortal } from "react-dom"
import { FieldInput } from "./field-input"
import { FieldValue } from "./field-value"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "./dialog"
import type { LinkFieldOption } from "./link-field"
import { cn } from "../lib/utils"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SYSTEM_FIELDS = new Set([
  "name", "idx", "doctype", "parent", "parenttype", "parentfield",
  "__islocal", "owner", "creation", "modified", "modified_by", "docstatus",
])

const STRUCTURAL_TYPES = new Set([
  "Section Break", "Column Break", "Tab Break",
  "HTML", "Button", "Heading", "Fold", "Break",
])

const FULL_WIDTH_TYPES = new Set([
  "Small Text", "Text", "Long Text", "Text Editor",
])

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChildTableMeta {
  fieldname: string
  fieldtype: string
  label: string
  /** Newline-separated Select options, or linked doctype name for Link fields */
  options?: string
  reqd?: 0 | 1
  in_list_view?: 0 | 1
  read_only?: 0 | 1
  hidden?: 0 | 1
  default?: string
}

/** Which field (and row) a link search is for — lets the host apply per-field queries. */
export interface LinkSearchContext {
  fieldname: string
  rowName?: string
}

export type LinkSearchFn = (doctype: string, query: string, ctx?: LinkSearchContext) => Promise<LinkFieldOption[]>

export interface ChildTableProps {
  label: string
  /**
   * Frappe field definitions for the child doctype.
   * Pass the `fields` array from `frappe.desk.form.load.getdoctype`.
   * Drives column order, labels, fieldtypes, and the expand-panel layout.
   */
  meta?: ChildTableMeta[]
  value: Record<string, unknown>[]
  /** When provided the table becomes editable (add / delete / inline edit). */
  onChange?: (rows: Record<string, unknown>[]) => void
  /**
   * Link-field autocomplete. Called with (linkedDoctype, query).
   * Wire this to `frappe.desk.search.search_link`.
   */
  onLinkSearch?: LinkSearchFn
  /** ISO 4217 currency code for Currency fields, e.g. "USD", "INR". */
  currency?: string
  disabled?: boolean
  className?: string
  /** Hide "Add row" (rows can still be edited and deleted). */
  cannotAddRows?: boolean
  /** Extra actions shown under the table. */
  buttons?: Array<{ label: string; onClick: () => void }>
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeNewRow(meta: ChildTableMeta[], idx: number): Record<string, unknown> {
  const row: Record<string, unknown> = { __islocal: 1, idx }
  for (const f of meta) {
    if (f.default !== undefined && f.default !== "") {
      row[f.fieldname] = f.default
    }
  }
  return row
}

function fmtCell(val: unknown, fieldtype = "Data", currency = "USD"): string {
  if (val == null || val === "") return ""
  if (fieldtype === "Currency") {
    const n = parseFloat(String(val))
    if (!isNaN(n)) return n.toLocaleString(undefined, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  if (val === 0) return "No"
  if (val === 1) return "Yes"
  return String(val)
}

// ---------------------------------------------------------------------------
// FieldInput renderer
// Avoids spread conflicts with exactOptionalPropertyTypes by branching on which
// optional props are present instead of spreading a Record<string, unknown>.
// ---------------------------------------------------------------------------

function renderFieldInput(
  field: ChildTableMeta,
  value: unknown,
  onChange: (v: unknown) => void,
  disabled: boolean,
  className: string,
  onLinkSearch?: LinkSearchFn,
  rowName?: string,
): React.ReactElement {
  if (field.fieldtype === "Link" && field.options !== undefined) {
    const linkedDoctype = field.options
    return (
      <FieldInput
        fieldtype="Link"
        value={value}
        onChange={onChange}
        disabled={disabled}
        className={className}
        options={linkedDoctype}
        linkedDoctype={linkedDoctype}
        onLinkSearch={
          onLinkSearch
            ? (q) => onLinkSearch(linkedDoctype, q, { fieldname: field.fieldname, ...(rowName ? { rowName } : {}) })
            : () => Promise.resolve([])
        }
      />
    )
  }
  if (field.options !== undefined) {
    return (
      <FieldInput
        fieldtype={field.fieldtype}
        value={value}
        onChange={onChange}
        disabled={disabled}
        className={className}
        options={field.options}
      />
    )
  }
  return (
    <FieldInput
      fieldtype={field.fieldtype}
      value={value}
      onChange={onChange}
      disabled={disabled}
      className={className}
    />
  )
}

// ---------------------------------------------------------------------------
// Expand panel — all meta fields in a responsive grid
// ---------------------------------------------------------------------------

function ExpandPanel({
  row,
  fields,
  editable,
  onUpdate,
  onLinkSearch,
  currency = "USD",
}: {
  row: Record<string, unknown>
  fields: ChildTableMeta[]
  editable: boolean
  onUpdate: (fieldname: string, value: unknown) => void
  onLinkSearch?: LinkSearchFn
  currency?: string
}) {
  return (
    <div>
      <div className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
        {fields.map((field) => {
          const isFullWidth = FULL_WIDTH_TYPES.has(field.fieldtype)
          const isReadOnly  = !editable || field.read_only === 1

          return (
            <div
              key={field.fieldname}
              className={cn(
                "flex flex-col gap-1",
                isFullWidth && "sm:col-span-2 lg:col-span-3",
              )}
            >
              <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground/60">
                {field.label}
                {field.reqd === 1 && (
                  <span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
                )}
              </span>
              {isReadOnly ? (
                <FieldValue
                  value={row[field.fieldname]}
                  fieldtype={field.fieldtype}
                  currency={currency}
                />
              ) : (
                renderFieldInput(
                  field,
                  row[field.fieldname],
                  (v) => onUpdate(field.fieldname, v),
                  false,
                  "w-full",
                  onLinkSearch,
                  typeof row.name === "string" ? row.name : undefined,
                )
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// ChildTable
// ---------------------------------------------------------------------------

export function ChildTable({
  label,
  meta,
  value,
  onChange,
  onLinkSearch,
  currency = "USD",
  disabled = false,
  className,
  cannotAddRows = false,
  buttons,
}: ChildTableProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null)

  const editable = !disabled && onChange !== undefined

  // ── Column derivation ──────────────────────────────────────────────────────

  const listCols: ChildTableMeta[] = (() => {
    if (meta) {
      const visible = meta.filter(
        (f) => !f.hidden && !SYSTEM_FIELDS.has(f.fieldname) && !STRUCTURAL_TYPES.has(f.fieldtype),
      )
      const inList = visible.filter((f) => f.in_list_view === 1)
      return (inList.length > 0 ? inList : visible.slice(0, 5)).slice(0, 8)
    }
    // Fallback: derive from first row keys
    if (value.length === 0) return []
    return Object.keys(value[0] ?? {})
      .filter((k) => !SYSTEM_FIELDS.has(k))
      .slice(0, 8)
      .map((fieldname) => ({
        fieldname,
        fieldtype: "Data",
        label: fieldname.replace(/_/g, " "),
      }))
  })()

  // All non-system non-structural meta fields for the expand panel
  const expandFields: ChildTableMeta[] = meta
    ? meta.filter(
        (f) =>
          !f.hidden &&
          !SYSTEM_FIELDS.has(f.fieldname) &&
          !STRUCTURAL_TYPES.has(f.fieldtype),
      )
    : []

  const showExpand = expandFields.length > 0

  const totalCols =
    1 +                      // # column
    listCols.length +
    (editable ? 1 : 0) +     // delete column
    (showExpand ? 1 : 0)     // eye column

  // ── Mutations ──────────────────────────────────────────────────────────────

  function updateCell(rowIdx: number, fieldname: string, val: unknown) {
    if (!onChange) return
    onChange(value.map((r, i) => (i === rowIdx ? { ...r, [fieldname]: val } : r)))
  }

  function addRow() {
    if (!onChange) return
    const newRow = makeNewRow(meta ?? [], value.length + 1)
    onChange([...value, newRow])
  }

  function deleteRow(rowIdx: number) {
    if (!onChange) return
    const next = value
      .filter((_, i) => i !== rowIdx)
      .map((r, i) => ({ ...r, idx: i + 1 }))
    onChange(next)
    setExpandedIdx((prev) => {
      if (prev === rowIdx) return null
      if (prev !== null && prev > rowIdx) return prev - 1
      return prev
    })
  }

  function toggleExpand(rowIdx: number) {
    setExpandedIdx((prev) => (prev === rowIdx ? null : rowIdx))
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className={cn(
        "col-span-full overflow-hidden rounded-xl border border-border bg-background",
        className,
      )}
    >
      {value.length === 0 && !editable ? (
        <p className="px-4 py-4 text-xs italic text-muted-foreground">No rows</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">

            {/* thead */}
            <thead>
              <tr className="border-b border-border/60 bg-muted/10">
                <th className="w-8 px-3 py-2.5 text-left font-semibold text-muted-foreground/60">
                  #
                </th>
                {listCols.map((col) => (
                  <th
                    key={col.fieldname}
                    className="whitespace-nowrap px-3 py-2.5 text-left font-semibold uppercase tracking-wide text-muted-foreground/60"
                  >
                    {col.label}
                    {col.reqd === 1 && (
                      <span className="ml-0.5 text-destructive" aria-hidden="true">*</span>
                    )}
                  </th>
                ))}
                {editable && <th className="w-8" />}
                {showExpand && <th className="w-8" />}
              </tr>
            </thead>

            {/* tbody */}
            <tbody>
              {value.map((row, rowIdx) => (
                <tr
                  key={typeof row.name === "string" ? row.name : rowIdx}
                  className={cn(
                    "border-b border-border/30 transition-colors",
                    rowIdx % 2 === 1
                      ? "bg-muted/10 hover:bg-muted/20"
                      : "hover:bg-muted/10",
                  )}
                >
                  {/* Row number */}
                  <td className="w-8 px-3 py-1.5 font-mono tabular-nums text-muted-foreground/40">
                    {rowIdx + 1}
                  </td>

                  {/* Data cells */}
                  {listCols.map((col) => {
                    const cellReadOnly = !editable || col.read_only === 1
                    return (
                      <td key={col.fieldname} className="px-2 py-1">
                        {cellReadOnly ? (
                          <span className="text-foreground/80">
                            {fmtCell(row[col.fieldname], col.fieldtype, currency) !== "" ? (
                              fmtCell(row[col.fieldname], col.fieldtype, currency)
                            ) : (
                              <span className="text-muted-foreground/30">—</span>
                            )}
                          </span>
                        ) : (
                          renderFieldInput(
                            col,
                            row[col.fieldname],
                            (v) => updateCell(rowIdx, col.fieldname, v),
                            false,
                            "w-full min-w-[80px]",
                            onLinkSearch,
                            typeof row.name === "string" ? row.name : undefined,
                          )
                        )}
                      </td>
                    )
                  })}

                  {/* Delete */}
                  {editable && (
                    <td className="w-8 px-1">
                      <button
                        type="button"
                        title="Delete row"
                        onClick={() => deleteRow(rowIdx)}
                        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/30 transition-colors hover:bg-destructive/10 hover:text-destructive"
                      >
                        <svg
                          className="h-3.5 w-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={1.8}
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </td>
                  )}

                  {/* Eye — view details */}
                  {showExpand && (
                    <td className="w-8 px-1">
                      <button
                        type="button"
                        title="View row details"
                        onClick={() => toggleExpand(rowIdx)}
                        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground/30 transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <svg
                          className="h-3.5 w-3.5"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={1.8}
                          aria-hidden="true"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                          />
                        </svg>
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>

            {/* ── Footer: Add Row + custom actions ── */}
            {((editable && !cannotAddRows) || (buttons && buttons.length > 0)) && (
              <tfoot>
                <tr>
                  <td colSpan={totalCols} className="border-t border-border/40 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-3">
                    {editable && !cannotAddRows && (
                    <button
                      type="button"
                      onClick={addRow}
                      className="flex items-center gap-1.5 text-xs font-medium text-primary/60 transition-colors hover:text-primary"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2.5}
                        aria-hidden="true"
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                      </svg>
                      Add Row
                    </button>
                    )}
                    {buttons?.map((b) => (
                      <button
                        key={b.label}
                        type="button"
                        onClick={b.onClick}
                        className="h-7 rounded-md border border-border px-2.5 text-xs font-medium text-foreground/80 transition-colors hover:bg-accent"
                      >
                        {b.label}
                      </button>
                    ))}
                    </div>
                  </td>
                </tr>
              </tfoot>
            )}

          </table>
        </div>
      )}

      {/* ── Row detail modal ── */}
      {showExpand && expandedIdx !== null && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[49] bg-black/40 backdrop-blur-sm" />,
        document.body,
      )}
      {showExpand && (
        <Dialog
          modal={false}
          open={expandedIdx !== null}
          onOpenChange={(open) => { if (!open) setExpandedIdx(null) }}
        >
          <DialogContent
            className="max-w-2xl max-h-[85vh] overflow-y-auto"
            onInteractOutside={(e) => {
              if (typeof document !== "undefined" && document.querySelector("[data-link-portal],[data-petal-popover]")) {
                e.preventDefault()
              }
            }}
          >
            <DialogHeader>
              <DialogTitle className="text-sm font-semibold">
                {label}
                {expandedIdx !== null && (
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    Row {expandedIdx + 1}
                  </span>
                )}
              </DialogTitle>
            </DialogHeader>
            {expandedIdx !== null && value[expandedIdx] !== undefined && (
              <ExpandPanel
                row={value[expandedIdx]}
                fields={expandFields.length > 0 ? expandFields : listCols}
                editable={editable}
                onUpdate={(fn, v) => updateCell(expandedIdx, fn, v)}
                {...(onLinkSearch !== undefined ? { onLinkSearch } : {})}
                currency={currency}
              />
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
