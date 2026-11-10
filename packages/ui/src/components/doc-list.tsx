"use client"

import * as React from "react"
import { useState, useEffect, useMemo, useCallback, useRef } from "react"
import { createPortal } from "react-dom"
import { cn } from "../lib/utils"
import { DeleteConfirmDialog } from "./delete-confirm-dialog"
import { BulkEditDialog, bulkEditableFields } from "./bulk-edit-dialog"
import { downloadText, toCsv } from "../lib/csv"

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type ListMetaField = {
  fieldname: string
  fieldtype: string
  label: string
  in_list_view?: 0 | 1
  in_standard_filter?: 0 | 1
  options?: string
  reqd?: 0 | 1
}

export type DocListMeta = {
  name: string
  title_field?: string
  search_fields?: string
  image_field?: string
  sort_field?: string
  sort_order?: "ASC" | "DESC" | string
  is_submittable?: 0 | 1
  is_tree?: 0 | 1
  quick_entry?: 0 | 1
  fields: ListMetaField[]
}

export type DocListFilter = [string, string, string, unknown]

export type DocListFetchParams = {
  fields: string[]
  filters: DocListFilter[]
  or_filters: DocListFilter[]
  order_by: string
  limit: number
  limit_start: number
}

export type DocListProps = {
  doctype: string
  meta: DocListMeta
  onFetchData: (params: DocListFetchParams) => Promise<{ rows: Record<string, unknown>[]; total: number }>
  onRowClick: (name: string) => void
  onNewClick: () => void
  onDelete?: (names: string[]) => Promise<void>
  onCancel?: (names: string[]) => Promise<void>
  onTreeClick?: (() => void) | undefined
  onFetchLinkOptions?: (doctype: string, search: string) => Promise<string[]>
  /** ISO 4217 currency code for Currency fields, e.g. "USD", "INR". */
  currency?: string
  defaultView?: "list" | "grid"
  onViewChange?: (view: "list" | "grid") => void
  /** Set every selected record's `fieldname` to `value`. Enables "Edit selected". */
  onBulkUpdate?: (names: string[], fieldname: string, value: unknown) => Promise<void>
  /** Submit the selected draft records. Enables "Submit selected" on submittable doctypes. */
  onBulkSubmit?: (names: string[]) => Promise<void>
  /** Enables the "Import" menu entry. */
  onImportClick?: () => void
  /** Rendered at the start of the toolbar, e.g. a view switcher. */
  toolbarStart?: React.ReactNode
  /** Increment to refetch the current page without resetting filters (e.g. on realtime updates). */
  refreshSignal?: number
  className?: string
  /** Extra fields to fetch with each row (e.g. ones a status indicator reads). */
  extraFields?: string[]
  /** Status shown next to each row's title; replaces the docstatus dot. Return null for none. */
  rowIndicator?: (row: Record<string, unknown>) => DocListIndicator | null
  /** Custom cell content. Return undefined to fall back to the default formatting. */
  renderCell?: (fieldname: string, value: unknown, row: Record<string, unknown>) => React.ReactNode | undefined
  /** Filters applied when the list first loads, e.g. [["status", "=", "Open"]]. */
  initialFilters?: Array<DocListFilter | [string, string, unknown]>
  /** Extra actions for the selected rows, listed in the "More actions" menu. */
  selectionActions?: DocListAction[]
  /** Extra entries in the "More actions" menu when nothing is selected. */
  menuActions?: DocListAction[]
  /** Rendered just before the Create button, e.g. custom toolbar buttons. */
  toolbarEnd?: React.ReactNode
  /** Called whenever the selection changes. */
  onSelectionChange?: (names: string[]) => void
  /** Called with each page of rows after it loads. */
  onRowsLoaded?: (rows: Record<string, unknown>[]) => void
  /** Increment to clear the selection. */
  clearSelectionSignal?: number
}

export type DocListIndicator = { label: string; color: string }
export type DocListAction = { label: string; onClick: (names: string[]) => void; danger?: boolean }

const INDICATOR_PILL: Record<string, string> = {
  green: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900",
  red: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900",
  orange: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900",
  yellow: "bg-yellow-50 text-yellow-800 border-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-300 dark:border-yellow-900",
  blue: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900",
  purple: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-900",
  gray: "bg-muted text-muted-foreground border-border",
}
const INDICATOR_ALIAS: Record<string, string> = { grey: "gray", darkgrey: "gray", "light-blue": "blue", cyan: "blue", pink: "purple", black: "gray", "light-gray": "gray" }

function IndicatorPill({ indicator }: { indicator: DocListIndicator }) {
  const key = INDICATOR_ALIAS[indicator.color] ?? indicator.color
  return (
    <span className={cn("inline-flex items-center shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium leading-none whitespace-nowrap", INDICATOR_PILL[key] ?? INDICATOR_PILL.gray)}>
      {indicator.label}
    </span>
  )
}

/** Desk-style [field, op, value] or [doctype, field, op, value] → the list's editable filter rows. */
function toActiveFilters(list: Array<DocListFilter | [string, string, unknown]> | undefined): ActiveFilter[] {
  const out: ActiveFilter[] = []
  for (const f of list ?? []) {
    const [field, op, value] = f.length === 4 ? [f[1], f[2], f[3]] : [f[0], f[1], f[2]]
    if (!field || !op) continue
    let operator = String(op).toLowerCase()
    let v: string
    if (operator === "is") { operator = value === "not set" ? "is not set" : "is set"; v = "" }
    else v = Array.isArray(value) ? value.join(",") : String(value ?? "")
    out.push({ id: `init-${out.length}-${field}`, field, operator, value: v })
  }
  return out
}

/** Upper bound on rows fetched for a CSV export of the filtered list. */
export const EXPORT_LIMIT = 5000

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

type SortDir = "asc" | "desc"
type ViewMode = "list" | "grid"

