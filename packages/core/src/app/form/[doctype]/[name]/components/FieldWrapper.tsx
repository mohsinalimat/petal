"use client"
import { ChildTable, FieldValue } from "@petal/ui"
import type { ChildTableMeta } from "@petal/ui"
import type { FieldBehavior } from "@petal/sdk"
import { FieldInput } from "./FieldInput"
import type { MetaField } from "./types"

export function FieldWrapper({ field, value, isEditing, onChange, behavior, childMetas, onLinkSearch, hasError, currency = "USD" }: {
  field: MetaField
  value: unknown
  isEditing: boolean
  onChange: (v: unknown) => void
  behavior?: FieldBehavior
  childMetas?: Record<string, MetaField[]>
  onLinkSearch?: (doctype: string, query: string) => Promise<{ value: string; description?: string }[]>
  hasError?: boolean
  currency?: string
}) {
  if (field.fieldtype === "Table") {
    const tableRows = Array.isArray(value) ? (value as Record<string, unknown>[]) : []
    const tableMeta = field.options !== undefined
      ? (childMetas?.[field.options] as ChildTableMeta[] | undefined)
      : undefined
    return (
      <div id={`field-${field.fieldname}`} className="col-span-full mt-1">
        <ChildTable
          label={field.label}
          {...(tableMeta !== undefined ? { meta: tableMeta } : {})}
          value={tableRows}
          {...(isEditing && field.read_only !== 1 ? { onChange: (rows) => onChange(rows) } : {})}
          disabled={!isEditing || field.read_only === 1}
          {...(onLinkSearch !== undefined ? { onLinkSearch } : {})}
          currency={currency}
        />
      </div>
    )
  }

  const isFullWidth = ["Small Text", "Text", "Long Text", "Text Editor", "Code"].includes(field.fieldtype)
  return (
    <div id={`field-${field.fieldname}`} className={`group min-w-0 ${isFullWidth ? "col-span-full" : ""}`}>
      <div className="flex items-center gap-1 mb-1.5">
        {field.reqd === 1 && (
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-px ${hasError ? "bg-red-500" : "bg-red-400"}`} />
        )}
        <label
          style={behavior?.label_style as React.CSSProperties}
          className={`text-[11px] font-semibold uppercase tracking-wide leading-none ${hasError ? "text-red-500" : "text-muted-foreground"}`}
        >
          {field.label}
        </label>
      </div>

      {isEditing ? (
        <div className="space-y-1">
          <div className={hasError ? "rounded-lg ring-2 ring-red-400/70" : ""}>
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
            <p className="text-[11px] text-muted-foreground/60 leading-snug">{field.description}</p>
          )}
        </div>
      ) : (
        <div className="min-h-[32px] flex items-start py-0.5">
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
