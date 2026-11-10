"use client"
/** Header of a Desk page or report: what the script set on its AppPage (title, indicator, buttons, menu). */
import { useEffect, useState } from "react"
import { cn } from "@petal/ui"
import type { AppPage } from "@/lib/frappe-compat"
import { CompatButtonBar, Dropdown } from "./FormChrome"
import { FrappeHtml, indicatorClass } from "./FrappeHtml"

const run = (fn: () => unknown) => () => { try { void fn() } catch (e) { console.error(e) } }

export function PageHeader({ page, fallbackTitle }: { page: AppPage | null; fallbackTitle: string }) {
  const [, setVersion] = useState(0)
  useEffect(() => {
    if (!page) return
    const unsubscribe = page.subscribe(() => setVersion((v) => v + 1))
    // Catch up on anything the script set before this subscription existed
    // (pages often add buttons in a setTimeout after on_page_load).
    setVersion((v) => v + 1)
    return unsubscribe
  }, [page])
  const title = page?.title || fallbackTitle
  return (
    <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <h1 className="truncate text-xl font-semibold text-foreground">{title}</h1>
        {page?.indicator && (
          <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", indicatorClass(page.indicator.color, "pill"))}>{page.indicator.label}</span>
        )}
        {page?.title_sub && <FrappeHtml html={page.title_sub} className="text-sm text-muted-foreground" />}
      </div>
      {page && (
        <div className="flex flex-wrap items-center gap-2">
          <CompatButtonBar buttons={page.innerButtons.map((b) => ({ label: b.label, group: b.group, onClick: run(b.fn) }))} />
          {page.actionItems.length > 0 && <Dropdown label="Actions" items={page.actionItems.map((a) => ({ label: a.label, onClick: run(a.fn) }))} />}
          {page.menuItems.length > 0 && <Dropdown label="Menu" items={page.menuItems.map((a) => ({ label: a.label, onClick: run(a.fn) }))} />}
          {page.secondary && (
            <button type="button" onClick={run(page.secondary.fn)} className="h-8 rounded-lg border border-border bg-background px-3 text-sm font-medium text-foreground hover:bg-accent">{page.secondary.label}</button>
          )}
          {page.primary && (
            <button type="button" onClick={run(page.primary.fn)} className="h-8 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">{page.primary.label}</button>
          )}
        </div>
      )}
    </div>
  )
}

