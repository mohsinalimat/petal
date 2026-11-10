"use client"
import { useState, useEffect } from "react"
import { FieldWrapper } from "./FieldWrapper"
import type { FormFieldExtras, LayoutSection, LinkSearch, MetaField } from "./types"
import type { FieldBehavior } from "@petal/sdk"

function evalDepends(expr: string | undefined, doc: Record<string, unknown>): boolean {
  if (!expr) return true
  try {
    const code = expr.startsWith("eval:") ? expr.slice(5) : `!!doc["${expr}"]`
    // eslint-disable-next-line no-new-func
    return Boolean(new Function("doc", `return (${code})`)(doc))
  } catch {
    return true
  }
}

export function SectionBlock({ section, values, isEditing, onChange, fieldBehaviors, childMetas, onLinkSearch, missingFields, currency = "USD", skipFields, extras }: {
  section: LayoutSection
  values: Record<string, unknown>
  isEditing: boolean
  onChange: (fn: string, v: unknown) => void
  fieldBehaviors: Record<string, FieldBehavior>
  childMetas?: Record<string, MetaField[]>
  onLinkSearch?: LinkSearch
  missingFields?: Set<string>
  currency?: string
  skipFields?: Set<string>
  extras?: FormFieldExtras
}) {
  const [open, setOpen] = useState(true)

  useEffect(() => {
    if (!open && missingFields && missingFields.size > 0) {
      const hasMissing = section.columns.some((col) =>
        col.fields.some((f) => missingFields.has(f.fieldname))
      )
      if (hasMissing) setOpen(true)
    }
  }, [missingFields])
  const hasLabel  = Boolean(section.label)
  const colCount  = section.columns.length

  function isVisible(f: MetaField): boolean {
    if (fieldBehaviors[f.fieldname]?.hidden) return false
    if (f.hidden_depends_on && evalDepends(f.hidden_depends_on, values)) return false
    if (f.depends_on && !evalDepends(f.depends_on, values)) return false
    return true
  }

  function applyBehavior(field: MetaField): MetaField {
    const b = fieldBehaviors[field.fieldname]
    let readOnly: 0 | 1 = b?.read_only ? 1 : (field.read_only ?? 0)
    if (field.read_only_depends_on && evalDepends(field.read_only_depends_on, values)) readOnly = 1
    return { ...field, read_only: readOnly }
  }

  const regularCols = section.columns.map((col) => ({
    label: col.label,
    fields: col.fields
      .filter((f) => f.fieldtype !== "Table" && isVisible(f) && !skipFields?.has(f.fieldname))
      .map(applyBehavior),
  }))
  const tableCols = section.columns.flatMap((col) =>
    col.fields
      .filter((f) => f.fieldtype === "Table" && isVisible(f) && !skipFields?.has(f.fieldname))
      .map(applyBehavior)
  )

  const isEmpty = regularCols.every((c) => c.fields.length === 0) && tableCols.length === 0
  if (isEmpty) return null

  const GRID_COLS: Record<number, string> = {
    1: "grid-cols-1",
    2: "grid-cols-1 md:grid-cols-2",
    3: "grid-cols-1 md:grid-cols-3",
    4: "grid-cols-1 md:grid-cols-4",
  }
  const gridClass = GRID_COLS[colCount] ?? "grid-cols-1 md:grid-cols-4"

  // Desk's class names and data-fieldname, so Frappe scripts' selectors
  // ([data-fieldname=x], .section-head, .form-column) find this section.
  return (
    <div className="form-section border border-border bg-background" {...(section.fieldname ? { "data-fieldname": section.fieldname } : {})}>
      {hasLabel ? (
        <button
          type="button"
          onClick={() => section.collapsible && setOpen((v) => !v)}
          className={`w-full flex items-center justify-between px-5 py-3 bg-muted/30 border-b border-border transition-colors ${
            section.collapsible ? "cursor-pointer hover:bg-muted/50" : "cursor-default"
          }`}
        >
          <span className="section-head text-xs font-semibold text-foreground/80 uppercase tracking-widest">{section.label}</span>
          {section.collapsible && (
            <svg className={`w-3.5 h-3.5 text-muted-foreground/50 transition-transform shrink-0 ${open ? "" : "-rotate-90"}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M19 9l-7 7-7-7"/>
            </svg>
          )}
        </button>
      ) : <span className="section-head hidden" />}

      {(!section.collapsible || open) && (
        <div className="section-body p-4 sm:p-5">
          <div className={`grid ${gridClass} ${colCount > 1 ? "md:divide-x md:divide-border/50" : "gap-5"}`}>
            {regularCols.map((col, ci) => (
              <div key={ci} {...(section.columns[ci]?.fieldname ? { "data-fieldname": section.columns[ci]!.fieldname } : {})} className={`form-column ${colCount > 1 ? `space-y-5 ${ci > 0 ? "md:pl-6 pt-5 md:pt-0" : "md:pr-6"}` : "space-y-5"}`}>
                {col.label && (
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest border-b border-border/40 pb-1.5">
                    {col.label}
                  </p>
                )}
                {col.fields.map((field) => (
                  <FieldWrapper
                    key={field.fieldname}
                    field={field}
                    value={values[field.fieldname]}
                    isEditing={isEditing}
                    onChange={(v) => onChange(field.fieldname, v)}
                    {...(fieldBehaviors[field.fieldname] && { behavior: fieldBehaviors[field.fieldname] as FieldBehavior })}
                    {...(childMetas !== undefined ? { childMetas } : {})}
                    {...(onLinkSearch !== undefined ? { onLinkSearch } : {})}
                    hasError={missingFields?.has(field.fieldname) ?? false}
                    currency={currency}
                    {...(extras ? { extras } : {})}
                  />
                ))}
              </div>
            ))}
          </div>

          {tableCols.length > 0 && (
            <div className={`space-y-4 ${regularCols.some((c) => c.fields.length > 0) ? "mt-6 pt-5 border-t border-border/60" : ""}`}>
              {tableCols.map((field) => (
                <FieldWrapper
                  key={field.fieldname}
                  field={field}
                  value={values[field.fieldname]}
                  isEditing={isEditing}
                  onChange={(v) => onChange(field.fieldname, v)}
                  {...(childMetas !== undefined ? { childMetas } : {})}
                  {...(onLinkSearch !== undefined ? { onLinkSearch } : {})}
                  currency={currency}
                  {...(extras ? { extras } : {})}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