type ActiveFilter = {
  id: string
  field: string
  operator: string
  value: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const
const INLINE_FILTER_LIMIT = 3

const SKIP_FIELDTYPES = new Set([
  "Section Break", "Column Break", "HTML", "Code", "Table",
  "Table MultiSelect", "Fold", "Heading", "Tab Break", "Button",
])

const OPERATORS_TEXT   = ["=", "!=", "like", "not like", "is set", "is not set"]
const OPERATORS_NUMBER = ["=", "!=", "<", ">", "<=", ">=", "is set", "is not set"]
const OPERATORS_SELECT = ["=", "!=", "in", "not in", "is set", "is not set"]

function operatorsFor(fieldtype: string): string[] {
  if (["Int", "Float", "Currency", "Percent", "Duration"].includes(fieldtype)) return OPERATORS_NUMBER
  if (["Select", "Link"].includes(fieldtype))                                   return OPERATORS_SELECT
  if (fieldtype === "Check")                                                     return ["="]
  if (["Date", "Datetime", "Time"].includes(fieldtype))                         return OPERATORS_NUMBER
  return OPERATORS_TEXT
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

const DOCSTATUS: Record<number, { label: string; dot: string; pill: string; pillActive: string }> = {
  0: {
    label: "Draft",
    dot: "bg-amber-400",
    pill: "border-border text-muted-foreground hover:border-amber-300 hover:text-amber-700 dark:hover:text-amber-400",
    pillActive: "border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:border-amber-600 dark:text-amber-400",
  },
  1: {
    label: "Submitted",
    dot: "bg-green-500",
    pill: "border-border text-muted-foreground hover:border-green-300 hover:text-green-700 dark:hover:text-green-400",
    pillActive: "border-green-300 bg-green-50 text-green-700 dark:bg-green-900/30 dark:border-green-600 dark:text-green-400",
  },
  2: {
    label: "Cancelled",
    dot: "bg-red-400 opacity-60",
    pill: "border-border text-muted-foreground hover:border-red-300 hover:text-red-600 dark:hover:text-red-400",
    pillActive: "border-red-300 bg-red-50 text-red-600 dark:bg-red-900/30 dark:border-red-600 dark:text-red-400",
  },
}

function formatCell(val: unknown, fieldtype: string, currency = "USD"): React.ReactNode {
  if (val == null || val === "") return <span className="text-muted-foreground/50">—</span>

  if (fieldtype === "Check") {
    return (
      <span className={cn(
        "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full",
        val ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" : "bg-muted text-muted-foreground"
      )}>
        {val ? "Yes" : "No"}
      </span>
    )
  }

  if (fieldtype === "Date" && typeof val === "string") {
    // Parse YYYY-MM-DD in local time to avoid UTC midnight timezone shifts
    const parts = val.split("-").map(Number)
    const d = new Date(parts[0]!, (parts[1]! - 1), parts[2]!)
    if (isNaN(d.getTime())) return String(val)
    return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" })
  }

  if (fieldtype === "Datetime" && typeof val === "string") {
    // Frappe returns "YYYY-MM-DD HH:MM:SS" — replace space with T for valid ISO 8601
    const d = new Date(val.replace(" ", "T"))
    if (isNaN(d.getTime())) return String(val)
    return d.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
  }

  if (fieldtype === "Currency") {
    const num = parseFloat(String(val))
    if (!isNaN(num)) return num.toLocaleString(undefined, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  if (fieldtype === "Float") {
    const num = parseFloat(String(val))
    if (!isNaN(num)) return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }

  if (fieldtype === "Int") {
    const num = parseFloat(String(val))
    if (!isNaN(num)) return num.toLocaleString()
  }

  if (fieldtype === "Percent") {
    const num = parseFloat(String(val))
    if (!isNaN(num)) {
      const clamped = Math.min(100, Math.max(0, num))
      return (
        <div className="flex items-center gap-2 min-w-[80px]">
          <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full w-full origin-left bg-primary transition-transform"
              style={{ transform: `scaleX(${clamped / 100})` }}
            />
          </div>
          <span className="text-xs tabular-nums shrink-0 text-muted-foreground">{num.toLocaleString()}%</span>
        </div>
      )
    }
  }

  return <span className="truncate max-w-[200px] block">{String(val)}</span>
}

// ---------------------------------------------------------------------------
// Card color helper — deterministic hue from a string
// ---------------------------------------------------------------------------

function strToHue(str: string): number {
  let h = 0
  for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h)
  return Math.abs(h) % 360
}

// ---------------------------------------------------------------------------
// SortIcon
// ---------------------------------------------------------------------------

function SortIcon({ field, sortField, sortDir }: { field: string; sortField: string; sortDir: SortDir }) {
  if (field !== sortField) return (
    <svg className="w-3 h-3 text-muted-foreground/30" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4" />
    </svg>
  )
  return (
    <svg className="w-3 h-3 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      {sortDir === "asc"
        ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
        : <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
      }
    </svg>
  )
}

// ---------------------------------------------------------------------------
// LinkAutocompleteInput
// ---------------------------------------------------------------------------

function LinkAutocompleteInput({
  value,
  onChange,
  linkedDoctype,
  onFetchLinkOptions,
  placeholder,
  className,
}: {
  value: string
  onChange: (v: string) => void
  linkedDoctype: string
  onFetchLinkOptions: (doctype: string, search: string) => Promise<string[]>
  placeholder?: string
  className?: string
}) {
  const [open, setOpen]         = useState(false)
  const [options, setOptions]   = useState<string[]>([])
  const [fetching, setFetching] = useState(false)
  const [localVal, setLocalVal] = useState(value)
  const [rect, setRect]         = useState<DOMRect | null>(null)
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef   = useRef<HTMLInputElement>(null)
  const dropRef    = useRef<HTMLDivElement>(null)

  useEffect(() => { setLocalVal(value) }, [value])

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        inputRef.current && !inputRef.current.contains(e.target as Node) &&
        dropRef.current  && !dropRef.current.contains(e.target as Node)
      ) setOpen(false)
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  function triggerFetch(q: string) {
    if (timerRef.current) clearTimeout(timerRef.current)
    setFetching(true)
    if (inputRef.current) setRect(inputRef.current.getBoundingClientRect())
    timerRef.current = setTimeout(async () => {
      setOpen(true)
      try {
        const results = await onFetchLinkOptions(linkedDoctype, q)
        setOptions(results)
      } catch { setOptions([]) }
      finally { setFetching(false) }
    }, 250)
  }

  const dropdown = open && rect && createPortal(
    <div
      ref={dropRef}
      data-no-dismiss="true"
      style={{ position: "fixed", top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 200), zIndex: 9999 }}
      className="bg-background border border-border rounded-lg shadow-xl max-h-52 overflow-y-auto"
    >
      {fetching ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">Loading…</p>
      ) : options.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">No results</p>
      ) : (
        options.map((opt) => (
          <button
            key={opt}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { onChange(opt); setLocalVal(opt); setOpen(false) }}
            className={cn(
              "w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors",
              value === opt && "bg-primary/5 text-primary font-medium",
            )}
          >
            {opt}
          </button>
        ))
      )}
    </div>,
    document.body,
  )

  return (
    <div className={cn("relative", className)}>
      <svg className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        value={localVal}
        onChange={(e) => { setLocalVal(e.target.value); triggerFetch(e.target.value) }}
        onFocus={() => triggerFetch(localVal)}
        placeholder={placeholder ?? `${linkedDoctype}…`}
        className="h-8 pl-6 pr-6 rounded-lg border border-border bg-background text-foreground text-xs w-36 focus:outline-none focus:ring-1 focus:ring-primary/60 focus:border-primary/60 placeholder:text-muted-foreground/60"
      />
      {localVal && (
        <button
          type="button"
          onClick={() => { setLocalVal(""); onChange(""); setOpen(false) }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
      )}
      {dropdown}
    </div>
  )
}

// ---------------------------------------------------------------------------
// FilterValueInput
// ---------------------------------------------------------------------------

function FilterValueInput({
  field,
  value,
  onChange,
  onFetchLinkOptions,
}: {
  field: ListMetaField | undefined
  value: string
  onChange: (v: string) => void
  onFetchLinkOptions?: (doctype: string, search: string) => Promise<string[]>
}) {
  const ft = field?.fieldtype ?? "Data"

  if (ft === "Check") {
    return (
      <div className="flex items-center gap-1 h-8 rounded-lg border border-border bg-background px-2">
        {["Yes", "No"].map((label) => {
          const v = label === "Yes" ? "1" : "0"
          return (
            <button
              key={label}
              type="button"
              onClick={() => onChange(v)}
              className={cn(
                "text-xs px-2 py-0.5 rounded-md transition-colors",
                value === v ? "bg-primary text-white font-medium" : "text-foreground/70 hover:bg-accent",
              )}
            >
              {label}
            </button>
          )
        })}
      </div>
    )
  }

  if (ft === "Select" && field?.options) {
    const opts = field.options.split("\n").filter(Boolean)
    return (
      <ComboboxInput
        value={value}
        onChange={onChange}
        options={[{ value: "", label: "Any" }, ...opts.map((o) => ({ value: o, label: o }))]}
        placeholder="Select…"
        className="w-36"
      />
    )
  }

  if (ft === "Link") {
    const linkedDoctype = field?.options ?? ""
    if (onFetchLinkOptions && linkedDoctype) {
      return (
        <LinkAutocompleteInput
          value={value}
          onChange={onChange}
          linkedDoctype={linkedDoctype}
          onFetchLinkOptions={onFetchLinkOptions}
        />
      )
    }
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={linkedDoctype ? `${linkedDoctype}…` : "Link…"}
        className="h-8 pl-2.5 pr-2.5 rounded-lg border border-border bg-background text-foreground text-xs w-36 focus:outline-none focus:ring-1 focus:ring-primary/60 focus:border-primary/60 placeholder:text-muted-foreground/60"
      />
    )
  }

  const inputType  = ft === "Date" ? "date" : ft === "Datetime" ? "datetime-local" : "text"
  const inputMode  = ["Int", "Float", "Currency", "Percent"].includes(ft) ? ("numeric" as const) : undefined

  return (
    <input
      type={inputType}
      inputMode={inputMode}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Value…"
      className="h-8 px-2.5 rounded-lg border border-border bg-background text-foreground text-xs w-36 focus:outline-none focus:ring-1 focus:ring-primary/60 focus:border-primary/60 placeholder:text-muted-foreground/60"
    />
  )
}

