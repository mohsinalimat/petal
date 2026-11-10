"use client"
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Renders what Frappe scripts open: msgprint, confirm/prompt, frappe.ui.Dialog,
 * the "Get Items From" picker, freeze overlay and progress. Mounted once in the
 * shell when an app enables the Frappe-compatible runtime.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import { ChildTable, FieldInput, cn } from "@petal/ui"
import type { ChildTableMeta } from "@petal/ui"
import { uiStore, deskUrlToPath, type CompatDialog, type DialogField, type MsgEntry, type PickerEntry } from "@/lib/frappe-compat"
import { setCompatNavigator } from "@/lib/frappe-compat/browser"
import { FrappeHtml, indicatorClass } from "./FrappeHtml"

const w = () => (typeof window !== "undefined" ? (window as any) : ({} as any))

export function CompatHost() {
  const router = useRouter()
  const state = useSyncExternalStore(uiStore.subscribe, uiStore.getState, uiStore.getState)

  useEffect(() => {
    setCompatNavigator((path, opts) => (opts?.replace ? router.replace(path) : router.push(path)))
  }, [router])

  // Desk links inside script-rendered HTML (/app/sales-invoice/…) → Petal routes.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return
      const a = (e.target as HTMLElement | null)?.closest?.("a[href]") as HTMLAnchorElement | null
      if (!a || !a.closest(".petal-frappe-html")) return
      const href = a.getAttribute("href") ?? ""
      const path = href.startsWith("/app") || href.startsWith("#") ? deskUrlToPath(href) : href.startsWith("/") ? href : null
      if (!path || a.target === "_blank") return
      e.preventDefault()
      router.push(path)
    }
    document.addEventListener("click", onClick)
    return () => document.removeEventListener("click", onClick)
  }, [router])

  return (
    <>
      {state.entries.map((e) =>
        e.kind === "msg" ? <MsgDialog key={e.id} entry={e} />
          : e.kind === "dialog" ? <DialogView key={e.id} dialog={e.dialog} version={state.version} />
          : <PickerView key={e.id} entry={e} />,
      )}
      {state.freeze.count > 0 && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-background/50 backdrop-blur-[1px]" role="status" aria-live="polite">
          <div className="flex items-center gap-2 rounded-lg border border-border bg-background px-4 py-2.5 text-sm shadow-lg">
            <span className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
            {state.freeze.message || "Working…"}
          </div>
        </div>
      )}
      {state.progress && (
        <div className="fixed bottom-4 left-1/2 z-[71] w-[min(420px,calc(100vw-32px))] -translate-x-1/2 rounded-lg border border-border bg-background p-3 shadow-lg" role="status">
          <p className="text-sm font-medium text-foreground">{state.progress.title}</p>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-full origin-left bg-primary transition-transform" style={{ transform: `scaleX(${Math.min(1, state.progress.count / Math.max(1, state.progress.total))})` }} />
          </div>
          {state.progress.description && <p className="mt-1.5 text-xs text-muted-foreground">{state.progress.description}</p>}
        </div>
      )}
    </>
  )
}

