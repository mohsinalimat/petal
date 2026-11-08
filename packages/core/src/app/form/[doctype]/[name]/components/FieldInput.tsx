"use client"
import { useRouter } from "next/navigation"
import { FieldInput as FieldInputUI } from "@petal/ui"
import type { LinkFieldOption } from "@petal/ui"
import type { MetaField } from "./types"

export function FieldInput({ field, value, onChange, disabled = false, inputStyle, onLinkSearch }: {
  field: MetaField
  value: unknown
  onChange: (v: unknown) => void
  disabled?: boolean
  inputStyle?: Record<string, string>
  onLinkSearch?: (doctype: string, query: string) => Promise<LinkFieldOption[]>
}) {
  const router = useRouter()

  function createNew() {
    const returnTo = encodeURIComponent(window.location.pathname)
    router.push(`/form/${encodeURIComponent(field.options ?? "")}/new?returnTo=${returnTo}&returnField=${field.fieldname}`)
  }

  return (
    <FieldInputUI
      fieldtype={field.fieldtype}
      value={value}
      onChange={onChange}
      disabled={disabled}
      options={field.options ?? ""}
      {...(field.options !== undefined && { linkedDoctype: field.options })}
      {...(field.fieldtype === "Link" && { placeholder: `Search ${field.options ?? field.label}…` })}
      {...(field.fieldtype === "Link" && onLinkSearch !== undefined && {
        onLinkSearch: (q: string) => onLinkSearch(field.options ?? "", q),
      })}
      {...(field.fieldtype === "Link" && field.options !== undefined && { onLinkCreateNew: createNew })}
      id={`field-input-${field.fieldname}`}
      {...(inputStyle !== undefined && { style: inputStyle as React.CSSProperties })}
    />
  )
}
