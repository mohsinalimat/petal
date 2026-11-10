"use client"
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Header actions and banners for forms driven by Frappe scripts: custom
 * buttons (frm.add_custom_button, grouped into dropdowns), Desk's primary
 * action rules, frm.page menu items, intro/headline and dashboard indicators.
 */
import { useEffect, useRef, useState } from "react"
import { cn } from "@petal/ui"
import type { CompatFormState } from "@/app/form/[doctype]/[name]/useCompatForm"
import { FrappeHtml, indicatorClass } from "./FrappeHtml"

type Derived = NonNullable<CompatFormState["derived"]>

const base = "h-8 px-3 rounded-lg text-sm font-medium transition-colors disabled:opacity-60 inline-flex items-center gap-1.5"
const neutral = cn(base, "border border-border bg-background text-foreground hover:bg-accent")
const primary = cn(base, "bg-primary text-primary-foreground hover:bg-primary/90")
const danger = cn(base, "border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20")

export function Dropdown({ label, items, isPrimary, align = "right" }: { label: string; items: Array<{ label: string; onClick: () => void }>; isPrimary?: boolean; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false) }
    document.addEventListener("mousedown", close)
    document.addEventListener("keydown", esc)
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc) }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} className={isPrimary ? primary : neutral} onClick={() => setOpen((v) => !v)}>
        {label}
        <svg className="h-3 w-3 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M19 9l-7 7-7-7" /></svg>
      </button>
      {open && (
        <div role="menu" className={cn("absolute z-40 mt-1 min-w-[180px] max-h-[60vh] overflow-y-auto rounded-lg border border-border bg-background py-1 shadow-lg", align === "right" ? "right-0" : "left-0")}>
          {items.map((it) => (
            <button key={it.label} role="menuitem" type="button" className="block w-full px-3 py-1.5 text-left text-sm text-foreground hover:bg-accent" onClick={() => { setOpen(false); it.onClick() }}>
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Header actions in Desk order: custom buttons, then the primary action. */
export function CompatActions({ compat, derived, isSubmittable, hasWorkflow, onPrint, more }: {
  compat: CompatFormState
  derived: Derived
  isSubmittable: boolean
  hasWorkflow: boolean
  onPrint: () => void
  more: React.ReactNode
}) {
  const docstatus = Number(derived.values.docstatus ?? 0)
  const run = (fn: any) => () => void compat.run(() => fn?.())
  const groups = new Map<string, Array<{ label: string; onClick: () => void }>>()
  const loose: typeof derived.buttons = []
  for (const b of derived.buttons) {
    if (b.group) groups.set(b.group, [...(groups.get(b.group) ?? []), { label: b.label, onClick: run(b.fn) }])
    else loose.push(b)
  }
  const busy = derived.saving

  let primaryBtn: React.ReactNode = null
  if (derived.primaryAction) {
    primaryBtn = <button type="button" className={primary} disabled={busy} onClick={run(derived.primaryAction.fn)}>{derived.primaryAction.label}</button>
  } else if (!derived.saveDisabled && !derived.readOnly) {
    if (docstatus === 0 && (derived.isDirty || derived.isNew)) {
      primaryBtn = (
        <button type="button" className={primary} disabled={busy} onClick={() => void compat.save()} title="Save (Ctrl+S / ⌘S)">
          {busy && <span className="h-3.5 w-3.5 rounded-full border-2 border-white/30 border-t-white animate-spin" />}
          Save
        </button>
      )
    } else if (docstatus === 0 && isSubmittable && !hasWorkflow) {
      primaryBtn = <button type="button" className={primary} disabled={busy} onClick={() => void compat.submit()}>Submit</button>
    } else if (docstatus === 1 && isSubmittable && !hasWorkflow) {
      primaryBtn = <button type="button" className={danger} disabled={busy} onClick={() => void compat.cancel()}>Cancel</button>
    } else if (docstatus === 2 && isSubmittable) {
      primaryBtn = <button type="button" className={primary} disabled={busy} onClick={() => void compat.amend()}>Amend</button>
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
      {loose.map((b) => (
        <button key={b.label} type="button" className={b.type === "primary" ? primary : b.type === "danger" ? danger : neutral} onClick={run(b.fn)}>{b.label}</button>
      ))}
      {[...groups.entries()].map(([g, items]) => <Dropdown key={g} label={g} items={items} isPrimary={derived.primaryGroup === g} />)}
      {derived.secondaryAction && <button type="button" className={neutral} onClick={run(derived.secondaryAction.fn)}>{derived.secondaryAction.label}</button>}
      {derived.isDirty && !derived.isNew && docstatus === 0 && (
        <button type="button" className={neutral} onClick={() => void compat.reload()} title="Discard changes">Discard</button>
      )}
      {!derived.isNew && <button type="button" className={neutral} onClick={onPrint}>Print</button>}
      {derived.menuItems.length > 0 && <Dropdown label="Menu" items={derived.menuItems.map((m) => ({ label: m.label, onClick: run(m.fn) }))} />}
      {more}
      {primaryBtn}
    </div>
  )
}

export function CompatIndicator({ indicator }: { indicator: { label: string; color: string } | null }) {
  if (!indicator) return null
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium", indicatorClass(indicator.color, "pill"))}>
      <span className={cn("h-1.5 w-1.5 rounded-full", indicatorClass(indicator.color, "dot"))} />
      {indicator.label}
    </span>
  )
}

/** frm.set_intro, dashboard headline/indicators/progress/comments/sections. */
export function CompatBanners({ derived }: { derived: Derived }) {
  const hasStats = derived.dashboardIndicators.length > 0 || derived.dashboardProgress.length > 0
  return (
    <div className="space-y-3 mb-5 empty:hidden">
      {derived.intro && (
        <div role="note" className={cn("rounded-lg border px-4 py-2.5 text-sm", indicatorClass(derived.intro.color, "banner"))}>
          <FrappeHtml html={derived.intro.html} />
        </div>
      )}
      {derived.headline && (
        <div role="note" className={cn("rounded-lg border px-4 py-2.5 text-sm", indicatorClass(derived.headline.color, "banner"))}>
          <FrappeHtml html={derived.headline.html} />
        </div>
      )}
      {derived.dashboardComments.map((c, i) => (
        <div key={i} className={cn("rounded-lg border px-4 py-2.5 text-sm", indicatorClass(c.color, "banner"))}>
          <FrappeHtml html={c.html} />
        </div>
      ))}
      {hasStats && (
        <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg border border-border px-4 py-3">
          {derived.dashboardIndicators.map((d, i) => (
            <span key={i} className="inline-flex items-center gap-1.5 text-sm text-foreground">
              <span className={cn("h-2 w-2 rounded-full", indicatorClass(d.color, "dot"))} />
              <FrappeHtml html={d.label} className="inline" />
            </span>
          ))}
          {derived.dashboardProgress.map((p, i) => {
            const pct = Math.max(0, Math.min(100, Number(p.percent) || 0))
            return (
              <div key={`p${i}`} className="w-full sm:w-64" title={p.message}>
                <div className="flex justify-between text-xs text-muted-foreground"><span>{p.title}</span><span>{Math.round(pct)}%</span></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
              </div>
            )
          })}
        </div>
      )}
      {derived.dashboardSections.map((el, i) => <SectionHost key={i} el={el} />)}
    </div>
  )
}

function SectionHost({ el }: { el: HTMLElement }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = ref.current
    if (!host) return
    host.appendChild(el)
    return () => { if (el.parentNode === host) host.removeChild(el) }
  }, [el])
  return <div ref={ref} className="petal-frappe-html rounded-lg border border-border px-4 py-3 text-sm" />
}

/**
 * Loose and grouped buttons a script added (Desk's inner toolbar): loose ones
 * as buttons, each group as one dropdown.
 */
export function CompatButtonBar({ buttons }: { buttons: Array<{ label: string; group?: string | undefined; onClick: () => void }> }) {
  if (!buttons.length) return null
  const loose = buttons.filter((b) => !b.group)
  const groups = new Map<string, Array<{ label: string; onClick: () => void }>>()
  for (const b of buttons) if (b.group) groups.set(b.group, [...(groups.get(b.group) ?? []), { label: b.label, onClick: b.onClick }])
  return (
    <div className="flex flex-wrap items-center gap-2">
      {loose.map((b) => <button key={b.label} type="button" className={neutral} onClick={b.onClick}>{b.label}</button>)}
      {[...groups].map(([g, items]) => <Dropdown key={g} label={g} items={items} />)}
    </div>
  )
}
