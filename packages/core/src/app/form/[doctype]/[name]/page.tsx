"use client"
import { Suspense, lazy, useMemo, useState } from "react"
import { useParams } from "next/navigation"
import { usePetalStore } from "@/store/petal-store"
import Link from "next/link"
import type { FormSlotComponents } from "@petal/sdk"
import { GenericForm } from "./GenericForm"
import { PageLoader } from "@/components/shell/PageLoader"
import { DeskFallback } from "@/components/compat/DeskFallback"

const SlotFallback = () => (
  <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
    <div className="w-3 h-3 border-2 border-primary border-t-transparent rounded-full animate-spin" />
  </div>
)

function FormSlot({
  loader,
  docname,
}: {
  loader: NonNullable<FormSlotComponents["before"]>
  docname: string
}) {
  const Comp = useMemo(() => lazy(loader), [loader])
  return (
    <Suspense fallback={<SlotFallback />}>
      <Comp docname={docname} />
    </Suspense>
  )
}

export default function FormPage() {
  const params  = useParams()
  const doctype = decodeURIComponent(params.doctype as string)
  const name    = decodeURIComponent(params.name as string)
  const { hooks } = usePetalStore()
  const [isSingle, setIsSingle] = useState(false)

  const override = hooks.form_overrides?.[doctype]
  const slots    = hooks.form_slots?.[doctype]
  const OverrideComponent = useMemo(() => (override ? lazy(override) : null), [override])
  const desk = hooks.frappe_compat?.enabled ? hooks.frappe_compat.desk : undefined
  const inDesk = !!desk?.doctypes?.includes(doctype)

  return (
    <div className="max-w-6xl space-y-4 min-w-0">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm">
        <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">Home</Link>
        <span className="text-muted-foreground/30">/</span>
        {isSingle ? (
          <span className="text-foreground font-medium truncate">{doctype}</span>
        ) : (
          <>
            <Link href={`/list/${encodeURIComponent(doctype)}`} className="text-muted-foreground hover:text-foreground transition-colors">{doctype}</Link>
            <span className="text-muted-foreground/30">/</span>
            <span className="text-foreground font-medium truncate">{name === "new" ? `New ${doctype}` : name}</span>
          </>
        )}
      </div>

      {inDesk ? (
        <DeskFallback doctype={doctype} name={name} {...(desk?.embed ? { embed: true } : {})} />
      ) : OverrideComponent ? (
        <Suspense fallback={<PageLoader label="Loading custom form…" />}>
          <OverrideComponent docname={name} />
        </Suspense>
      ) : (
        <>
          {slots?.before && <FormSlot loader={slots.before} docname={name} />}
          <GenericForm
            doctype={doctype}
            name={name}
            onIsSingle={setIsSingle}
            toolbarSlot={slots?.toolbar
              ? <FormSlot loader={slots.toolbar} docname={name} />
              : undefined}
          />
          {slots?.after && <FormSlot loader={slots.after} docname={name} />}
        </>
      )}
    </div>
  )
}
