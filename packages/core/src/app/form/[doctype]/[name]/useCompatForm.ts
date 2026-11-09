"use client"
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Binds GenericForm to the Frappe-compatible runtime: opens the document in
 * its doctype's Form (running the doctype's real client scripts), re-renders on
 * every model change, and routes edits back through frappe.model.set_value.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { FrappeCompatConfig } from "@petal/sdk"
// Types only: the runtime (jQuery, moment, the Frappe namespace) is loaded on
// first use, so forms of apps without frappe_compat never download it.
import type { Form } from "@/lib/frappe-compat"
import type { DocTypeMeta, LinkSearchContext, MetaField } from "./components/types"

import { loadRuntime, loadedRuntime } from "./compat-runtime"

/** Field types Petal has no input for: drawn with Desk's own control. */
export const DESK_DRAWN = new Set(["Dynamic Link", "Geolocation", "Signature", "Barcode", "Duration", "Phone", "JSON", "Markdown Editor", "HTML Editor", "Autocomplete", "Table MultiSelect", "Icon"])

/** Field types committed on every change; the rest wait for a pause in typing (Desk fires on blur). */
const IMMEDIATE = new Set(["Link", "Dynamic Link", "Select", "Check", "Date", "Datetime", "Time", "Attach", "Attach Image", "Rating", "Color", "Autocomplete", "Table MultiSelect"])
const TYPING_DELAY_MS = 400

export type CompatFormState = ReturnType<typeof useCompatForm>