function Modal({ title, indicator, onClose, children, footer, wide }: {
  title: string
  indicator?: string | undefined
  onClose?: (() => void) | undefined
  children: React.ReactNode
  footer?: React.ReactNode
  wide?: boolean | undefined
}) {
  useEffect(() => {
    if (!onClose) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-[8vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cn("w-full rounded-xl border border-border bg-background shadow-xl", wide ? "max-w-4xl" : "max-w-lg")}>
        <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {indicator && <span className={cn("h-2 w-2 rounded-full", indicatorClass(indicator, "dot"))} />}
            {title}
          </h2>
          {onClose && (
            <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          )}
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>
  )
}

const btn = "h-8 rounded-lg px-3 text-sm font-medium transition-colors disabled:opacity-50"
const btnPrimary = cn(btn, "bg-primary text-primary-foreground hover:bg-primary/90")
const btnSecondary = cn(btn, "border border-border bg-background text-foreground hover:bg-accent")

function MsgDialog({ entry }: { entry: MsgEntry }) {
  const close = () => uiStore.remove(entry.id)
  return (
    <Modal
      title={entry.title}
      indicator={entry.indicator}
      onClose={close}
      wide={entry.wide}
      footer={entry.primary ? (
        <button type="button" className={btnPrimary} onClick={() => { entry.primary!.action?.(); close() }}>{entry.primary.label}</button>
      ) : undefined}
    >
      <div className="space-y-3">
        {entry.messages.map((m, i) => <FrappeHtml key={i} html={m} className="text-sm text-foreground" />)}
      </div>
    </Modal>
  )
}

// ── frappe.ui.Dialog ─────────────────────────────────────────────────────────

const BREAKS = new Set(["Section Break", "Column Break", "Tab Break"])

function DialogView({ dialog, version }: { dialog: CompatDialog; version: number }) {
  void version
  const sections: Array<{ label?: string; columns: DialogField[][] }> = [{ columns: [[]] }]
  for (const f of dialog.fields_list) {
    const df = f.df
    if (df.fieldtype === "Section Break") { sections.push({ label: df.label, columns: [[]] }); continue }
    if (df.fieldtype === "Column Break") { sections[sections.length - 1]!.columns.push([]); continue }
    if (df.fieldtype === "Tab Break") continue
    const s = sections[sections.length - 1]!
    s.columns[s.columns.length - 1]!.push(f)
  }
  const close = dialog.no_cancel_flag ? undefined : () => dialog.hide()
  const isWide = dialog.size === "large" || dialog.size === "extra-large" || dialog.fields_list.some((f) => f.df.fieldtype === "Table")
  return (
    <Modal
      title={dialog.title || "Dialog"}
      indicator={dialog.indicator}
      onClose={close}
      wide={isWide}
      footer={(
        <>
          {dialog.custom_actions.map((a) => (
            <button key={a.label} type="button" className={btnSecondary} onClick={() => a.action?.()}>{a.label}</button>
          ))}
          {dialog.secondary_action_label && (
            <button type="button" className={btnSecondary} onClick={() => dialog.run_secondary()}>{dialog.secondary_action_label}</button>
          )}
          {(dialog.primary_action || dialog.primary_action_label) && (
            <button type="button" className={btnPrimary} disabled={dialog.primary_disabled} onClick={() => dialog.run_primary()}>
              {dialog.primary_action_label || "Submit"}
            </button>
          )}
        </>
      )}
    >
      <form onSubmit={(e) => { e.preventDefault(); if (!dialog.confirm_dialog) dialog.run_primary() }} className="space-y-5">
        {dialog.message && <FrappeHtml html={dialog.message} className="text-sm text-foreground" />}
        {sections.map((s, si) => {
          const visibleCols = s.columns.filter((c) => c.some((f) => isVisible(dialog, f)))
          if (!visibleCols.length) return null
          return (
            <fieldset key={si} className="space-y-3">
              {s.label && <legend className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{s.label}</legend>}
              <div className={cn("grid gap-4", visibleCols.length > 1 && "sm:grid-cols-2", visibleCols.length > 2 && "lg:grid-cols-3")}>
                {visibleCols.map((col, ci) => (
                  <div key={ci} className="space-y-3 min-w-0">
                    {col.filter((f) => isVisible(dialog, f)).map((f, fi) => <DialogFieldView key={f.df.fieldname ?? fi} dialog={dialog} field={f} />)}
                  </div>
                ))}
              </div>
            </fieldset>
          )
        })}
        <HostEl el={dialog.body} />
      </form>
    </Modal>
  )
}

function isVisible(dialog: CompatDialog, f: DialogField): boolean {
  if (BREAKS.has(f.df.fieldtype)) return false
  if (Number(f.df.hidden)) return false
  return dialog.evalDepends(f.df.depends_on)
}

function HostEl({ el }: { el: HTMLElement }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const host = ref.current
    if (!host || !el) return
    host.appendChild(el)
    return () => { if (el.parentNode === host) host.removeChild(el) }
  }, [el])
  return <div ref={ref} className="petal-frappe-html text-sm" />
}

