"use client"
/**
 * Shown for screens configured to open in Frappe Desk (frappe_compat.desk):
 * their scripts depend on Desk's own page, so Petal sends the user there,
 * or embeds it when `embed` is on and the browser is signed in to Desk.
 */
import { deskBaseUrl, deskFormUrl, deskPageUrl } from "@/lib/frappe-compat/desk"

export function DeskFallback({ doctype, name, page, embed }: { doctype?: string; name?: string; page?: string; embed?: boolean }) {
  const base = deskBaseUrl()
  const title = page ?? (name === "new" ? `New ${doctype}` : `${doctype} ${name}`)
  if (!base) {
    return (
      <div role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-5 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
        <p className="font-semibold">{title} opens in Frappe Desk</p>
        <p className="mt-1">This screen is set to open in Desk, but Desk&apos;s address isn&apos;t configured. Set <code>NEXT_PUBLIC_PETAL_DESK_URL</code> to your Frappe site&apos;s URL.</p>
      </div>
    )
  }
  const url = page ? deskPageUrl(base, page) : deskFormUrl(base, doctype ?? "", name ?? "new")
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground truncate">{title}</p>
          <p className="text-xs text-muted-foreground">This screen uses Frappe Desk.</p>
        </div>
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          Open in Desk
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M14 5h5v5M19 5l-8 8M19 14v5H5V5h5" /></svg>
        </a>
      </div>
      {embed && (
        <iframe
          title={title}
          src={url}
          className="h-[calc(100vh-12rem)] min-h-[480px] w-full rounded-xl border border-border bg-background"
        />
      )}
    </div>
  )
}