export function useCompatForm(doctype: string | null, name: string, config: FrappeCompatConfig | null, prefill?: Record<string, unknown> | null) {
  const [loadedFrm, setFrm] = useState<Form | null>(null)
  /** The route the loaded Form was opened for. */
  const [opened, setOpened] = useState<{ doctype: string; name: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(!!config)
  const [version, setVersion] = useState(0)
  const pending = useRef<Record<string, unknown>>({})
  /** Resolves the runtime's wait for the form to be drawn (first refresh). */
  const layoutWaiter = useRef<(() => void) | null>(null)
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})

  useEffect(() => {
    if (!config || !doctype) return
    let cancelled = false
    setLoading(true)
    setError(null)
    pending.current = {}
    // Already showing this document (the URL just moved to its saved name): keep it.
    if (loadedFrm && loadedFrm.doctype === doctype && loadedFrm.docname === name && !loadedFrm.is_new()) {
      setOpened({ doctype, name })
      setLoading(false)
      return
    }
    void (async () => {
      try {
        const { startCompat, openDoc } = await loadRuntime()
        await startCompat(config)
        if (name === "new" && prefill && Object.keys(prefill).length) {
          const w = window as any
          w.frappe.route_options = { ...(w.frappe.route_options ?? {}), ...prefill }
        }
        const { frm: f } = await openDoc(doctype, name, {
          // Draw the form after onload, then let refresh run against it.
          waitForLayout: (loaded) => new Promise<void>((resolve) => {
            if (cancelled) { resolve(); return }
            layoutWaiter.current = resolve
            setFrm(loaded)
            setOpened({ doctype, name })
            setLoading(false)
          }),
        })
        if (cancelled) return
        setFrm(f)
        setOpened({ doctype, name })
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load this document.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
      layoutWaiter.current?.()
      layoutWaiter.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctype, name, !!config])

  // Forms are reused per doctype, so after a route change the loaded Form can
  // still hold the previous document until openDoc finishes. Expose it only
  // when it belongs to the current route (or was saved/renamed from it).
  const frm = loadedFrm && opened && opened.doctype === doctype && loadedFrm.doctype === doctype
    && (opened.name === name || loadedFrm.docname === name) ? loadedFrm : null

  // Effects run after React commits the DOM: the form is on screen now.
  useEffect(() => {
    if (!frm || !layoutWaiter.current) return
    const resolve = layoutWaiter.current
    layoutWaiter.current = null
    resolve()
  })

  useEffect(() => {
    if (!config) return
    let unsubscribe = () => {}
    let gone = false
    void loadRuntime().then((rt) => { if (!gone) unsubscribe = rt.subscribeForms(() => setVersion((v) => v + 1)) })
    return () => { gone = true; unsubscribe() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!config])
  useEffect(() => () => { for (const t of Object.values(timers.current)) clearTimeout(t) }, [])

  const derived = useMemo(() => {
    // A loaded Form means the runtime is loaded.
    const runtime = loadedRuntime()
    if (!frm?.doc || !runtime) return null
    const { effectiveFields, effectiveChildFields, snapshotDoc } = runtime
    const w = window as any
    const metaDoc = w.locals.DocType[frm.doctype]
    const fields = effectiveFields(frm) as MetaField[]
    const meta = { ...metaDoc, fields } as DocTypeMeta
    const childMetas = effectiveChildFields(frm) as Record<string, MetaField[]>
    const values = { ...snapshotDoc(frm.doc), ...pending.current }
    let indicator: { label: string; color: string } | null = frm.indicator
    if (!indicator) {
      try {
        const ind = w.frappe.get_indicator(frm.doc, frm.doctype)
        if (ind) indicator = { label: ind[0], color: ind[1] }
      } catch { /* listview scripts may assume list data */ }
    }
    return {
      meta, childMetas, values, indicator,
      buttons: [...frm.buttons],
      primaryGroup: frm.primaryGroup,
      menuItems: [...frm.menuItems],
      primaryAction: frm.primaryAction,
      secondaryAction: frm.secondaryAction,
      saveDisabled: frm.saveDisabled,
      readOnly: frm.read_only,
      intro: frm.intro,
      headline: frm.headline,
      dashboardIndicators: [...frm.dashboardIndicators],
      dashboardProgress: [...frm.dashboardProgress],
      dashboardComments: [...frm.dashboardComments],
      dashboardSections: [...frm.dashboardSections],
      saving: frm.saving,
      isNew: frm.is_new(),
      // Typed-but-uncommitted edits count too, so a realtime reload doesn't drop them.
      isDirty: frm.is_dirty() || Object.keys(pending.current).length > 0,
      docname: frm.docname,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frm, version])

  const commit = useCallback(async (fieldname: string) => {
    if (!frm) return
    clearTimeout(timers.current[fieldname])
    delete timers.current[fieldname]
    if (!(fieldname in pending.current)) return
    const value = pending.current[fieldname]
    delete pending.current[fieldname]
    await loadedRuntime()?.setFieldFromUI(frm, fieldname, value)
  }, [frm])

  /** Commit everything typed so far and wait for the handlers it triggers. */
  const flush = useCallback(async () => {
    for (const f of Object.keys(pending.current)) await commit(f)
    await loadedRuntime()?.waitForPending()
  }, [commit])

  const change = useCallback((fieldname: string, value: unknown, fieldtype?: string) => {
    if (!frm) return
    pending.current[fieldname] = value
    setVersion((v) => v + 1)
    clearTimeout(timers.current[fieldname])
    if (fieldtype && IMMEDIATE.has(fieldtype)) void commit(fieldname)
    else timers.current[fieldname] = setTimeout(() => void commit(fieldname), fieldtype === "Table" ? 150 : TYPING_DELAY_MS)
  }, [frm, commit])

  const linkSearch = useCallback(async (_doctype: string, query: string, ctx?: LinkSearchContext) => {
    if (!frm || !ctx) return []
    if (ctx.table) await commit(ctx.table)
    return loadedRuntime()?.searchLink(frm, ctx.fieldname, query, ctx.table, ctx.rowName) ?? []
  }, [frm, commit])

  const htmlHost = useCallback((fieldname: string) => frm?.fields_dict[fieldname]?.wrapper ?? null, [frm])
  const deskTypes = useMemo(() => new Set([...DESK_DRAWN, ...(config?.desk_controls ?? [])]), [config])
  const usesDeskControl = useCallback((fieldtype: string) => deskTypes.has(fieldtype), [deskTypes])
  const deskControl = useCallback((fieldname: string) => {
    const field = frm?.fields_dict[fieldname] as any
    if (!field?.mountDeskControl) return null
    if (!loadedRuntime()?.deskControlsReady()) {
      void loadedRuntime()?.loadDeskControls().then(() => setVersion((v) => v + 1)).catch((e) => console.error("[Petal compat] Desk controls", e))
      return null
    }
    return field.mountDeskControl()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frm, version])
  const onButton = useCallback((fieldname: string) => { if (frm) void flush().then(() => loadedRuntime()?.triggerButton(frm, fieldname)) }, [frm, flush])
  /** Give the runtime Petal's rendered form (frm.wrapper etc.); null on unmount. */
  const attachRoot = useCallback((el: HTMLElement | null) => { if (frm) loadedRuntime()?.attachFormRoot(frm, el) }, [frm])
  const tableButtons = useCallback((fieldname: string) =>
    (frm?.fields_dict[fieldname]?.grid?.custom_buttons ?? []).map((b: any) => ({ label: b.label, onClick: () => void flush().then(() => b.fn?.()) })),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [frm, flush, version])
  const tableCannotAdd = useCallback((fieldname: string) => {
    const grid = frm?.fields_dict[fieldname]?.grid
    return !!(grid?.cannot_add_rows || grid?.df?.cannot_add_rows)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frm, version])

  const run = useCallback(async (fn: () => unknown) => {
    await flush()
    try { await fn() } catch (e) { console.error(e) }
  }, [flush])

  return {
    enabled: !!config,
    frm, error, loading, derived, attachRoot,
    change, flush, linkSearch, run,
    extras: { htmlHost, onButton, tableButtons, tableCannotAdd, usesDeskControl, deskControl },
    save: () => run(() => frm?.save()),
    submit: () => run(() => frm?.savesubmit()),
    cancel: () => run(() => frm?.savecancel()),
    amend: () => run(() => frm?.amend_doc()),
    duplicate: () => run(() => frm?.copy_doc()),
    reload: async () => { pending.current = {}; if (frm && !frm.is_new()) await loadedRuntime()?.reloadDoc(frm) },
  }
}