function dialogLinkSearch(dialog: CompatDialog, field: DialogField, txt: string) {
  const frappe = w().frappe
  const df = field.df
  const args: any = { txt, doctype: df.fieldtype === "Dynamic Link" ? dialog.get_value(df.options) : df.options, page_length: 10, ignore_user_permissions: df.ignore_user_permissions }
  const getQuery = field.get_query || df.get_query
  if (getQuery) {
    const q = typeof getQuery === "function" ? getQuery(dialog.get_values_raw(), dialog.doctype, dialog.docname) : getQuery
    if (typeof q === "string") args.query = q
    else if (q && typeof q === "object") {
      if (q.filters || q.query) { Object.assign(args, q); if (q.filters) args.filters = q.filters }
      else args.filters = q
    }
  }
  if (df.filters) args.filters = { ...(args.filters ?? {}), ...df.filters }
  return frappe.call({ method: "frappe.desk.search.search_link", args }).then((r: any) => (Array.isArray(r?.message) ? r.message : []), () => [])
}

function DialogFieldView({ dialog, field }: { dialog: CompatDialog; field: DialogField }) {
  const df = field.df
  const id = `compat-dlg-${dialog.entryId}-${df.fieldname}`
  if (df.fieldtype === "HTML") return <HostEl el={field.wrapper} />
  if (df.fieldtype === "Heading") return <h3 className="text-sm font-semibold text-foreground">{df.label}</h3>
  if (df.fieldtype === "Button") {
    return (
      <button type="button" className={btnSecondary} onClick={() => { const fn = df.click || df.onclick; if (fn) fn.call(field); else void field.fire_change() }}>
        {df.label}
      </button>
    )
  }
  if (df.fieldtype === "Table") {
    const meta: ChildTableMeta[] = (df.fields ?? []).map((c: any) => ({ ...c, in_list_view: c.in_list_view ? 1 : 0, reqd: c.reqd ? 1 : 0, read_only: c.read_only ? 1 : 0 }))
    if (meta.length && !meta.some((m) => m.in_list_view)) meta.forEach((m, i) => { if (i < 5) m.in_list_view = 1 })
    const readOnly = !!Number(df.read_only)
    return (
      <div className="min-w-0">
        <ChildTable
          label={df.label ?? ""}
          meta={meta}
          value={df.data ?? []}
          disabled={readOnly}
          {...(readOnly ? {} : { onChange: (rows: Record<string, unknown>[]) => { df.data = rows.map((r, i) => ({ idx: i + 1, name: (r.name as string) ?? `row ${i + 1}`, ...r })); dialog.refresh() } })}
          {...(df.cannot_add_rows ? { cannotAddRows: true } : {})}
          onLinkSearch={(dt, q) => w().frappe.call({ method: "frappe.desk.search.search_link", args: { txt: q, doctype: dt, page_length: 10 } }).then((r: any) => r?.message ?? [], () => [])}
        />
        {df.description && <FrappeHtml html={df.description} className="mt-1 text-[11px] text-muted-foreground" />}
      </div>
    )
  }
  const readOnly = !!Number(df.read_only) || df.fieldtype === "Read Only"
  return (
    <div className="space-y-1 min-w-0">
      {df.fieldtype !== "Check" && (
        <label htmlFor={id} className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          {df.label}{Number(df.reqd) ? <span className="ml-0.5 text-red-500" aria-hidden>*</span> : null}
        </label>
      )}
      {df.fieldtype === "Check" ? (
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input id={id} type="checkbox" disabled={readOnly} checked={!!Number(field.value)} onChange={(e) => field.user_set(e.target.checked ? 1 : 0)} className="h-4 w-4" />
          {df.label}
        </label>
      ) : (
        <FieldInput
          id={id}
          fieldtype={df.fieldtype === "Read Only" ? "Data" : df.fieldtype}
          value={field.value ?? ""}
          onChange={(v) => field.user_set(v)}
          disabled={readOnly}
          options={Array.isArray(df.options) ? df.options.join("\n") : (df.options ?? "")}
          {...(df.options && typeof df.options === "string" ? { linkedDoctype: df.options } : {})}
          {...(["Link", "Dynamic Link"].includes(df.fieldtype) ? { onLinkSearch: (q: string) => dialogLinkSearch(dialog, field, q) } : {})}
          {...(df.placeholder ? { placeholder: df.placeholder } : {})}
        />
      )}
      {df.description && <FrappeHtml html={df.description} className="text-[11px] text-muted-foreground" />}
    </div>
  )
}