// ---------------------------------------------------------------------------
// ComboboxInput — searchable autocomplete over a fixed option list (portal dropdown)
// ---------------------------------------------------------------------------

function ComboboxInput({
  value,
  onChange,
  options,
  placeholder,
  className,
}: {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
  className?: string
}) {
  const selected = options.find((o) => o.value === value)
  const [open, setOpen]   = useState(false)
  const [query, setQuery] = useState("")
  const [rect, setRect]   = useState<DOMRect | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const dropRef  = useRef<HTMLDivElement>(null)

  const filtered = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        inputRef.current && !inputRef.current.contains(e.target as Node) &&
        !(dropRef.current && dropRef.current.contains(e.target as Node))
      ) {
        setOpen(false)
        setQuery("")
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  function openDropdown() {
    if (inputRef.current) setRect(inputRef.current.getBoundingClientRect())
    setOpen(true)
    setQuery("")
  }

  function pick(opt: { value: string; label: string }) {
    onChange(opt.value)
    setOpen(false)
    setQuery("")
  }

  const dropdown = open && rect && createPortal(
    <div
      ref={dropRef}
      data-no-dismiss="true"
      style={{ position: "fixed", top: rect.bottom + 4, left: rect.left, width: Math.max(rect.width, 180), zIndex: 9999 }}
      className="bg-background border border-border rounded-lg shadow-xl max-h-52 overflow-y-auto"
    >
      {filtered.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">No results</p>
      ) : (
        filtered.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => pick(opt)}
            className={cn(
              "w-full text-left px-3 py-1.5 text-xs hover:bg-accent transition-colors",
              value === opt.value && "bg-primary/5 text-primary font-medium",
            )}
          >
            {opt.label}
          </button>
        ))
      )}
    </div>,
    document.body,
  )

  return (
    <div className={cn("relative", className)}>
      <input
        ref={inputRef}
        type="text"
        value={open ? query : (selected?.label ?? "")}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={openDropdown}
        onClick={openDropdown}
        placeholder={placeholder ?? "Select…"}
        className="h-8 pl-2.5 pr-6 rounded-lg border border-border bg-background text-foreground text-xs focus:outline-none focus:ring-1 focus:ring-primary/60 focus:border-primary/60 placeholder:text-muted-foreground/60 w-full"
      />
      <svg
        className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/60"
        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
      >
        <path strokeLinecap="round" d="M19 9l-7 7-7-7"/>
      </svg>
      {dropdown}
    </div>
  )
}

// ---------------------------------------------------------------------------
// FilterRow — one row inside the filter panel
// ---------------------------------------------------------------------------

