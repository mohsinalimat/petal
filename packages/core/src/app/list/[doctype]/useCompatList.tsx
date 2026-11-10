"use client"
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Binds Petal's list page to the doctype's `frappe.listview_settings`: status
 * indicators (get_indicator), extra fetched fields (add_fields), cell
 * formatters, default filters, and whatever the settings' onload/refresh
 * hooks add through the `listview` object (action items, menu items, toolbar
 * buttons, checked items).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { FrappeCompatConfig } from "@petal/sdk"
import type { DocListAction, DocListFilter, DocListProps } from "@petal/ui"
// Types only: the runtime itself is loaded on demand, so lists of apps that
// don't use it never download jQuery/moment.
import type { CompatListView, ListSettings } from "@/lib/frappe-compat"
import { FrappeHtml } from "@/components/compat/FrappeHtml"

export type CompatListProps = Pick<DocListProps,
  "extraFields" | "rowIndicator" | "renderCell" | "initialFilters" | "selectionActions" | "menuActions" | "onSelectionChange" | "onRowsLoaded" | "clearSelectionSignal">

export type CompatListState = {
  /** Still loading the doctype's list settings; render the list once false. */
  loading: boolean
  props: CompatListProps
  /** Script-added toolbar buttons (listview.page.add_inner_button). */
  buttons: Array<{ label: string; group?: string | undefined; onClick: () => void }>
  /** Filters scripts added through listview.filter_area, merged into every fetch. */
  scriptFilters: DocListFilter[]
  listview: CompatListView | null
}

export function useCompatList(doctype: string, config: FrappeCompatConfig | null, refetch: () => void): CompatListState {
  const [listview, setListview] = useState<CompatListView | null>(null)
  const [settings, setSettings] = useState<ListSettings | null>(null)
  const [loading, setLoading] = useState(!!config)
  const [, setVersion] = useState(0)
  const [clearSignal, setClearSignal] = useState(0)
  const runtime = useRef<typeof import("@/lib/frappe-compat") | null>(null)
  const refetchRef = useRef(refetch)
  useEffect(() => { refetchRef.current = refetch })

  useEffect(() => {
    if (!config) { setListview(null); setSettings(null); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    void (async () => {
      try {
        const [compat, { startCompat }] = await Promise.all([import("@/lib/frappe-compat"), import("@/lib/frappe-compat/browser")])
        await startCompat(config)
        await compat.loadDoctype(doctype)
        if (cancelled) return
        const lv = new compat.CompatListView(doctype)
        runtime.current = compat
        lv.onRefresh = () => refetchRef.current()
        lv.onClearChecked = () => setClearSignal((n) => n + 1)
        setSettings(compat.listSettingsFor(doctype))
        setListview(lv)
        compat.runListOnload(lv)
      } catch (e) {
        console.error(`[Petal compat] list settings for ${doctype}`, e)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [doctype, config])

  useEffect(() => listview?.subscribe(() => setVersion((v) => v + 1)), [listview])

  const onRowsLoaded = useCallback((rows: Record<string, unknown>[]) => {
    if (listview && runtime.current) runtime.current.runListRefresh(listview, rows)
  }, [listview])
  const onSelectionChange = useCallback((names: string[]) => { if (listview) listview.checked = names }, [listview])

  const renderCell = useMemo(() => {
    const fmts = settings?.formatters ?? {}
    if (!Object.keys(fmts).length) return undefined
    return (fieldname: string, value: unknown, row: Record<string, unknown>) => {
      const fmt = fmts[fieldname]
      if (!fmt) return undefined
      try {
        const df = (window as any).frappe.meta.get_docfield(doctype, fieldname) ?? { fieldname }
        const html = fmt(value, df, { doctype, ...row })
        return html == null ? undefined : <FrappeHtml html={String(html)} className="inline" />
      } catch (e) {
        console.warn(`[Petal compat] ${doctype} formatter ${fieldname}`, e)
        return undefined
      }
    }
  }, [settings, doctype])

  const toAction = (a: { label: string; fn: () => unknown }): DocListAction => ({ label: a.label, onClick: () => { try { void a.fn() } catch (e) { console.error(e) } } })

  if (!config) return { loading: false, props: {}, buttons: [], scriptFilters: [], listview: null }

  const props: CompatListProps = {
    onRowsLoaded,
    onSelectionChange,
    clearSelectionSignal: clearSignal,
  }
  if (settings) {
    props.extraFields = settings.extraFields
    if (settings.hasIndicator) props.rowIndicator = (row) => settings.indicator(row)
    if (renderCell) props.renderCell = renderCell
    if (settings.filters.length) props.initialFilters = settings.filters
  }
  if (listview) {
    // Desk lists custom action items under "Actions" next to the standard ones.
    props.selectionActions = listview.actionItems.filter((a) => !a.standard).map(toAction)
    props.menuActions = listview.menuItems.filter((a) => !a.standard).map(toAction)
  }
  return {
    loading,
    props,
    buttons: (listview?.innerButtons ?? []).map((b) => ({ label: b.label, group: b.group, onClick: () => { try { void b.fn() } catch (e) { console.error(e) } } })),
    scriptFilters: (listview?.filters ?? []) as DocListFilter[],
    listview,
  }
}
