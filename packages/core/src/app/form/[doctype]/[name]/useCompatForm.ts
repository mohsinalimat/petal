"use client"
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Binds GenericForm to the Frappe-compatible runtime: opens the document in
 * its doctype's Form (running the doctype's real client scripts), re-renders on
 * every model change, and routes edits back through frappe.model.set_value.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { FrappeCompatConfig } from "@petal/sdk"
import {
  effectiveChildFields, effectiveFields, openDoc, reloadDoc, searchLink, setFieldFromUI, snapshotDoc,
  subscribeForms, triggerButton, type Form,
} from "@/lib/frappe-compat"
import { startCompat } from "@/lib/frappe-compat/browser"
import { waitForPending } from "@/lib/frappe-compat/request"
import type { DocTypeMeta, LinkSearchContext, MetaField } from "./components/types"

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
        await startCompat(config)
        if (name === "new" && prefill && Object.keys(prefill).length) {
          const w = window as any
          w.frappe.route_options = { ...(w.frappe.route_options ?? {}), ...prefill }
        }
        const { frm: f } = await openDoc(doctype, name)
        if (cancelled) return
        setFrm(f)
        setOpened({ doctype, name })
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Could not load this document.")
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctype, name, !!config])

  // Forms are reused per doctype, so after a route change the loaded Form can
  // still hold the previous document until openDoc finishes. Expose it only
  // when it belongs to the current route (or was saved/renamed from it).
  const frm = loadedFrm && opened && opened.doctype === doctype && loadedFrm.doctype === doctype
    && (opened.name === name || loadedFrm.docname === name) ? loadedFrm : null

  useEffect(() => subscribeForms(() => setVersion((v) => v + 1)), [])
  useEffect(() => () => { for (const t of Object.values(timers.current)) clearTimeout(t) }, [])

  const derived = useMemo(() => {
    if (!frm?.doc) return null
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
    await setFieldFromUI(frm, fieldname, value)
  }, [frm])

  /** Commit everything typed so far and wait for the handlers it triggers. */
  const flush = useCallback(async () => {
    for (const f of Object.keys(pending.current)) await commit(f)
    await waitForPending()
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
    return searchLink(frm, ctx.fieldname, query, ctx.table, ctx.rowName)
  }, [frm, commit])

  const htmlHost = useCallback((fieldname: string) => frm?.fields_dict[fieldname]?.wrapper ?? null, [frm])
  const onButton = useCallback((fieldname: string) => { if (frm) void flush().then(() => triggerButton(frm, fieldname)) }, [frm, flush])
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
    frm, error, loading, derived,
    change, flush, linkSearch, run,
    extras: { htmlHost, onButton, tableButtons, tableCannotAdd },
    save: () => run(() => frm?.save()),
    submit: () => run(() => frm?.savesubmit()),
    cancel: () => run(() => frm?.savecancel()),
    amend: () => run(() => frm?.amend_doc()),
    duplicate: () => run(() => frm?.copy_doc()),
    reload: async () => { pending.current = {}; if (frm && !frm.is_new()) await reloadDoc(frm) },
  }
}