// ── frappe.ui.form.MultiSelectDialog ("Get Items From") ──────────────────────

function PickerView({ entry }: { entry: PickerEntry }) {
  const picker = entry.picker
  const frappe = w().frappe
  const setters: any[] = picker.get_setter_fields()
  const [values, setValues] = useState<Record<string, any>>(() => Object.fromEntries(setters.map((s) => [s.fieldname, s.default ?? ""])))
  const [txt, setTxt] = useState("")
  const [results, setResults] = useState<any[]>([])
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [pageLength, setPageLength] = useState(20)
  const [more, setMore] = useState(false)
  const [childMode, setChildMode] = useState(false)
  const [childRows, setChildRows] = useState<any[]>([])
  const [childChecked, setChildChecked] = useState<Set<string>>(new Set())
  const columns: string[] = picker.columns_to_show()
  const childColumns: string[] = picker.child_columns ?? []

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const r = await frappe.call({ method: "frappe.desk.search.search_widget", args: picker.build_search_args(txt, values, pageLength) })
        if (cancelled) return
        const list: any[] = Array.isArray(r?.message) ? r.message : []
        setMore(list.length > pageLength)
        setResults(list.slice(0, pageLength))
        if (childMode && picker.child_fieldname) {
          const names = list.map((x) => x.name)
          const cr = await frappe.call({
            method: "frappe.client.get_list",
            args: {
              doctype: frappe.meta.get_docfield(picker.doctype, picker.child_fieldname)?.options,
              filters: [["parentfield", "=", picker.child_fieldname], ...(names.length ? [["parent", "in", names]] : [])],
              fields: ["name", "parent", ...childColumns],
              parent: picker.doctype,
              limit_page_length: 100,
              order_by: "parent",
            },
          })
          if (!cancelled) setChildRows(Array.isArray(cr?.message) ? cr.message : [])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, 250)
    return () => { cancelled = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txt, JSON.stringify(values), pageLength, childMode])

  const close = () => picker.dialog.hide()
  const toggle = (set: Set<string>, name: string) => { const n = new Set(set); if (n.has(name)) n.delete(name); else n.add(name); return n }
  const label = (fieldname: string) => frappe.meta.get_label(picker.doctype, fieldname) ?? fieldname
  const childParents = [...new Set(childRows.filter((r) => childChecked.has(r.name)).map((r) => r.parent))]

  return (
    <Modal
      title={`Select ${picker.doctype}`}
      onClose={close}
      wide
      footer={(
        <>
          <span className="mr-auto text-xs text-muted-foreground">{childMode ? `${childChecked.size} row(s) selected` : `${checked.size} selected`}</span>
          <button type="button" className={btnSecondary} onClick={close}>Cancel</button>
          <button
            type="button"
            className={btnPrimary}
            disabled={childMode ? childChecked.size === 0 : checked.size === 0}
            onClick={() => picker.finish(childMode ? [] : [...checked], childMode ? [...childChecked] : [], childMode ? childParents : [], values)}
          >
            {picker.primary_action_label || "Get Items"}
          </button>
        </>
      )}
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground" htmlFor={`picker-${entry.id}-q`}>Search</label>
            <input id={`picker-${entry.id}-q`} value={txt} onChange={(e) => setTxt(e.target.value)} placeholder="Name or ID" className="h-9 w-full rounded-md border border-border bg-background px-3 text-sm" />
          </div>
          {setters.map((s) => (
            <div key={s.fieldname} className="space-y-1 min-w-0">
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{s.label}</label>
              <FieldInput
                fieldtype={s.fieldtype === "Link" || s.fieldtype === "Select" || s.fieldtype === "Date" ? s.fieldtype : "Data"}
                value={values[s.fieldname] ?? ""}
                disabled={!!s.read_only}
                options={s.options ?? ""}
                {...(s.options ? { linkedDoctype: s.options } : {})}
                onChange={(v) => setValues((p) => ({ ...p, [s.fieldname]: v }))}
                {...(s.fieldtype === "Link" ? { onLinkSearch: (q: string) => frappe.call({ method: "frappe.desk.search.search_link", args: { txt: q, doctype: s.options, page_length: 10 } }).then((r: any) => r?.message ?? [], () => []) } : {})}
              />
            </div>
          ))}
          {picker.date_field && (
            <div className="space-y-1">
              <label className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label(picker.date_field)}</label>
              <div className="flex gap-2">
                <input type="date" aria-label="From date" value={values.__from_date ?? ""} onChange={(e) => setValues((p) => ({ ...p, __from_date: e.target.value }))} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm" />
                <input type="date" aria-label="To date" value={values.__to_date ?? ""} onChange={(e) => setValues((p) => ({ ...p, __to_date: e.target.value }))} className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm" />
              </div>
            </div>
          )}
        </div>
        {picker.allow_child_item_selection && picker.child_fieldname && (
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={childMode} onChange={(e) => setChildMode(e.target.checked)} className="h-4 w-4" />
            Select individual {frappe.meta.get_docfield(picker.doctype, picker.child_fieldname)?.options ?? "rows"}
          </label>
        )}

        <div className="overflow-x-auto rounded-lg border border-border">
          {childMode ? (
            <PickerTable
              columns={["parent", ...childColumns]}
              label={(c) => (c === "parent" ? picker.doctype : frappe.meta.get_label(frappe.meta.get_docfield(picker.doctype, picker.child_fieldname)?.options, c) ?? c)}
              rows={childRows}
              checked={childChecked}
              onToggle={(n) => setChildChecked((s) => toggle(s, n))}
              onToggleAll={(all) => setChildChecked(all ? new Set(childRows.map((r) => r.name)) : new Set())}
              loading={loading}
            />
          ) : (
            <PickerTable
              columns={columns}
              label={(c) => (c === "name" ? "ID" : label(c))}
              rows={results}
              checked={checked}
              onToggle={(n) => setChecked((s) => toggle(s, n))}
              onToggleAll={(all) => setChecked(all ? new Set(results.map((r) => r.name)) : new Set())}
              loading={loading}
            />
          )}
        </div>
        {more && !childMode && (
          <button type="button" className={btnSecondary} onClick={() => setPageLength((n) => n + 20)}>Load more</button>
        )}
      </div>
    </Modal>
  )
}

