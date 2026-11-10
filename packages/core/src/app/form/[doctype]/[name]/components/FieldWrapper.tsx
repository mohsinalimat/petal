"use client"
import { useEffect, useRef } from "react"
import { ChildTable, FieldValue } from "@petal/ui"
import type { ChildTableMeta } from "@petal/ui"
import type { FieldBehavior } from "@petal/sdk"
import { FieldInput } from "./FieldInput"
import type { FormFieldExtras, LinkSearch, MetaField } from "./types"

/** Mounts a DOM element owned by a script (Frappe HTML fields) inside React's tree. */
export function HtmlHost({ el }: { el: HTMLElement }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = ref.current
    if (!host) return
    host.appendChild(el)
    return () => { if (el.parentNode === host) host.removeChild(el) }
  }, [el])
  return <div ref={ref} className="petal-frappe-html" />
}

/** Desk's control attributes, so scripts' [data-fieldname=x] / .frappe-control selectors match. */
function deskAttrs(field: MetaField, extra = "") {
  return {
    id: `field-${field.fieldname}`,
    "data-fieldname": field.fieldname,
    "data-fieldtype": field.fieldtype,
    className: `frappe-control ${extra}`.trim(),
  }
}

export function FieldWrapper({ field, value, isEditing, onChange, behavior, childMetas, onLinkSearch, hasError, currency = "USD", extras }: {
  field: MetaField
  value: unknown
  isEditing: boolean
  onChange: (v: unknown) => void
  behavior?: FieldBehavior
  childMetas?: Record<string, MetaField[]>
  onLinkSearch?: LinkSearch
  hasError?: boolean
  currency?: string
  extras?: FormFieldExtras
}) {
  if (field.fieldtype === "HTML" && extras?.htmlHost) {
    const el = extras.htmlHost(field.fieldname)
    // The adopted element is the field's own wrapper and carries Desk's attributes.
    return el ? <div id={`field-${field.fieldname}`} className="col-span-full min-w-0"><HtmlHost el={el} /></div> : null
  }
  if (extras?.deskControl && extras.usesDeskControl?.(field.fieldtype)) {
    // Desk's real control (it draws its own label, input and description).
    const el = extras.deskControl(field.fieldname)
    const wide = ["Geolocation", "Signature", "JSON", "Markdown Editor", "HTML Editor", "Table MultiSelect"].includes(field.fieldtype)
    return (
      <div id={`field-${field.fieldname}`} className={`petal-desk min-w-0 ${wide ? "col-span-full" : ""}`}>
        {el ? <HtmlHost el={el} /> : <div className="h-14 animate-pulse rounded-lg bg-muted/60" aria-label={`Loading ${field.label}`} />}
      </div>
    )
  }
  if (field.fieldtype === "Button" && extras?.onButton) {
    const onButton = extras.onButton
    return (
      <div {...deskAttrs(field, "min-w-0")}>
        <button
          type="button"
          disabled={field.read_only === 1}
          onClick={() => onButton(field.fieldname)}
          className="h-8 px-3 rounded-lg border border-border bg-background text-sm text-foreground hover:bg-accent disabled:opacity-50 transition-colors"
        >
          {field.label}
        </button>
        {field.description && <p className="mt-1 text-[11px] text-muted-foreground/60 leading-snug">{field.description}</p>}
      </div>
    )
  }
  if (field.fieldtype === "Table") {
    const tableRows = Array.isArray(value) ? (value as Record<string, unknown>[]) : []
    const tableMeta = field.options !== undefined
      ? (childMetas?.[field.options] as ChildTableMeta[] | undefined)
      : undefined
    return (
      <div {...deskAttrs(field, "col-span-full mt-1")}>
        <ChildTable
          label={field.label}
          {...(tableMeta !== undefined ? { meta: tableMeta } : {})}
          value={tableRows}
          {...(isEditing && field.read_only !== 1 ? { onChange: (rows) => onChange(rows) } : {})}
          disabled={!isEditing || field.read_only === 1}
          {...(onLinkSearch !== undefined
            ? { onLinkSearch: (dt: string, q: string, ctx?: { fieldname: string; rowName?: string }) => onLinkSearch(dt, q, ctx ? { ...ctx, table: field.fieldname } : undefined) }
            : {})}
          currency={currency}
          {...(extras?.tableCannotAdd?.(field.fieldname) ? { cannotAddRows: true } : {})}
          {...(extras?.tableButtons ? { buttons: extras.tableButtons(field.fieldname) } : {})}
        />
      </div>
    )
  }

  const isFullWidth = ["Small Text", "Text", "Long Text", "Text Editor", "Code"].includes(field.fieldtype)
  return (
    <div {...deskAttrs(field, `group min-w-0 ${isFullWidth ? "col-span-full" : ""}`)}>
      <div className="clearfix flex items-center gap-1 mb-1.5">
        {field.reqd === 1 && (
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-px ${hasError ? "bg-red-500" : "bg-red-400"}`} />
        )}
        <label
          style={behavior?.label_style as React.CSSProperties}
          className={`control-label text-[11px] font-semibold uppercase tracking-wide leading-none ${hasError ? "text-red-500" : "text-muted-foreground"}`}
        >
          {field.label}
        </label>
      </div>

      {isEditing ? (
        <div className="control-input-wrapper space-y-1">
          <div className={`control-input ${hasError ? "rounded-lg ring-2 ring-red-400/70" : ""}`}>
            <FieldInput
              field={field}
              value={value}
              onChange={onChange}
              disabled={field.read_only === 1}
              {...(behavior?.input_style && { inputStyle: behavior.input_style })}
              {...(onLinkSearch !== undefined && { onLinkSearch })}
            />
          </div>
          {hasError && (
            <p className="text-[11px] text-red-500 font-medium">This field is required</p>
          )}
          {!hasError && field.description && (
            <p className="help-box text-[11px] text-muted-foreground/60 leading-snug">{field.description}</p>
          )}
        </div>
      ) : (
        <div className="control-value min-h-[32px] flex items-start py-0.5">
          <FieldValue
            value={value}
            fieldtype={field.fieldtype}
            currency={currency}
            {...(field.fieldtype !== "Image" && { className: "text-foreground leading-snug" })}
          />
        </div>
      )}
    </div>
  )
}
