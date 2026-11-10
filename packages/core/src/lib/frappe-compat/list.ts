/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * The `listview` object Desk passes to `frappe.listview_settings[doctype]`
 * hooks (onload, refresh, button, formatters…), backed by Petal's list page.
 *
 * Scripts call listview.page.add_action_item / add_menu_item /
 * add_inner_button, listview.get_checked_items() and
 * listview.call_for_selected_items(); this records what they ask for and the
 * page renders it. Field and indicator settings (add_fields, get_indicator,
 * formatters, filters) are read by `listSettingsFor`.
 */
import { __, type Any } from "./env"

const g: Any = typeof window !== "undefined" ? window : globalThis

export type ListAction = { label: string; fn: () => unknown; group?: string; standard?: boolean }

export class CompatListView {
  [k: string]: Any
  doctype: string
  settings: Any
  meta: Any
  data: Any[] = []
  checked: string[] = []
  actionItems: ListAction[] = []
  menuItems: ListAction[] = []
  innerButtons: ListAction[] = []
  page: Any
  private listeners = new Set<() => void>()
  /** Set by the page: refetch the current list. */
  onRefresh: (() => void) | null = null
  /** Set by the page: clear the selection. */
  onClearChecked: (() => void) | null = null

  constructor(doctype: string) {
    this.doctype = doctype
    this.settings = g.frappe.listview_settings[doctype] ?? {}
    this.meta = g.frappe.get_meta(doctype)
    this.page_name = "List/" + doctype
    this.view = "List"
    this.page_length = 20
    this.filters = []
    this.page = this.makePage()
    this.filter_area = this.makeFilterArea()
    this.$result = g.$(typeof document !== "undefined" ? document.createElement("div") : {})
    this.wrapper = this.$result
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }
  private emit() { for (const fn of this.listeners) fn() }

  private makePage(): Any {
    const self = this
    const el = () => g.$(typeof document !== "undefined" ? document.createElement("div") : {})
    const fields_dict: Any = {}
    for (const df of (this.meta?.fields ?? []) as Any[]) {
      if (!df.in_standard_filter) continue
      fields_dict[df.fieldname] = { df, get_value: () => null, set_value: () => Promise.resolve(), $input: el(), $wrapper: el(), refresh() {} }
    }
    return {
      fields_dict,
      wrapper: el(),
      main: el(),
      sidebar: el(),
      page_form: el(),
      add_action_item(label: string, fn: () => unknown, standard?: boolean) {
        self.actionItems = [...self.actionItems.filter((a) => a.label !== label), { label, fn, standard: !!standard }]
        self.emit()
        return el()
      },
      clear_actions_menu() { self.actionItems = []; self.emit() },
      add_menu_item(label: string, fn: () => unknown, standard?: boolean) {
        self.menuItems = [...self.menuItems.filter((a) => a.label !== label), { label, fn, standard: !!standard }]
        self.emit()
        return el()
      },
      add_custom_menu_item(_parent: Any, label: string, fn: () => unknown) { return this.add_menu_item(label, fn) },
      clear_menu() { self.menuItems = []; self.emit() },
      add_inner_button(label: string, fn: () => unknown, group?: string) {
        self.innerButtons = [...self.innerButtons.filter((a) => !(a.label === label && a.group === group)), { label, fn, ...(group ? { group } : {}) }]
        self.emit()
        return el()
      },
      add_custom_button_group(label: string) {
        // Desk returns the group's dropdown; scripts then add items via add_custom_menu_item.
        const group = el()
        group.data("petal-group", label)
        return group
      },
      remove_inner_button(label: string, group?: string) {
        self.innerButtons = self.innerButtons.filter((a) => !(a.label === label && (group === undefined || a.group === group)))
        self.emit()
      },
      clear_inner_toolbar() { self.innerButtons = []; self.emit() },
      set_title() {}, set_indicator() {}, clear_indicator() {},
      set_primary_action() {}, clear_primary_action() {}, set_secondary_action() {},
      add_field: () => ({ get_value: () => null, set_value: () => Promise.resolve(), $wrapper: el(), $input: el() }),
      show_form() {}, hide_form() {},
      btn_primary: el(), btn_secondary: el(),
    }
  }