function PickerTable({ columns, label, rows, checked, onToggle, onToggleAll, loading }: {
  columns: string[]
  label: (c: string) => string
  rows: any[]
  checked: Set<string>
  onToggle: (name: string) => void
  onToggleAll: (all: boolean) => void
  loading: boolean
}) {
  const all = rows.length > 0 && rows.every((r) => checked.has(r.name))
  return (
    <table className="w-full text-sm">
      <thead className="bg-muted/30 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
        <tr>
          <th className="w-8 px-3 py-2"><input type="checkbox" aria-label="Select all" checked={all} onChange={(e) => onToggleAll(e.target.checked)} /></th>
          {columns.map((c) => <th key={c} className="px-3 py-2 font-semibold">{label(c)}</th>)}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 && (
          <tr><td colSpan={columns.length + 1} className="px-3 py-6 text-center text-muted-foreground">{loading ? "Searching…" : "No results"}</td></tr>
        )}
        {rows.map((r) => (
          <tr key={r.name} className="cursor-pointer border-t border-border/50 hover:bg-muted/20" onClick={() => onToggle(r.name)}>
            <td className="px-3 py-2"><input type="checkbox" aria-label={`Select ${r.name}`} checked={checked.has(r.name)} onChange={() => onToggle(r.name)} onClick={(e) => e.stopPropagation()} /></td>
            {columns.map((c) => <td key={c} className="px-3 py-2 text-foreground/90">{String(r[c] ?? "")}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
