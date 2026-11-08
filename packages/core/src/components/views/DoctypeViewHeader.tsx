"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ViewSwitcher } from "@petal/ui"
import type { DocViewKey } from "@petal/ui"
import { availableViews, viewPath } from "@/lib/views/available-views"
import type { DocTypeMeta } from "@/app/form/[doctype]/[name]/components/types"

/** Breadcrumb + title + view switcher shared by the list, kanban, calendar, gantt and import pages. */
export function DoctypeViewHeader({
  doctype, meta, active, actions, crumb,
}: {
  doctype: string
  meta: DocTypeMeta | null
  active: DocViewKey
  actions?: React.ReactNode
  /** Extra breadcrumb segment after the doctype, e.g. "Import". */
  crumb?: string
}) {
  const router = useRouter()
  const views = meta ? availableViews(meta) : []
  return (
    <div className="space-y-3">
      <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm min-w-0">
        <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors">Home</Link>
        <span className="text-muted-foreground/40">/</span>
        {crumb ? (
          <>
            <Link href={viewPath("list", doctype)} className="text-muted-foreground hover:text-foreground transition-colors truncate">{doctype}</Link>
            <span className="text-muted-foreground/40">/</span>
            <span className="font-semibold text-foreground">{crumb}</span>
          </>
        ) : (
          <span className="font-semibold text-foreground truncate">{doctype}</span>
        )}
      </nav>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold text-foreground truncate">{doctype}</h1>
        <div className="flex items-center gap-2 flex-wrap">
          {!crumb && <ViewSwitcher active={active} views={views} onChange={(v) => router.push(viewPath(v, doctype))} />}
          {actions}
        </div>
      </div>
    </div>
  )
}