  private makeFilterArea(): Any {
    const self = this
    const norm = (f: Any[]) => (f.length === 4 ? f : [self.doctype, ...f])
    return {
      get: () => self.filters,
      add(filters: Any[] | Any, ...rest: Any[]) {
        // add([[...], ...]) or add(doctype, field, op, value)
        const list = Array.isArray(filters?.[0]) ? filters : [[filters, ...rest].slice(-3)]
        self.filters = [...self.filters, ...list.map(norm)]
        self.refresh()
        return Promise.resolve()
      },
      remove(field: string) { self.filters = self.filters.filter((f: Any[]) => f[1] !== field); self.refresh(); return Promise.resolve() },
      clear() { self.filters = []; self.refresh(); return Promise.resolve() },
      exists: (field: string) => self.filters.some((f: Any[]) => f[1] === field),
      filter_list: { filters: [], get_filter: () => null },
    }
  }

  get_checked_items(only_docnames?: boolean) {
    if (only_docnames) return [...this.checked]
    return this.data.filter((d) => this.checked.includes(d.name))
  }
  clear_checked_items() { this.checked = []; this.onClearChecked?.() }

  // base_list.js call_for_selected_items
  call_for_selected_items(method: string, args: Any = {}) {
    args.names = this.get_checked_items(true)
    return g.frappe.call({ method, args, freeze: true, callback: (r: Any) => { if (!r.exc) this.refresh() } })
  }

  refresh() { this.onRefresh?.() }
  get_args() { return { doctype: this.doctype, filters: this.filters } }
  set_route_options() {}
  toggle_side_bar() {}
}

/** Settings from listview_settings that change how rows are fetched and shown. */
export type ListSettings = {
  /** Fields to fetch with each row (add_fields + what the indicator reads). */
  extraFields: string[]
  /** [label, colour] for a row, from frappe.get_indicator (settings.get_indicator, workflow, docstatus). */
  indicator: (row: Any) => { label: string; color: string } | null
  /** settings.formatters: fieldname → HTML for a cell. */
  formatters: Record<string, (value: Any, df: Any, doc: Any) => string>
  /** settings.filters: the list's default filters. */
  filters: Any[]
  hasIndicator: boolean
}

const STANDARD = new Set(["name", "owner", "creation", "modified", "modified_by", "docstatus", "idx", "_assign", "_comments", "_liked_by", "_user_tags"])

export function listSettingsFor(doctype: string): ListSettings {
  const frappe = g.frappe
  const settings = frappe.listview_settings[doctype] ?? {}
  const meta = frappe.get_meta(doctype)
  const has = (f: string) => STANDARD.has(f) || !!frappe.meta.has_field(doctype, f)
  const fields = new Set<string>()
  for (const raw of (settings.add_fields ?? []) as string[]) {
    // Desk also accepts "`tabX`.`field`"; keep the plain fieldname.
    const f = String(raw).replace(/^`?tab[^`]*`?\./, "").replace(/`/g, "")
    if (/^[a-z0-9_]+$/i.test(f) && has(f)) fields.add(f)
  }
  for (const f of ["status", "enabled", "disabled"]) if (has(f)) fields.add(f)
  const wf = frappe.workflow.get_state_fieldname?.(doctype)
  if (wf && has(wf)) fields.add(wf)
  if (meta?.title_field && has(meta.title_field)) fields.add(meta.title_field)

  const hasIndicator = !!settings.get_indicator || !!meta?.is_submittable || fields.has("status") || !!wf
    || fields.has("enabled") || fields.has("disabled")
  return {
    extraFields: [...fields],
    hasIndicator,
    indicator: (row: Any) => {
      try {
        const ind = frappe.get_indicator({ doctype, ...row }, doctype)
        return ind ? { label: String(ind[0]), color: String(ind[1] ?? "gray") } : null
      } catch (e) {
        console.warn(`[Petal compat] ${doctype} get_indicator`, e)
        return null
      }
    },
    formatters: settings.formatters ?? {},
    filters: Array.isArray(settings.filters) ? settings.filters : [],
  }
}

/** Run settings.onload(listview) once for a list page. */
export function runListOnload(listview: CompatListView) {
  try { listview.settings.onload?.(listview) } catch (e) { console.error(`[Petal compat] ${listview.doctype} list onload`, e) }
}

/** Run settings.refresh(listview) after a page of rows loads. */
export function runListRefresh(listview: CompatListView, rows: Any[]) {
  listview.data = rows
  try { listview.settings.refresh?.(listview) } catch (e) { console.error(`[Petal compat] ${listview.doctype} list refresh`, e) }
}

export function listButtonLabel(action: ListAction): string {
  return action.group ? `${__(action.group)} › ${__(action.label)}` : __(action.label)
}