function FilterRow({
  filter,
  fields,
  onChange,
  onRemove,
  onFetchLinkOptions,
}: {
  filter: ActiveFilter
  fields: ListMetaField[]
  onChange: (updated: ActiveFilter) => void
  onRemove: () => void
  onFetchLinkOptions?: (doctype: string, search: string) => Promise<string[]>
}) {
  const selectedField = fields.find((f) => f.fieldname === filter.field)
  const ops     = selectedField ? operatorsFor(selectedField.fieldtype) : OPERATORS_TEXT
  const noValue = filter.operator === "is set" || filter.operator === "is not set"

  function handleFieldChange(fieldname: string) {
    const newField = fields.find((f) => f.fieldname === fieldname)
    const newOps   = newField ? operatorsFor(newField.fieldtype) : OPERATORS_TEXT
    onChange({
      ...filter,
      field: fieldname,
      operator: newOps.includes(filter.operator) ? filter.operator : (newOps[0] ?? "="),
      value: "",
    })
  }

  return (
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <ComboboxInput
        value={filter.field}
        onChange={handleFieldChange}
        options={fields.map((f) => ({ value: f.fieldname, label: f.label }))}
        placeholder="Field…"
        className="min-w-0 flex-1"
      />

      <ComboboxInput
        value={filter.operator}
        onChange={(op) => onChange({ ...filter, operator: op, value: "" })}
        options={ops.map((op) => ({ value: op, label: op }))}
        placeholder="Operator…"
        className="shrink-0 w-28"
      />

      {!noValue && (
        <FilterValueInput
          field={selectedField}
          value={filter.value}
          onChange={(v) => onChange({ ...filter, value: v })}
          {...(onFetchLinkOptions ? { onFetchLinkOptions } : {})}
        />
      )}

      <button
        onClick={onRemove}
        className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors shrink-0"
      >
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// StandardFilterInput — inline filter input driven by field metadata
// ---------------------------------------------------------------------------

function StandardFilterInput({
  field,
  value,
  onChange,
  onFetchLinkOptions,
}: {
  field: ListMetaField
  value: string
  onChange: (v: string) => void
  onFetchLinkOptions?: (doctype: string, search: string) => Promise<string[]>
}) {
  const [localValue, setLocalValue] = useState(value)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { setLocalValue(value) }, [value])

  const ft = field.fieldtype

  if (ft === "Select" && field.options) {
    const opts = field.options.split("\n").filter(Boolean)
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-medium text-muted-foreground leading-none px-0.5">{field.label}</span>
        <div className="relative">
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 pl-2.5 pr-7 rounded-lg border border-border bg-background text-foreground text-xs appearance-none focus:outline-none focus:ring-1 focus:ring-primary/60 focus:border-primary/60"
          >
            <option value="">All</option>
            {opts.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          <svg className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" d="M19 9l-7 7-7-7"/>
          </svg>
        </div>
      </div>
    )
  }

  if (ft === "Check") {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-medium text-muted-foreground leading-none px-0.5">{field.label}</span>
        <div className="flex items-center gap-0.5 h-8 rounded-lg border border-border bg-background px-1">
          {(["", "1", "0"] as const).map((v, i) => {
            const label = i === 0 ? "All" : i === 1 ? "Yes" : "No"
            return (
              <button
                key={label}
                type="button"
                onClick={() => onChange(v)}
                className={cn(
                  "text-xs px-2 py-0.5 rounded-md transition-colors",
                  value === v ? "bg-primary text-white font-medium" : "text-foreground/70 hover:bg-accent",
                )}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  if (ft === "Link" && onFetchLinkOptions && field.options) {
    return (
      <div className="flex flex-col gap-0.5">
        <span className="text-[10px] font-medium text-muted-foreground leading-none px-0.5">{field.label}</span>
        <LinkAutocompleteInput
          value={value}
          onChange={onChange}
          linkedDoctype={field.options}
          onFetchLinkOptions={onFetchLinkOptions}
        />
      </div>
    )
  }

  const inputType  = ft === "Date" ? "date" : ft === "Datetime" ? "datetime-local" : "text"
  const inputMode  = ["Int", "Float", "Currency", "Percent"].includes(ft) ? ("numeric" as const) : undefined

  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium text-muted-foreground leading-none px-0.5">{field.label}</span>
      <div className="relative">
        <input
          type={inputType}
          inputMode={inputMode}
          value={localValue}
          onChange={(e) => {
            const v = e.target.value
            setLocalValue(v)
            if (timer.current) clearTimeout(timer.current)
            timer.current = setTimeout(() => onChange(v), 400)
          }}
          placeholder={`${field.label}…`}
          className="h-8 pl-2.5 pr-7 rounded-lg border border-border bg-background text-foreground text-xs w-36 focus:outline-none focus:ring-1 focus:ring-primary/60 focus:border-primary/60 placeholder:text-muted-foreground/60"
        />
        {localValue && (
          <button
            type="button"
            onClick={() => {
              if (timer.current) clearTimeout(timer.current)
              setLocalValue("")
              onChange("")
            }}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DocList
// ---------------------------------------------------------------------------

export function DocList({ doctype, meta, onFetchData, onRowClick, onNewClick, onDelete, onCancel, onTreeClick, onFetchLinkOptions, currency = "USD", defaultView, onViewChange, onBulkUpdate, onBulkSubmit, onImportClick, toolbarStart, refreshSignal = 0, className, extraFields, rowIndicator, renderCell, initialFilters, selectionActions, menuActions, toolbarEnd, onSelectionChange, onRowsLoaded, clearSelectionSignal = 0 }: DocListProps) {
  // Data state
  const [rows, setRows]       = useState<Record<string, unknown>[]>([])
  const [total, setTotal]     = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  // Controls
  const [page, setPage]               = useState(0)
  const [pageSize, setPageSize]       = useState<typeof PAGE_SIZE_OPTIONS[number]>(20)
  const [sortField, setSortField]     = useState(meta.sort_field ?? "modified")
  const [sortDir, setSortDir]         = useState<SortDir>((meta.sort_order?.toLowerCase() as SortDir) ?? "desc")
  const [filters, setFilters]               = useState<ActiveFilter[]>(() => toActiveFilters(initialFilters))
  const [showFilterPanel, setShowFilterPanel] = useState(false)
  const [draftFilters, setDraftFilters]     = useState<ActiveFilter[]>([])
  const [stdFilters, setStdFilters]         = useState<Record<string, string>>({})
  const [viewMode, setViewMode]             = useState<ViewMode>(defaultView ?? "list")

  // Docstatus quick filter (null = all)
  const [docstatusFilter, setDocstatusFilter] = useState<0 | 1 | 2 | null>(null)

  // Selection + delete + cancel
  const [selected, setSelected]           = useState<Set<string>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting]           = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [cancelling, setCancelling]       = useState(false)
  const [refreshKey, setRefreshKey]       = useState(0)
  const [showMenu, setShowMenu]           = useState(false)
  const [showStdFilterModal, setShowStdFilterModal] = useState(false)
  const [showBulkEdit, setShowBulkEdit]   = useState(false)
  const [exporting, setExporting]         = useState(false)
  const menuRef        = useRef<HTMLDivElement>(null)
  const filterPanelRef = useRef<HTMLDivElement>(null)

  // Keep onFetchData ref-stable so data effect doesn't re-run on every render
  const fetchRef = useRef(onFetchData)
  useEffect(() => { fetchRef.current = onFetchData })
  const rowsLoadedRef = useRef(onRowsLoaded)
  useEffect(() => { rowsLoadedRef.current = onRowsLoaded })
  const selectionRef = useRef(onSelectionChange)
  useEffect(() => { selectionRef.current = onSelectionChange })
  useEffect(() => { selectionRef.current?.([...selected]) }, [selected])
  useEffect(() => { if (clearSelectionSignal) setSelected(new Set()) }, [clearSelectionSignal])
  const extraFieldsKey = (extraFields ?? []).join(",")

  // Derived columns — uses title_field as the primary display column when set
  const titleFieldName = meta.title_field && meta.title_field !== "name" ? meta.title_field : undefined

  // Image field — prefer meta.image_field, fall back to first Attach Image field
  const imageFieldName = meta.image_field
    ?? meta.fields.find((f) => f.fieldtype === "Attach Image")?.fieldname

  const columns = useMemo<ListMetaField[]>(() => {
    const listFields = meta.fields.filter(
      (f) => f.in_list_view === 1 && !SKIP_FIELDTYPES.has(f.fieldtype)
    )
    const primaryCol: ListMetaField = titleFieldName
      ? (meta.fields.find((f) => f.fieldname === titleFieldName)
          ?? { fieldname: titleFieldName, fieldtype: "Data", label: titleFieldName, in_list_view: 1 as const })
      : { fieldname: "name", fieldtype: "Data", label: "ID", in_list_view: 1 as const }
    const hasModified = listFields.some((f) => f.fieldname === "modified")
    const modField: ListMetaField = { fieldname: "modified", fieldtype: "Datetime", label: "Last Modified", in_list_view: 1 }
    const excluded = new Set(["name", "modified", ...(titleFieldName ? [titleFieldName] : [])])
    return [
      primaryCol,
      ...listFields.filter((f) => !excluded.has(f.fieldname)),
      ...(hasModified ? [] : [modField]),
    ]
  }, [meta, titleFieldName])

  const filterFields = useMemo<ListMetaField[]>(() => {
    return meta.fields.filter(
      (f) => !SKIP_FIELDTYPES.has(f.fieldtype) && f.fieldname !== "name"
    ).slice(0, 50)
  }, [meta])

  const standardFilterFields = useMemo<ListMetaField[]>(() => {
    return meta.fields.filter(
      (f) => f.in_standard_filter === 1 && !SKIP_FIELDTYPES.has(f.fieldtype)
    )
  }, [meta])

  const buildFilters = useCallback((): DocListFilter[] => {
    const result: DocListFilter[] = []
    if (docstatusFilter !== null) {
      result.push([doctype, "docstatus", "=", docstatusFilter])
    }
    for (const [fieldname, value] of Object.entries(stdFilters)) {
      if (!value) continue
      const field = meta.fields.find((f) => f.fieldname === fieldname)
      const ft = field?.fieldtype ?? "Data"
      if (ft === "Select" || ft === "Check") {
        result.push([doctype, fieldname, "=", ft === "Check" ? Number(value) : value])
      } else if (["Date", "Datetime", "Time", "Int", "Float", "Currency", "Percent"].includes(ft)) {
        result.push([doctype, fieldname, "=", value])
      } else {
        result.push([doctype, fieldname, "like", `%${value}%`])
      }
    }
    for (const f of filters) {
      if (!f.value && f.operator !== "is set" && f.operator !== "is not set") continue
      if (f.operator === "is set")          result.push([doctype, f.field, "is", "set"])
      else if (f.operator === "is not set") result.push([doctype, f.field, "is", "not set"])
      else if (f.operator === "in" || f.operator === "not in")
        result.push([doctype, f.field, f.operator, f.value.split(",").map((s) => s.trim())])
      else result.push([doctype, f.field, f.operator, f.value])
    }
    return result
  }, [doctype, filters, docstatusFilter, stdFilters, meta.fields])

  // Fetch data
  useEffect(() => {
    setLoading(true)
    setError(null)
    setSelected(new Set())
    const fieldNames = columns.map((c) => c.fieldname)
    if (!fieldNames.includes("name")) fieldNames.push("name")
    if (!fieldNames.includes("docstatus")) fieldNames.push("docstatus")
    if (imageFieldName && !fieldNames.includes(imageFieldName)) fieldNames.push(imageFieldName)
    for (const f of extraFieldsKey ? extraFieldsKey.split(",") : []) if (!fieldNames.includes(f)) fieldNames.push(f)

    fetchRef.current({
      fields: fieldNames,
      filters: buildFilters(),
      or_filters: [],
      order_by: `${sortField} ${sortDir}`,
      limit: pageSize,
      limit_start: page * pageSize,
    })
      .then(({ rows: r, total: t }) => {
        setRows(r)
        setTotal(t)
        rowsLoadedRef.current?.(r)
      })
      .catch(() => setError(`Could not fetch ${doctype} list.`))
      .finally(() => setLoading(false))
  }, [doctype, columns, imageFieldName, page, pageSize, sortField, sortDir, buildFilters, refreshKey, refreshSignal, extraFieldsKey])

  // Close menus on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
        setConfirmDelete(false)
      }
      if (filterPanelRef.current && !filterPanelRef.current.contains(e.target as Node)) {
        const inPortal = e.composedPath().some(
          (el) => el instanceof HTMLElement && el.dataset.noDismiss === "true"
        )
        if (!inPortal) setShowFilterPanel(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [])

  // Selection helpers
  const allSelected  = rows.length > 0 && rows.every((r) => selected.has(r.name as string))
  const someSelected = rows.some((r) => selected.has(r.name as string))

  // Names of selected rows that are submitted (docstatus === 1) — cancellable
  const selectedSubmittedNames = rows
    .filter((r) => selected.has(r.name as string) && r.docstatus === 1)
    .map((r) => r.name as string)

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) rows.forEach((r) => next.delete(r.name as string))
      else             rows.forEach((r) => next.add(r.name as string))
      return next
    })
  }

  function toggleRow(name: string, e: React.MouseEvent) {
    e.stopPropagation()
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else                next.add(name)
      return next
    })
  }

  async function handleDelete() {
    if (!onDelete) return
    const names = Array.from(selected)
    setDeleting(true)
    try {
      await onDelete(names)
      setSelected(new Set())
      setConfirmDelete(false)
      setRefreshKey((k) => k + 1)
    } catch {
      setError("Delete failed. Some records may be linked to other documents.")
    } finally {
      setDeleting(false)
    }
  }

  async function handleCancel() {
    if (!onCancel) return
    setCancelling(true)
    try {
      await onCancel(selectedSubmittedNames)
      setSelected(new Set())
      setConfirmCancel(false)
      setRefreshKey((k) => k + 1)
    } catch {
      setError("Cancellation failed. Some records may not be cancellable.")
    } finally {
      setCancelling(false)
    }
  }

  // Names of selected rows still in draft — submittable
  const selectedDraftNames = rows
    .filter((r) => selected.has(r.name as string) && (r.docstatus ?? 0) === 0)
    .map((r) => r.name as string)

  const canBulkEdit = !!onBulkUpdate && bulkEditableFields(meta.fields).length > 0

  async function handleBulkUpdate(fieldname: string, value: unknown) {
    if (!onBulkUpdate) return
    await onBulkUpdate(Array.from(selected), fieldname, value)
    setSelected(new Set())
    setRefreshKey((k) => k + 1)
  }

  async function handleBulkSubmit() {
    if (!onBulkSubmit) return
    setShowMenu(false)
    try {
      await onBulkSubmit(selectedDraftNames)
      setSelected(new Set())
      setRefreshKey((k) => k + 1)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Submit failed for some records.")
    }
  }

  /** Export selected rows, or every row matching the current filters (up to EXPORT_LIMIT). */
  async function handleExport() {
    setShowMenu(false)
    setExporting(true)
    try {
      const exportCols = [
        { key: "name", label: "ID" },
        ...meta.fields
          .filter((f) => !SKIP_FIELDTYPES.has(f.fieldtype) && f.fieldtype !== "Attach Image" && f.fieldtype !== "Password")
          .map((f) => ({ key: f.fieldname, label: f.label || f.fieldname })),
      ]
      const names = Array.from(selected)
      const filtersForExport = names.length
        ? [[doctype, "name", "in", names] as DocListFilter]
        : buildFilters()
      const { rows: data } = await fetchRef.current({
        fields: exportCols.map((c) => c.key),
        filters: filtersForExport,
        or_filters: [],
        order_by: `${sortField} ${sortDir}`,
        limit: EXPORT_LIMIT,
        limit_start: 0,
      })
      const stamp = new Date().toISOString().slice(0, 10)
      downloadText(`${doctype}-${stamp}.csv`, toCsv(data, exportCols))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed.")
    } finally {
      setExporting(false)
    }
  }

  function toggleSort(field: string) {
    if (sortField === field) setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    else { setSortField(field); setSortDir("asc") }
    setPage(0)
  }

  function openFilterPanel() {
    setDraftFilters(filters.length > 0 ? [...filters] : [])
    setShowFilterPanel(true)
  }

  function applyDraftFilters() {
    const valid = draftFilters.filter(
      (f) => f.field && (f.value.trim() || f.operator === "is set" || f.operator === "is not set"),
    )
    setFilters(valid)
    setPage(0)
    setShowFilterPanel(false)
  }

  function clearDraftFilters() {
    setDraftFilters([])
    setFilters([])
    setPage(0)
    setShowFilterPanel(false)
  }

  function addDraftFilterRow() {
    setDraftFilters((prev) => [
      ...prev,
      { id: crypto.randomUUID(), field: filterFields[0]?.fieldname ?? "", operator: "=", value: "" },
    ])
  }

  function clearFilters() {
    setFilters([])
    setPage(0)
    setShowFilterPanel(false)
  }

  const totalPages   = Math.ceil(total / pageSize)
  const hasDocstatus = (meta.is_submittable ?? 0) === 1

  /** The app's status indicator when given, otherwise the docstatus dot. */
  function statusMark(row: Record<string, unknown>, dsInfo: { label: string; dot: string }, ds: number | undefined) {
    if (rowIndicator) {
      const ind = rowIndicator(row)
      return ind ? <IndicatorPill indicator={ind} /> : null
    }
    return hasDocstatus && ds !== undefined
      ? <span title={dsInfo.label} className={cn("w-2 h-2 rounded-full shrink-0", dsInfo.dot)} />
      : null
  }
  function cell(col: ListMetaField, row: Record<string, unknown>) {
    const custom = renderCell?.(col.fieldname, row[col.fieldname], row)
    return custom !== undefined ? custom : formatCell(row[col.fieldname], col.fieldtype, currency)
  }

  function changeView(v: ViewMode) {
    setViewMode(v)
    onViewChange?.(v)
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* Toolbar */}
      <div className="flex flex-col gap-2 md:flex-row md:items-end">
        {toolbarStart && <div className="shrink-0">{toolbarStart}</div>}
        {/* Standard filters — show first INLINE_FILTER_LIMIT inline, rest in modal */}
        {standardFilterFields.length > 0 && (
          <div className="flex-1 min-w-0">
            <div className="flex items-end gap-2 flex-wrap">
              {standardFilterFields.slice(0, INLINE_FILTER_LIMIT).map((field) => (
                <StandardFilterInput
                  key={field.fieldname}
                  field={field}
                  value={stdFilters[field.fieldname] ?? ""}
                  {...(onFetchLinkOptions ? { onFetchLinkOptions } : {})}
                  onChange={(v) => {
                    setStdFilters((prev) => ({ ...prev, [field.fieldname]: v }))
                    setPage(0)
                  }}
                />
              ))}

              {standardFilterFields.length > INLINE_FILTER_LIMIT && (() => {
                const hiddenActiveCount = standardFilterFields.slice(INLINE_FILTER_LIMIT)
                  .filter((f) => !!stdFilters[f.fieldname]).length
                return (
                  <button
                    onClick={() => setShowStdFilterModal(true)}
                    className="self-end h-8 px-2.5 rounded-lg text-xs font-medium text-primary hover:bg-primary/5 border border-dashed border-primary/40 transition-colors flex items-center gap-1.5"
                  >
                    {hiddenActiveCount > 0 && (
                      <span className="min-w-[16px] h-4 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[9px] font-bold px-1">
                        {hiddenActiveCount}
                      </span>
                    )}
                    +{standardFilterFields.length - INLINE_FILTER_LIMIT} more
                  </button>
                )
              })()}
            </div>
          </div>
        )}

        {/* Action buttons — fixed group, always right-aligned, never wraps */}
        <div className="flex items-center gap-2 flex-shrink-0 self-end ml-auto">

        {/* Filters split button + panel */}
        <div className="relative" ref={filterPanelRef}>
          <div className={cn(
            "flex items-center rounded-lg border overflow-hidden text-sm font-medium transition-colors",
            filters.length > 0 || showFilterPanel ? "border-primary/40" : "border-border",
          )}>
            <button
              onClick={() => showFilterPanel ? setShowFilterPanel(false) : openFilterPanel()}
              disabled={filterFields.length === 0}
              className={cn(
                "flex items-center gap-1.5 h-9 px-3 disabled:opacity-40 transition-colors",
                filters.length > 0 || showFilterPanel
                  ? "bg-primary/5 text-primary hover:bg-primary/10"
                  : "bg-background text-foreground hover:bg-accent",
              )}
            >
              <svg className="w-4 h-4 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 4h18M7 10h10M11 16h2" />
              </svg>
              Filters
              {filters.length > 0 && (
                <span className="ml-0.5 min-w-[18px] h-[18px] flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[10px] font-bold leading-none px-1">
                  {filters.length}
                </span>
              )}
            </button>

            {filters.length > 0 && (
              <>
                <div className="w-px h-5 bg-primary/20 shrink-0" />
                <button
                  onClick={clearFilters}
                  title="Clear all filters"
                  className="h-9 px-2 flex items-center justify-center text-primary hover:bg-primary/10 transition-colors"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              </>
            )}
          </div>

          {showFilterPanel && (
            <div className="absolute right-0 top-full mt-1.5 z-[300] bg-background border border-border rounded-xl shadow-xl w-[540px] max-w-[calc(100vw-2rem)] overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                <p className="text-sm font-semibold text-foreground">Filter by</p>
                <button
                  onClick={() => setShowFilterPanel(false)}
                  className="h-6 w-6 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" d="M18 6L6 18M6 6l12 12"/>
                  </svg>
                </button>
              </div>

              {/* Filter rows */}
              <div className="p-3 space-y-2 max-h-72 overflow-y-auto">
                {draftFilters.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">
                    No filters added. Click <span className="font-medium">+ Add filter</span> to get started.
                  </p>
                ) : (
                  draftFilters.map((f, i) => (
                    <div key={f.id} className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground font-medium w-9 shrink-0 text-right select-none">
                        {i === 0 ? "Where" : "And"}
                      </span>
                      <FilterRow
                        filter={f}
                        fields={filterFields}
                        onChange={(updated) =>
                          setDraftFilters((prev) => prev.map((x) => (x.id === f.id ? updated : x)))
                        }
                        onRemove={() => setDraftFilters((prev) => prev.filter((x) => x.id !== f.id))}
                        {...(onFetchLinkOptions ? { onFetchLinkOptions } : {})}
                      />
                    </div>
                  ))
                )}
              </div>

              {/* Add filter */}
              <div className="px-4 pb-3">
                <button
                  onClick={addDraftFilterRow}
                  className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" d="M12 4v16m8-8H4"/>
                  </svg>
                  Add filter
                </button>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border bg-muted/20">
                <button
                  onClick={clearDraftFilters}
                  disabled={draftFilters.length === 0 && filters.length === 0}
                  className="h-8 px-3 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40 transition-colors"
                >
                  Clear all
                </button>
                <button
                  onClick={applyDraftFilters}
                  className="h-8 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                >
                  Apply
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Refresh */}
        <button
          onClick={() => setRefreshKey((k) => k + 1)}
          title="Refresh"
          className="h-8 w-8 flex items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>

        {/* View toggle */}
        <div className="flex items-center border border-border rounded-md overflow-hidden shrink-0">
          <button
            onClick={() => changeView("list")}
            title="List view"
            className={cn("h-8 w-8 flex items-center justify-center transition-colors", viewMode === "list" ? "bg-primary/10" : "hover:bg-accent")}
          >
            <svg className={cn("w-4 h-4", viewMode === "list" ? "text-primary" : "text-muted-foreground")} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
          </button>
          <button
            onClick={() => changeView("grid")}
            title="Grid view"
            className={cn("h-8 w-8 flex items-center justify-center border-l border-border transition-colors", viewMode === "grid" ? "bg-primary/10" : "hover:bg-accent")}
          >
            <svg className={cn("w-4 h-4", viewMode === "grid" ? "text-primary" : "text-muted-foreground")} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <rect x="3" y="3" width="7" height="7" rx="1" strokeWidth={2} />
              <rect x="14" y="3" width="7" height="7" rx="1" strokeWidth={2} />
              <rect x="3" y="14" width="7" height="7" rx="1" strokeWidth={2} />
              <rect x="14" y="14" width="7" height="7" rx="1" strokeWidth={2} />
            </svg>
          </button>
          {onTreeClick && (
            <button
              onClick={onTreeClick}
              title="Tree view"
              className="h-8 w-8 flex items-center justify-center border-l border-border transition-colors hover:bg-accent"
            >
              <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <rect x="9" y="2" width="6" height="5" rx="1" strokeWidth={1.8} />
                <rect x="2" y="17" width="6" height="5" rx="1" strokeWidth={1.8} />
                <rect x="16" y="17" width="6" height="5" rx="1" strokeWidth={1.8} />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 7v3.5M12 10.5H5.5M12 10.5H18.5M5.5 10.5V17M18.5 10.5V17" />
              </svg>
            </button>
          )}
        </div>

        {/* 3-dot menu */}
        <div ref={menuRef} className="relative shrink-0">
          <button
            onClick={() => { setShowMenu((v) => !v); setConfirmDelete(false) }}
            className={cn(
              "h-8 w-8 flex items-center justify-center rounded-md border transition-colors",
              showMenu ? "border-primary/40 bg-primary/5 text-primary" : "border-border hover:bg-accent text-muted-foreground",
              selected.size > 0 && "border-primary/40",
            )}
            title="More actions"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>
            </svg>
          </button>

          {showMenu && (
            <div className="absolute right-0 top-full mt-1.5 w-52 rounded-xl border border-border bg-background shadow-xl py-1 z-[200]">
              {selected.size > 0 ? (
                <>
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {selected.size} selected
                  </div>

                  {canBulkEdit && (
                    <button
                      onClick={() => { setShowMenu(false); setShowBulkEdit(true) }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
                    >
                      <svg className="w-4 h-4 shrink-0 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931z"/>
                      </svg>
                      Edit selected
                    </button>
                  )}

                  {hasDocstatus && onBulkSubmit && selectedDraftNames.length > 0 && (
                    <button
                      onClick={() => void handleBulkSubmit()}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                    >
                      <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                      </svg>
                      Submit selected ({selectedDraftNames.length})
                    </button>
                  )}

                  <button
                    onClick={() => void handleExport()}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
                  >
                    <svg className="w-4 h-4 shrink-0 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/>
                    </svg>
                    Export selected
                  </button>

                  {hasDocstatus && onCancel && selectedSubmittedNames.length > 0 && (
                    <button
                      onClick={() => { setShowMenu(false); setConfirmCancel(true) }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                    >
                      <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"/>
                      </svg>
                      Cancel selected ({selectedSubmittedNames.length})
                    </button>
                  )}

                  {onDelete && (
                    <button
                      onClick={() => { setShowMenu(false); setConfirmDelete(true) }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                      </svg>
                      Delete selected
                    </button>
                  )}

                  {(selectionActions ?? []).length > 0 && <div className="mx-2 my-1 h-px bg-border/60" />}
                  {(selectionActions ?? []).map((a) => (
                    <button
                      key={a.label}
                      onClick={() => { setShowMenu(false); a.onClick([...selected]) }}
                      className={cn("w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-accent transition-colors text-left", a.danger ? "text-red-600 dark:text-red-400" : "text-foreground")}
                    >
                      {a.label}
                    </button>
                  ))}

                  <div className="mx-2 my-1 h-px bg-border/60" />
                  <button
                    onClick={() => { setSelected(new Set()); setShowMenu(false) }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                    </svg>
                    Clear selection
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={() => void handleExport()}
                    disabled={exporting || total === 0}
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
                  >
                    <svg className="w-4 h-4 shrink-0 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/>
                    </svg>
                    {exporting ? "Exporting…" : `Export to CSV${total > EXPORT_LIMIT ? ` (first ${EXPORT_LIMIT})` : ""}`}
                  </button>
                  {onImportClick && (
                    <button
                      onClick={() => { setShowMenu(false); onImportClick() }}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-foreground hover:bg-accent transition-colors"
                    >
                      <svg className="w-4 h-4 shrink-0 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"/>
                      </svg>
                      Import from CSV
                    </button>
                  )}
                  {(menuActions ?? []).length > 0 && <div className="mx-2 my-1 h-px bg-border/60" />}
                  {(menuActions ?? []).map((a) => (
                    <button
                      key={a.label}
                      onClick={() => { setShowMenu(false); a.onClick([]) }}
                      className={cn("w-full flex items-center gap-2.5 px-3 py-2 text-sm hover:bg-accent transition-colors text-left", a.danger ? "text-red-600 dark:text-red-400" : "text-foreground")}
                    >
                      {a.label}
                    </button>
                  ))}
                </>
              )}
            </div>
          )}
        </div>

        {toolbarEnd}

        {/* Create */}
        <button
          onClick={onNewClick}
          className="flex items-center gap-1.5 h-9 px-3 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary/90 transition-colors shrink-0"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          <span className="hidden sm:inline">Create {doctype}</span>
          <span className="sm:hidden">New</span>
        </button>

        </div>{/* end action buttons group */}
      </div>

      {/* Docstatus filter pills */}
      {hasDocstatus && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => { setDocstatusFilter(null); setPage(0) }}
            className={cn(
              "h-7 px-2.5 rounded-lg border text-xs font-medium transition-colors",
              docstatusFilter === null
                ? "border-primary/40 bg-primary/5 text-primary"
                : "border-border text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            All
          </button>
          {(Object.entries(DOCSTATUS) as [string, typeof DOCSTATUS[number]][]).map(([key, { label, dot, pill, pillActive }]) => {
            const k = Number(key) as 0 | 1 | 2
            const isActive = docstatusFilter === k
            return (
              <button
                key={key}
                onClick={() => { setDocstatusFilter(isActive ? null : k); setPage(0) }}
                className={cn(
                  "flex items-center gap-1.5 h-7 px-2.5 rounded-lg border text-xs font-medium transition-colors",
                  isActive ? pillActive : pill,
                )}
              >
                <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", dot)} />
                {label}
              </button>
            )
          })}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        viewMode === "list" ? (
          <>
            {/* Desktop table skeleton */}
            <div className="hidden md:block bg-background border border-border rounded-xl overflow-hidden">
              <div className="border-b border-border bg-muted/30 px-4 py-3 flex gap-4">
                {[100, 160, 120, 140].map((w, i) => (
                  <div key={i} className="h-3 bg-muted rounded animate-pulse" style={{ width: w }} />
                ))}
              </div>
              {Array.from({ length: Math.min(pageSize, 10) }).map((_, i) => (
                <div key={i} className="border-b border-border/50 px-4 py-3.5 flex gap-4 items-center">
                  <div className="h-3 bg-muted/60 rounded animate-pulse w-24" />
                  <div className="h-3 bg-muted/40 rounded animate-pulse w-36" />
                  <div className="h-3 bg-muted/40 rounded animate-pulse w-28" />
                </div>
              ))}
            </div>
            {/* Mobile card skeleton */}
            <div className="md:hidden space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-start gap-3 rounded-xl border border-border bg-background p-3.5">
                  <div className="w-3.5 h-3.5 mt-0.5 rounded bg-muted animate-pulse shrink-0" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-muted rounded animate-pulse w-2/3" />
                    <div className="h-2.5 bg-muted/60 rounded animate-pulse w-1/2" />
                    <div className="h-2.5 bg-muted/40 rounded animate-pulse w-1/3" />
                  </div>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />
            ))}
          </div>
        )
      )}

      {/* Error */}
      {!loading && error && (
        <div className="bg-background border border-border rounded-xl p-12 text-center">
          <p className="text-muted-foreground text-sm">{error}</p>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && rows.length === 0 && (
        <div className="bg-background border border-border rounded-xl p-12 text-center space-y-2">
          <p className="text-foreground font-medium">No records found</p>
          <p className="text-sm text-muted-foreground">
            {filters.length > 0 || Object.values(stdFilters).some(Boolean)
              ? "Try adjusting your filters."
              : `No ${doctype} records exist yet.`}
          </p>
        </div>
      )}

      {/* Count + selection bar */}
      {!loading && !error && total > 0 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>{total.toLocaleString()} record{total !== 1 ? "s" : ""}</span>
          {selected.size > 0 && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span className="text-primary font-medium">{selected.size} selected</span>
            </>
          )}
        </div>
      )}

      {/* Table view — desktop */}
      {!loading && !error && rows.length > 0 && viewMode === "list" && (
        <div className="hidden md:block bg-background border border-border rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  <th className="w-10 py-3 pl-4 pr-2">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected }}
                      onChange={toggleAll}
                      className="w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer"
                    />
                  </th>
                  {columns.map((col) => (
                    <th
                      key={col.fieldname}
                      onClick={() => toggleSort(col.fieldname)}
                      className="py-3 px-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer hover:text-foreground select-none transition-colors"
                    >
                      <span className="flex items-center gap-1.5">
                        {col.label}
                        <SortIcon field={col.fieldname} sortField={sortField} sortDir={sortDir} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => {
                  const ds     = row.docstatus as number | undefined
                  const dsInfo = DOCSTATUS[ds as keyof typeof DOCSTATUS] ?? DOCSTATUS[0]!
                  const name   = row.name as string
                  return (
                    <tr
                      key={name}
                      onClick={() => onRowClick(name)}
                      className={cn(
                        "border-b border-border/50 cursor-pointer transition-colors hover:bg-accent",
                        selected.has(name) ? "bg-primary/5" : idx % 2 === 1 ? "bg-muted/10" : "",
                      )}
                    >
                      <td className="pl-4 pr-2 py-3" onClick={(e) => toggleRow(name, e)}>
                        <input
                          type="checkbox"
                          checked={selected.has(name)}
                          onChange={() => {}}
                          className="w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer"
                        />
                      </td>
                      {columns.map((col) => (
                        <td key={col.fieldname} className="py-3 px-4 text-foreground/80 max-w-[240px]">
                          {col.fieldname === titleFieldName
                            ? (
                              <div>
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-primary">{String(row[col.fieldname] ?? name)}</span>
                                  {statusMark(row, dsInfo, ds)}
                                </div>
                                <span className="block text-[10px] text-muted-foreground/60 mt-0.5">{name}</span>
                              </div>
                            )
                            : col.fieldname === "name"
                            ? (
                              <div className="flex items-center gap-2">
                                <span className="font-semibold text-primary">{name}</span>
                                {statusMark(row, dsInfo, ds)}
                              </div>
                            )
                            : cell(col, row)
                          }
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Card list — mobile */}
      {!loading && !error && rows.length > 0 && viewMode === "list" && (
        <div className="md:hidden space-y-2">
          {rows.map((row) => {
            const ds        = row.docstatus as number | undefined
            const dsInfo    = DOCSTATUS[ds as keyof typeof DOCSTATUS] ?? DOCSTATUS[0]!
            const name      = row.name as string
            const primary   = titleFieldName && row[titleFieldName] ? String(row[titleFieldName]) : name
            const secondaries = columns.filter(
              (c) => c.fieldname !== "name" && c.fieldname !== titleFieldName
            ).slice(0, 3)
            return (
              <div
                key={name}
                onClick={() => onRowClick(name)}
                className={cn(
                  "flex items-start gap-3 rounded-xl border bg-background p-3.5 cursor-pointer transition-colors active:bg-accent",
                  selected.has(name) ? "border-primary/50 bg-primary/5" : "border-border",
                )}
              >
                <div className="mt-0.5 shrink-0" onClick={(e) => toggleRow(name, e)}>
                  <input
                    type="checkbox"
                    checked={selected.has(name)}
                    onChange={() => {}}
                    className="w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer"
                  />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-semibold text-primary text-sm truncate flex-1">{primary}</span>
                    {statusMark(row, dsInfo, ds)}
                  </div>
                  {titleFieldName && (
                    <span className="text-[10px] text-muted-foreground/60">{name}</span>
                  )}
                  {secondaries.map((col) => {
                    const val = row[col.fieldname]
                    if (val == null || val === "") return null
                    return (
                      <div key={col.fieldname} className="flex items-baseline gap-1 mt-1 text-xs text-muted-foreground">
                        <span className="font-medium shrink-0">{col.label}:</span>
                        <span className="truncate">{cell(col, row)}</span>
                      </div>
                    )
                  })}
                </div>

                <svg className="w-4 h-4 shrink-0 text-muted-foreground/30 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            )
          })}
        </div>
      )}

      {/* Grid view */}
      {!loading && !error && rows.length > 0 && viewMode === "grid" && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {rows.map((row) => {
            const ds        = row.docstatus as number | undefined
            const dsInfo    = DOCSTATUS[ds as keyof typeof DOCSTATUS] ?? DOCSTATUS[0]!
            const name      = row.name as string
            const cardTitle = titleFieldName && row[titleFieldName] ? String(row[titleFieldName]) : name
            const imageUrl  = imageFieldName && row[imageFieldName] ? String(row[imageFieldName]) : undefined
            const subtitle  = columns.find((c) => c.fieldname !== "name" && c.fieldname !== "modified" && c.fieldname !== titleFieldName)
            const subVal    = subtitle ? row[subtitle.fieldname] : undefined
            return (
              <div
                key={name}
                onClick={() => onRowClick(name)}
                className={cn(
                  "relative flex flex-col bg-background border rounded-xl hover:border-primary/40 hover:shadow-sm transition-all text-left group cursor-pointer overflow-hidden",
                  selected.has(name) ? "border-primary/50 bg-primary/5" : "border-border",
                )}
              >
                {/* Checkbox */}
                <div className="absolute top-2.5 right-2.5 z-10" onClick={(e) => toggleRow(name, e)}>
                  <input
                    type="checkbox"
                    checked={selected.has(name)}
                    onChange={() => {}}
                    className="w-3.5 h-3.5 rounded border-border accent-primary cursor-pointer"
                  />
                </div>

                {/* Image (when available) */}
                {imageUrl ? (
                  <div className="w-full aspect-[4/3] bg-muted overflow-hidden shrink-0">
                    <img
                      src={imageUrl}
                      alt={cardTitle}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  </div>
                ) : (() => {
                  const hue = strToHue(cardTitle)
                  return (
                    <div
                      className="w-full aspect-[4/3] flex items-center justify-center shrink-0 select-none"
                      style={{ background: `linear-gradient(145deg, hsl(${hue},14%,96%) 0%, hsl(${(hue + 30) % 360},18%,91%) 100%)` }}
                    >
                      <div
                        className="flex items-center justify-center w-14 h-14 rounded-2xl text-2xl font-bold leading-none"
                        style={{
                          background: `hsl(${hue},28%,88%)`,
                          color: `hsl(${hue},45%,28%)`,
                          boxShadow: `0 0 0 5px hsl(${hue},20%,93%)`,
                        }}
                      >
                        {cardTitle[0]?.toUpperCase()}
                      </div>
                    </div>
                  )
                })()}

                {/* Content */}
                <div className="flex flex-col gap-0.5 p-3 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <p className="text-sm font-semibold text-foreground group-hover:text-primary transition-colors truncate flex-1">
                      {cardTitle}
                    </p>
                    {statusMark(row, dsInfo, ds)}
                  </div>
                  {titleFieldName && (
                    <p className="text-[10px] text-muted-foreground/60 truncate">{name}</p>
                  )}
                  {subtitle && subVal != null && subVal !== "" && (
                    <p className="text-xs text-muted-foreground truncate">
                      {formatCell(subVal, subtitle.fieldtype, currency)}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Pagination */}
      {!loading && !error && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <span>
              {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total.toLocaleString()}
            </span>
            <div className="relative">
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value) as typeof PAGE_SIZE_OPTIONS[number])
                  setPage(0)
                }}
                className="h-7 pl-2 pr-6 rounded-md border border-border bg-background text-xs text-foreground appearance-none focus:outline-none focus:ring-1 focus:ring-primary/60 focus:border-primary/60 cursor-pointer"
              >
                {PAGE_SIZE_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n} / page</option>
                ))}
              </select>
              <svg className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M19 9l-7 7-7-7"/>
              </svg>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button disabled={page === 0} onClick={() => setPage(0)}
              className="hidden sm:flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="First page">«</button>
            <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}
              className="h-7 w-7 flex items-center justify-center rounded-md border border-border hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors">‹</button>
            {(() => {
              const window = totalPages <= 3 ? totalPages : 3
              const windowStart = Math.max(0, Math.min(page - 1, totalPages - window))
              return Array.from({ length: window }, (_, i) => {
                const p = windowStart + i
                return (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={cn(
                      "h-7 w-7 flex items-center justify-center rounded-md border transition-colors",
                      p === page ? "border-primary bg-primary text-white font-medium" : "border-border hover:bg-accent",
                    )}
                  >{p + 1}</button>
                )
              })
            })()}
            <button disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}
              className="h-7 w-7 flex items-center justify-center rounded-md border border-border hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors">›</button>
            <button disabled={page >= totalPages - 1} onClick={() => setPage(totalPages - 1)}
              className="hidden sm:flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              title="Last page">»</button>
          </div>
        </div>
      )}

      {/* Standard filters modal */}
      {showStdFilterModal && createPortal(
        <div className="fixed inset-0 z-[500] flex items-end sm:items-center justify-center">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            onClick={() => setShowStdFilterModal(false)}
          />
          {/* Panel */}
          <div className="relative z-10 bg-background border border-border rounded-t-2xl sm:rounded-2xl shadow-2xl w-full sm:max-w-2xl flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <p className="text-sm font-semibold text-foreground">Quick filters</p>
              <button
                onClick={() => setShowStdFilterModal(false)}
                className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>

            {/* Filter grid */}
            <div className="p-5 overflow-y-auto flex-1">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {standardFilterFields.map((field) => (
                  <StandardFilterInput
                    key={field.fieldname}
                    field={field}
                    value={stdFilters[field.fieldname] ?? ""}
                    {...(onFetchLinkOptions ? { onFetchLinkOptions } : {})}
                    onChange={(v) => {
                      setStdFilters((prev) => ({ ...prev, [field.fieldname]: v }))
                      setPage(0)
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border bg-muted/20">
              <button
                onClick={() => {
                  setStdFilters({})
                  setPage(0)
                }}
                disabled={Object.values(stdFilters).every((v) => !v)}
                className="h-8 px-3 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40 transition-colors"
              >
                Clear all
              </button>
              <button
                onClick={() => setShowStdFilterModal(false)}
                className="h-8 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      <DeleteConfirmDialog
        open={confirmDelete}
        doctype={doctype}
        target={`${selected.size} record${selected.size !== 1 ? "s" : ""}`}
        deleting={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />

      <BulkEditDialog
        open={showBulkEdit}
        count={selected.size}
        fields={meta.fields}
        onApply={handleBulkUpdate}
        onClose={() => setShowBulkEdit(false)}
      />

      <DeleteConfirmDialog
        open={confirmCancel}
        doctype={doctype}
        target={`${selectedSubmittedNames.length} record${selectedSubmittedNames.length !== 1 ? "s" : ""}`}
        deleting={cancelling}
        onConfirm={handleCancel}
        onCancel={() => setConfirmCancel(false)}
        title={`Cancel ${doctype}?`}
        description={`${selectedSubmittedNames.length} submitted record${selectedSubmittedNames.length !== 1 ? "s" : ""} will be cancelled. This can be reversed by amending.`}
        confirmLabel="Cancel documents"
        iconVariant="warning"
      />
    </div>
  )
}
