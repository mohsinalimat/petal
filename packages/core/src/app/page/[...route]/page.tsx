"use client"
/**
 * Frappe Desk pages (frappe.pages[name], /app/<name> in Desk) run on the
 * Frappe-compatible runtime: the page's own script draws into its wrapper,
 * which is shown here as-is; its header (title, indicator, buttons, menu) is
 * drawn by Petal from what the script set on the page.
 */
import { useEffect, useState } from "react"
import { useParams } from "next/navigation"
import { usePetalStore } from "@/store/petal-store"
// The compat runtime is loaded on demand (as on form/list pages) so it stays
// out of this route's first-load bundle.
import type { DeskPage } from "@/lib/frappe-compat"
import { HtmlHost } from "@/app/form/[doctype]/[name]/components/FieldWrapper"
import { DeskFallback } from "@/components/compat/DeskFallback"
import { PageHeader } from "@/components/compat/PageHeader"
import { PageLoader } from "@/components/shell/PageLoader"

export default function DeskPageRoute() {
  const params = useParams()
  const route = (Array.isArray(params.route) ? params.route : [params.route]).map((r) => decodeURIComponent(String(r)))
  const name = route[0] ?? ""
  const hooks = usePetalStore((s) => s.hooks)
  const hooksReady = usePetalStore((s) => s.hooksReady)
  const config = hooks.frappe_compat?.enabled ? hooks.frappe_compat : null
  const inDesk = !!config?.desk?.pages?.includes(name)
  const [desk, setDesk] = useState<DeskPage | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!config || inDesk || !name) return
    let cancelled = false
    setDesk(null)
    setError(null)
    void (async () => {
      try {
        const [{ openDeskPage }, { startCompat }] = await Promise.all([
          import("@/lib/frappe-compat"), import("@/lib/frappe-compat/browser"),
        ])
        await startCompat(config)
        const p = await openDeskPage(name)
        if (!cancelled) setDesk(p)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()
    return () => { cancelled = true }
  }, [config, inDesk, name])

  // on_page_show / refresh run once the page is on screen, as in Desk.
  useEffect(() => { if (desk) desk.show() }, [desk])

  if (!hooksReady) return <PageLoader label="Loading…" />
  if (inDesk) return <DeskFallback page={name} {...(config?.desk?.embed ? { embed: true } : {})} />
  if (!config) {
    return <p className="text-sm text-muted-foreground">Desk pages need the Frappe-compatible runtime. Turn on <code>frappe_compat</code> in your app&apos;s hooks.</p>
  }
  if (error) return <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>
  if (!desk) return <PageLoader label="Loading page…" />
  return (
    <div className="space-y-4 min-w-0">
      <PageHeader page={desk.page()} fallbackTitle={String((desk.wrapper as unknown as { label?: string }).label ?? name)} />
      <HtmlHost el={desk.wrapper} />
    </div>
  )
}
