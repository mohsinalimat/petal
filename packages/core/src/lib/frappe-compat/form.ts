/* eslint-disable @typescript-eslint/no-explicit-any, no-new-func */
/**
 * The Desk form engine — `frm`, `frappe.ui.form.on`, ScriptManager, grids,
 * fields_dict, link queries/fetch, mandatory checks and save/submit/cancel —
 * ported from frappe/public/js/frappe/form/{form,script_manager,save,grid}.js.
 *
 * One Form per doctype (like Desk), switched between documents. Rendering is
 * Petal's: the form calls `notify()` after every change and React re-reads a
 * snapshot of `frm.doc` plus the per-document docfield copies.
 */
import { __, cint, cstr, type Any } from "./env"
import { TABLE_FIELDS, run_serially } from "./model"

const g: Any = typeof window !== "undefined" ? window : globalThis

export type CustomButton = { label: string; group: string | null; fn: Any; type?: string }
export type MenuItem = { label: string; fn: Any }

const mkEl = (tag = "div"): HTMLElement => (typeof document !== "undefined" ? document.createElement(tag) : ({} as HTMLElement))

// ── Change notification (batched to one render per tick) ─────────────────────
type Listener = () => void
const formListeners = new Set<Listener>()
let scheduled = false
export function notifyForms() {
  if (scheduled) return
  scheduled = true
  queueMicrotask(() => {
    scheduled = false
    formListeners.forEach((l) => l())
  })
}
export function subscribeForms(l: Listener) {
  formListeners.add(l)
  return () => { formListeners.delete(l) }
}

/** A fields_dict entry — the parts of frappe.ui.form.Control scripts touch. */
class FormField {
  frm: Any
  fieldname: string
  doctype: string
  wrapper: HTMLElement
  $wrapper: Any
  input: HTMLElement
  $input: Any
  label_area: HTMLElement
  get_query: Any
  grid: Any
  ;[key: string]: Any

  constructor(frm: Any, df: Any) {
    this.frm = frm
    this.fieldname = df.fieldname
    this.doctype = frm.doctype
    this.wrapper = mkEl()
    this.$wrapper = g.$(this.wrapper)
    this.input = mkEl("input")
    this.$input = g.$(this.input)
    this.label_area = mkEl("label")
    if (df.fieldtype === "HTML" && df.options) this.wrapper.innerHTML = df.options
    if (TABLE_FIELDS.includes(df.fieldtype)) this.grid = new Grid(frm, this)
    const part = () => {
      const $w = g.$(mkEl())
      return { wrapper: $w, $wrapper: $w, body: $w, hide: () => this.toggle(false), show: () => this.toggle(true), collapse: () => {}, is_collapsed: () => false, refresh: () => notifyForms(), set_label: (l: string) => this.set_label(l) }
    }
    this.row = part()
    this.section = part()
    this.column = part()
    this.tab = { ...part(), set_active: () => {}, is_active: () => true, toggle: (show: boolean) => this.toggle(show) }
    // Desk's Section/Column/Tab objects expose `wrapper` as a jQuery object.
    if (["Section Break", "Column Break", "Tab Break"].includes(df.fieldtype)) {
      Object.assign(this, part())
      this.wrapper = this.$wrapper
      this.head = g.$(mkEl())
    }
  }

  /** The live docfield for the open document (where set_df_property writes). */
  get df(): Any {
    return g.frappe.meta.get_docfield(this.frm.doctype, this.fieldname, this.frm.docname)
      ?? g.frappe.meta.docfield_map[this.frm.doctype]?.[this.fieldname] ?? { fieldname: this.fieldname }
  }
  get docname() { return this.frm.docname }
  get value() { return this.frm.doc?.[this.fieldname] }
  get_value() { return this.frm.doc?.[this.fieldname] }
  get_input_value() { return this.get_value() }
  set_value(v: Any) { return this.frm.set_value(this.fieldname, v) }
  set_input(v: Any) { if (this.frm.doc) this.frm.doc[this.fieldname] = v; notifyForms() }
  refresh() { notifyForms() }
  refresh_input() { notifyForms() }
  set_label(label: string) { const df = this.df; if (df) df.label = label; notifyForms() }
  set_description(txt: string) { const df = this.df; if (df) df.description = txt; notifyForms() }
  toggle_label() {}
  toggle_description() {}
  toggle(show: boolean) { this.frm.toggle_display(this.fieldname, show) }
  set_focus() {
    if (typeof document === "undefined") return
    setTimeout(() => document.getElementById(`field-input-${this.fieldname}`)?.focus(), 0)
  }
  set_invalid() {}
  set_mandatory() {}
  validate(v: Any) { return v }
  set_formatted_input(v: Any) { this.set_input(v) }
  set_data(data: Any) { const df = this.df; if (df) df.options = data; notifyForms() }
  set_options(options: Any) { this.set_data(options) }
  html(html: string) { this.$wrapper.html(html) }
}

/** A grid's per-column handle: grid.get_field("item_code").get_query = … */
class GridField {
  grid: Grid
  fieldname: string
  get_query: Any
  constructor(grid: Grid, fieldname: string) {
    this.grid = grid
    this.fieldname = fieldname
  }
  get df() { return this.grid.get_docfield(this.fieldname) }
}

/** frm.fields_dict[table].grid */
class Grid {
  frm: Any
  field: FormField
  wrapper: Any
  grid_rows: Any[] = []
  grid_rows_by_docname: Record<string, Any> = {}
  fieldsMap: Record<string, GridField> = {}
  cannot_add_rows = false
  sortable_only = false
  custom_buttons: Array<{ label: string; fn: Any }> = []
  ;[key: string]: Any

  constructor(frm: Any, field: FormField) {
    this.frm = frm
    this.field = field
    this.wrapper = g.$(mkEl())
    this.grid_buttons = g.$(mkEl())
  }

  get df() { return this.field.df }
  get doctype() { return this.field.df?.options }
  get data() { return this.frm.doc?.[this.field.fieldname] ?? [] }
  get docfields() { return g.frappe.meta.get_docfields(this.doctype, this.frm.docname) }
  get fields_map() {
    const out: Record<string, Any> = {}
    for (const df of this.docfields) out[df.fieldname] = df
    return out
  }
  get editable_fields() { return this.docfields.filter((d: Any) => d.in_list_view).map((d: Any) => ({ fieldname: d.fieldname, columns: d.columns })) }
  set editable_fields(_v: Any) { /* layout-only in Desk */ }

  get_docfield(fieldname: string) { return g.frappe.meta.get_docfield(this.doctype, fieldname, this.frm.docname) }
  get_field(fieldname: string) {
    if (!this.fieldsMap[fieldname]) this.fieldsMap[fieldname] = new GridField(this, fieldname)
    return this.fieldsMap[fieldname]
  }

  update_docfield_property(fieldname: string, property: string, value: Any) {
    const cdt = this.doctype
    const parentCopy = this.get_docfield(fieldname)
    if (parentCopy) parentCopy[property] = value
    for (const row of this.data) {
      const df = g.frappe.meta.get_docfield(cdt, fieldname, row.name)
      if (df) df[property] = value
    }
    notifyForms()
  }
  set_column_disp(fieldnames: Any, show: Any) {
    for (const f of Array.isArray(fieldnames) ? fieldnames : [fieldnames]) this.update_docfield_property(f, "hidden", show ? 0 : 1)
  }
  toggle_reqd(fieldname: string, reqd: Any) { this.update_docfield_property(fieldname, "reqd", reqd ? 1 : 0) }
  toggle_enable(fieldname: string, enable: Any) { this.update_docfield_property(fieldname, "read_only", enable ? 0 : 1) }
  toggle_display(fieldname: string, show: Any) { this.set_column_disp(fieldname, show) }
  toggle_checkboxes() {}
  set_multiple_add() {}
  setup_allow_bulk_edit() {}
  refresh() { this.sync_rows(); notifyForms() }
  refresh_row(_docname: string) { notifyForms() }
  set_value(_fieldname: string, _value: Any, _doc: Any) { notifyForms() }
  get_selected() { return this.get_selected_children().map((d: Any) => d.name) }
  get_selected_children() { return this.data.filter((d: Any) => d.__checked) }
  get_row(key: Any) { return typeof key === "number" ? this.grid_rows[key] : this.grid_rows_by_docname[key] }
  get_data() { return this.data }
  is_editable() { return this.frm.doc?.docstatus === 0 && !this.cannot_add_rows }
  add_custom_button(label: string, fn: Any) {
    this.custom_buttons = this.custom_buttons.filter((b) => b.label !== label)
    this.custom_buttons.push({ label, fn })
    notifyForms()
    return g.$(mkEl("button"))
  }
  clear_custom_buttons() { this.custom_buttons = []; notifyForms() }
  remove_all() {
    for (const row of [...this.data]) g.frappe.model.clear_doc(row.doctype, row.name)
    this.frm.doc[this.field.fieldname] = []
    this.frm.dirty()
    notifyForms()
  }
  add_new_row(idx?: number, callback?: Any, _show?: boolean, copy_doc?: Any) {
    if (!this.frm.doc) return
    const d = g.frappe.model.add_child(this.frm.doc, this.doctype, this.field.fieldname, idx)
    if (copy_doc) {
      for (const [k, v] of Object.entries(copy_doc)) if (!["name", "idx", "doctype", "parent", "parentfield", "parenttype", "__islocal"].includes(k)) d[k] = v
    }
    d.__unedited = true
    const p = this.frm.script_manager.trigger(this.field.fieldname + "_add", d.doctype, d.name)
    this.refresh()
    if (callback) void Promise.resolve(p).then(() => callback(d))
    return d
  }
  add_items_button() {}
  only_sortable(status = true) { this.sortable_only = !!status; this.cannot_add_rows = !!status; notifyForms() }
  setup_toolbar() {}
  toggle_add_delete_button_display() {}
  refresh_remove_rows_button() {}

  /** grid_rows as objects with the GridRow methods scripts call. */
  sync_rows() {
    const frm = this.frm
    this.grid_rows = this.data.map((doc: Any) => ({
      doc,
      grid: this,
      wrapper: g.$(mkEl()),
      refresh_field: () => notifyForms(),
      refresh: () => notifyForms(),
      toggle_editable: (fieldname: string, editable: Any) => {
        const df = g.frappe.meta.get_docfield(doc.doctype, fieldname, doc.name)
        if (df) df.read_only = editable ? 0 : 1
        notifyForms()
      },
      toggle_display: (fieldname: string, show: Any) => {
        const df = g.frappe.meta.get_docfield(doc.doctype, fieldname, doc.name)
        if (df) df.hidden = show ? 0 : 1
        notifyForms()
      },
      toggle_reqd: (fieldname: string, reqd: Any) => {
        const df = g.frappe.meta.get_docfield(doc.doctype, fieldname, doc.name)
        if (df) df.reqd = reqd ? 1 : 0
        notifyForms()
      },
      get_field: (fieldname: string) => this.get_field(fieldname),
      on_grid_fields_dict: {},
      columns: {},
      remove: () => frm.remove_row(this.field.fieldname, doc.name),
      open_form_button: g.$(mkEl()),
    }))
    this.grid_rows_by_docname = Object.fromEntries(this.grid_rows.map((r) => [r.doc.name, r]))
  }
}

class ScriptManager {
  frm: Any
  constructor(frm: Any) { this.frm = frm }

  make(ControllerClass: Any) {
    this.frm.cscript = g.extend_cscript(this.frm.cscript, new ControllerClass({ frm: this.frm }))
  }

  trigger(event_name: string, doctype?: string, name?: string): Promise<Any> {
    const frm = this.frm
    doctype = doctype || frm.doctype
    name = name || frm.docname
    const tasks: Any[] = []
    const handlers = this.get_handlers(event_name, doctype!)
    frm.selected_doc = g.frappe.get_doc(doctype, name)

    const runner = (fn: Any, is_old_style: boolean) => {
      let p: Any = null
      try {
        p = is_old_style ? frm.cscript[fn](frm.doc, doctype, name) : fn(frm, doctype, name)
      } catch (e) {
        this.log_error(event_name, e)
        throw e
      }
      return p && p.then ? p : g.frappe.after_server_call()
    }
    for (const fn of handlers.new_style) {
      if (event_name === "setup") { try { runner(fn, false) } catch { /* logged */ } } else tasks.push(() => runner(fn, false))
    }
    for (const fn of handlers.old_style) {
      if (event_name === "setup") { try { runner(fn, true) } catch { /* logged */ } } else tasks.push(() => runner(fn, true))
    }
    const done = run_serially(tasks)
    void done.then(notifyForms, notifyForms)
    return done
  }

  has_handlers(event_name: string, doctype: string) {
    const h = this.get_handlers(event_name, doctype)
    return h.old_style.length || h.new_style.length
  }

  get_handlers(event_name: string, doctype: string) {
    const handlers = { old_style: [] as string[], new_style: [] as Any[] }
    const registry = g.frappe.ui.form.handlers
    if (registry[doctype] && registry[doctype][event_name]) handlers.new_style.push(...registry[doctype][event_name])
    // cscript (old-style controllers) only answer for the form's own doctype
    // and its children, exactly as Desk resolves `this.frm.cscript[event]`.
    if (this.frm.cscript[event_name]) handlers.old_style.push(event_name)
    if (this.frm.cscript["custom_" + event_name]) handlers.old_style.push("custom_" + event_name)
    return handlers
  }

  setup() {
    const meta = this.frm.meta
    g.cur_frm = this.frm
    if (meta.__js) {
      try {
        new Function(meta.__js)()
      } catch (e) {
        console.error(`[Petal compat] Error in ${meta.name} form script`, e)
      }
    }
    if (meta.__custom_js) {
      try {
        new Function(meta.__custom_js)()
      } catch (e: Any) {
        g.frappe.msgprint({ title: __("Error in Client Script"), indicator: "orange", message: "<pre>" + cstr(e?.stack ?? e) + "</pre>" })
      }
    }
    const READONLY_FETCH = ["Data", "Read Only", "Text", "Small Text", "Currency", "Check", "Text Editor", "Attach Image", "Code", "Link", "Float", "Int", "Date", "Datetime", "Select", "Duration", "Time"]
    const setup_add_fetch = (df: Any) => {
      const ok = READONLY_FETCH.includes(df.fieldtype) || df.read_only == 1 || df.is_virtual == 1
      if (ok && df.fetch_from && df.fetch_from.indexOf(".") != -1) {
        const parts = df.fetch_from.split(".")
        this.frm.add_fetch(parts[0], parts[1], df.fieldname, df.parent)
      }
    }
    for (const df of g.frappe.meta.docfield_list[this.frm.doctype] ?? []) {
      setup_add_fetch(df)
      if (TABLE_FIELDS.includes(df.fieldtype)) for (const cdf of g.frappe.meta.docfield_list[df.options] ?? []) setup_add_fetch(cdf)
    }
    if (meta.__css) g.frappe.dom.set_style(meta.__css)
    this.trigger("setup")
  }

  log_error(caller: string, e: Any) {
    g.frappe.show_alert({ message: __("Error in Client Script."), indicator: "red" })
    console.error(`[Petal compat] error in client script (${caller})`, e)
  }

  copy_from_first_row(parentfield: string, current_row: Any, fieldnames: Any) {
    const data = this.frm.doc[parentfield]
    if (data.length === 1 || data[0] === current_row) return
    for (const f of typeof fieldnames === "string" ? [fieldnames] : fieldnames) {
      g.frappe.model.set_value(current_row.doctype, current_row.name, f, data[0][f])
    }
  }
}

export class Form {
  doctype: string
  docname = ""
  doc: Any = null
  meta: Any
  fields: FormField[] = []
  fields_dict: Record<string, FormField> = {}
  grids: Array<{ df: Any; grid: Grid }> = []
  cscript: Any
  events: Any = {}
  opendocs: Record<string, boolean> = {}
  fetch_dict: Any = {}
  custom_buttons: Record<string, Any> = {}
  buttons: CustomButton[] = []
  primaryGroup: string | null = null
  menuItems: MenuItem[] = []
  primaryAction: { label: string; fn: Any } | null = null
  secondaryAction: { label: string; fn: Any } | null = null
  saveDisabled = false
  indicator: { label: string; color: string } | null = null
  intro: { html: string; color: string } | null = null
  headline: { html: string; color: string } | null = null
  dashboardIndicators: Array<{ label: string; color: string }> = []
  dashboardProgress: Array<{ title: string; percent: Any; message: string }> = []
  dashboardComments: Array<{ html: string; color: string }> = []
  dashboardSections: HTMLElement[] = []
  footnote: string | null = null
  saving = false
  setup_done = false
  script_manager: ScriptManager
  perm: Any[] = [{}]
  page: Any
  dashboard: Any
  toolbar: Any
  sidebar: Any
  layout: Any
  timeline: Any
  wrapper: HTMLElement
  $wrapper: Any
  read_only = false
  action_perm_type_map = { Create: "create", Save: "write", Submit: "submit", Update: "submit", Cancel: "cancel", Amend: "amend", Delete: "delete" }
  ;[key: string]: Any

  constructor(doctype: string) {
    this.doctype = doctype
    this.meta = g.frappe.get_meta(doctype)
    if (this.meta?.istable) this.meta.in_dialog = 1
    this.cscript = new g.frappe.ui.form.Controller({ frm: this })
    this.script_manager = new ScriptManager(this)
    this.wrapper = mkEl()
    this.$wrapper = g.$(this.wrapper)
    this.perm = g.frappe.perm.get_perm(doctype)
    this.page = makePage(this)
    this.dashboard = makeDashboard(this)
    this.toolbar = { page: this.page, refresh: () => notifyForms(), set_primary_action: () => { this.saveDisabled = false; notifyForms() }, current_status: null, show_title_as_dirty: () => {} }
    this.sidebar = { image_wrapper: g.$(mkEl()), reload_docinfo: () => {}, refresh: () => {}, make: () => {}, add_user_action: (label: string, fn: Any) => this.page.add_menu_item(label, fn) }
    this.layout = { wrapper: g.$(mkEl()), show_message: (html?: string, color?: string) => { this.intro = html ? { html, color: color ?? "blue" } : null; notifyForms() }, refresh_sections: () => notifyForms(), refresh_dependency: () => notifyForms(), refresh: () => notifyForms(), fields_dict: this.fields_dict, unfold: () => {} }
    this.timeline = { wrapper: g.$(mkEl()), refresh: () => {}, add_timeline_item: () => {} }
    this.footer = { wrapper: g.$(mkEl()) }
    this.print_preview = { refresh_print_options: () => {} }
    this.states = { refresh: () => {} }
    this.attachments = { get_attachments: () => g.frappe.model.get_docinfo(this.doctype, this.docname)?.attachments ?? [] }
    this.viewers = { parent: g.$(mkEl()) }
    this.undo_manager = { erase_history: () => {} }
  }

  // ── setup & lifecycle (form.js) ──────────────────────────────────────────
  setup() {
    this.fields = []
    for (const k of Object.keys(this.fields_dict)) delete this.fields_dict[k]
    this.grids = []
    for (const df of g.frappe.meta.docfield_list[this.doctype] ?? []) {
      if (!df.fieldname) continue
      const f = new FormField(this, df)
      this.fields.push(f)
      this.fields_dict[df.fieldname] = f
      if (f.grid) this.grids.push({ df, grid: f.grid })
    }
    this.state_fieldname = g.frappe.workflow.get_state_fieldname(this.doctype)
    // Handlers registered before this form existed (e.g. by app bundles) are
    // reachable as frm.events.x too — Desk only adds those registered later.
    const registry = g.frappe.ui.form.handlers[this.doctype] ?? {}
    for (const [ev, list] of Object.entries(registry)) if ((list as Any[]).length) this.events[ev] = (list as Any[])[(list as Any[]).length - 1]
    this.script_manager.setup()
    this.watch_model_updates()
    this.setup_doctype_actions()
    this.setup_done = true
  }

  watch_model_updates() {
    g.frappe.model.on(this.doctype, "*", (fieldname: string, value: Any, doc: Any, skip_dirty_trigger = false) => {
      if (doc.name != this.docname) return
      if (!skip_dirty_trigger) this.dirty()
      const df = g.frappe.meta.get_docfield(this.doctype, fieldname, this.docname)
      if (df && ["Link", "Dynamic Link"].includes(df.fieldtype)) void this.validate_link_and_fetch(df, doc, value)
      notifyForms()
      return this.script_manager.trigger(fieldname, doc.doctype, doc.name)
    })
    for (const df of g.frappe.meta.get_table_fields(this.doctype)) {
      g.frappe.model.on(df.options, "*", (fieldname: string, value: Any, doc: Any) => {
        if (doc.parent == this.docname && doc.parentfield === df.fieldname) {
          this.dirty()
          const cdf = g.frappe.meta.get_docfield(doc.doctype, fieldname, doc.name)
          if (cdf && ["Link", "Dynamic Link"].includes(cdf.fieldtype)) void this.validate_link_and_fetch(cdf, doc, value)
          notifyForms()
          return this.script_manager.trigger(fieldname, doc.doctype, doc.name)
        }
      })
    }
  }

  setup_doctype_actions() {
    for (const action of this.meta?.actions ?? []) {
      g.frappe.ui.form.on(this.doctype, "refresh", () => {
        if (!this.is_new() && !action.hidden) this.add_custom_button(action.label, () => this.execute_action(action), action.group)
      })
    }
  }

  execute_action(action: Any) {
    if (typeof action === "string") {
      action = (this.meta.actions ?? []).find((a: Any) => a.label === action) ?? action
      if (typeof action === "string") g.frappe.throw(`Action ${action} not found`)
    }
    if (action.action_type === "Server Action") {
      return g.frappe.xcall(action.action, { doc: this.doc }).then((doc: Any) => {
        if (doc?.doctype) { g.frappe.model.sync(doc); this.refresh() }
        g.frappe.msgprint({ message: __("{} Complete", [__(action.label)]), alert: true })
      })
    } else if (action.action_type === "Route") {
      return g.frappe.set_route(action.action)
    }
  }

  /** Open (or re-render) a document. Returns once refresh handlers have run. */
  async refresh(docname?: string): Promise<void> {
    const switched = !!docname && docname !== this.docname
    if (docname) this.docname = docname
    g.cur_frm = this
    if (!this.docname) return
    this.doc = g.frappe.get_doc(this.doctype, this.docname)
    if (!this.doc) return
    this.perm = g.frappe.perm.get_perm(this.doctype, this.doc)
    for (const t of this.grids) t.grid.sync_rows()
    if (!this.setup_done) this.setup()

    if (!this.opendocs[this.docname]) {
      this.cscript.is_onload = true
      await this.script_manager.trigger("before_load", this.doctype, this.docname).catch(() => {})
      await this.script_manager.trigger("onload").catch(() => {})
      this.opendocs[this.docname] = true
      await this.render_form(switched)
      await g.frappe.after_ajax()
      await this.trigger_link_fields()
    } else {
      this.cscript.is_onload = false
      await this.render_form(switched)
    }
    notifyForms()
  }

  async render_form(_switched?: boolean) {
    if (this.meta?.istable) return
    this.refresh_header()
    for (const t of this.grids) t.grid.sync_rows()
    try { g.$(document).trigger("form-refresh", [this]) } catch { /* noop */ }
    await this.script_manager.trigger("refresh").catch(() => {})
    if (this.cscript.is_onload) await this.script_manager.trigger("onload_post_render").catch(() => {})
    if (g.frappe.route_hooks.after_load) {
      const cb = g.frappe.route_hooks.after_load
      delete g.frappe.route_hooks.after_load
      try { cb(this) } catch (e) { console.error(e) }
    }
  }

  /** Mirrors Toolbar.refresh + dashboard.reset: buttons and banners are rebuilt on every refresh. */
  refresh_header() {
    this.clear_custom_buttons()
    this.menuItems = []
    this.primaryAction = null
    this.secondaryAction = null
    this.saveDisabled = false
    this.indicator = null
    this.intro = null
    this.dashboard.reset()
    for (const t of this.grids) t.grid.custom_buttons = []
    notifyForms()
  }

  async trigger_link_fields() {
    if (!(this.is_new() && this.doc.__run_link_triggers)) return
    for (const f of this.fields) {
      const df = f.df
      if (df.fieldtype == "Link" && this.doc[f.fieldname]) {
        await g.frappe.model.set_value(this.doctype, this.docname, f.fieldname, this.doc[f.fieldname], "Link", true)
      }
    }
    this.doc.__run_link_triggers = false
  }

  // ── link validation & fetch (controls/link.js) ───────────────────────────
  fetch_map_for(df: Any): Record<string, string> {
    const out: Record<string, string> = {}
    for (const key of ["*", df.parent]) {
      if (this.fetch_dict[key] && this.fetch_dict[key][df.fieldname]) Object.assign(out, this.fetch_dict[key][df.fieldname])
    }
    return out
  }

  async validate_link_and_fetch(df: Any, doc: Any, value: Any) {
    const options = df.fieldtype === "Dynamic Link" ? doc[df.options] : df.options
    if (!options) return
    const fetch_map = this.fetch_map_for(df)
    const columns = Object.values(fetch_map)
    if (!columns.length) return
    const update = (response: Any) => {
      const tasks: Any[] = []
      for (const [target, source] of Object.entries(fetch_map)) {
        const tdf = g.frappe.meta.get_docfield(doc.doctype, target, doc.name)
        if (tdf?.fetch_if_empty && doc[target] && value) continue
        const v = value ? response[source] : ""
        tasks.push(() => g.frappe.model.set_value(doc.doctype, doc.name, target, v ?? (tdf && g.frappe.model.is_numeric_field(tdf) ? 0 : "")))
      }
      return run_serially(tasks)
    }
    if (!value) return update({})
    try {
      const response = await g.frappe.xcall("frappe.client.validate_link", { doctype: options, docname: value, fields: columns })
      if (response) await update(response)
    } catch { /* invalid link: Desk clears it; leave as typed so the user sees it */ }
  }

  /** Search args for a link field, per controls/link.js set_custom_query. */
  get_link_search_args(fieldname: string, txt: string, table?: string, rowName?: string): Any {
    const frappe = g.frappe
    let df: Any
    let getQuery: Any
    let doctype = this.doctype
    let docname = this.docname
    if (table) {
      const grid = this.fields_dict[table]?.grid
      if (!grid) return null
      doctype = grid.doctype
      docname = rowName || this.docname
      df = frappe.meta.get_docfield(doctype, fieldname, rowName || this.docname) ?? grid.get_docfield(fieldname)
      getQuery = grid.get_field(fieldname).get_query || df?.get_query
    } else {
      df = frappe.meta.get_docfield(this.doctype, fieldname, this.docname)
      getQuery = this.fields_dict[fieldname]?.get_query || df?.get_query
    }
    if (!df) return null
    const rowDoc = table && rowName ? frappe.get_doc(doctype, rowName) : this.doc
    const linkDoctype = df.fieldtype === "Dynamic Link" ? rowDoc?.[df.options] : df.options
    const args: Any = {
      txt, doctype: linkDoctype, ignore_user_permissions: df.ignore_user_permissions,
      reference_doctype: this.doctype, page_length: cint(frappe.boot.sysdefaults?.link_field_results_limit) || 10,
    }
    const set_nulls = (obj: Any) => {
      for (const [k, v] of Object.entries(obj ?? {})) {
        if (v) continue
        const f = frappe.meta.get_docfield(this.doctype, k)
        if (f && ["Link", "Dynamic Link"].includes(f.fieldtype)) delete obj[k]
        else if (v === undefined) delete obj[k]
      }
      return obj
    }
    if (!getQuery && df.link_filters && df.link_filters.length) {
      try {
        const filters: Any = {}
        for (const [, fname, op, raw] of JSON.parse(df.link_filters)) {
          let value = raw
          if (typeof value === "string" && value.startsWith("eval:")) {
            value = frappe.utils.eval(value.split("eval:")[1], { doc: rowDoc, parent: table ? this.doc : null, frappe })
          }
          filters[fname] = [op, value]
        }
        getQuery = () => ({ filters })
      } catch { /* ignore malformed link_filters */ }
    }
    if (getQuery) {
      if (getQuery && typeof getQuery === "object") {
        let filters = null
        if (getQuery.filters) filters = getQuery.filters
        else if (getQuery.query) args.query = getQuery.query
        else filters = getQuery
        if (filters) { set_nulls(filters); Object.assign(args, filters); args.filters = filters }
      } else if (typeof getQuery === "string") {
        args.query = getQuery
      } else {
        let q: Any
        try { q = getQuery(this.doc, doctype, docname) } catch (e) { console.error("[Petal compat] get_query", e); q = null }
        if (typeof q === "string") args.query = q
        else if (q && typeof q === "object") {
          if (q.filters) set_nulls(q.filters)
          Object.assign(args, q)
          args.filters = q.filters
        }
      }
    }
    if (df.filters) { set_nulls(df.filters); args.filters = { ...(args.filters ?? {}), ...df.filters } }
    return args
  }

  // ── child rows from the Petal grid ───────────────────────────────────────
  async remove_row(table: string, rowName: string) {
    const row = this.doc[table]?.find((r: Any) => r.name === rowName)
    if (!row) return
    try {
      await this.script_manager.trigger("before_" + table + "_remove", row.doctype, row.name)
    } catch {
      return
    }
    g.frappe.model.clear_doc(row.doctype, row.name)
    await this.script_manager.trigger(table + "_remove", row.doctype, row.name).catch(() => {})
    this.dirty()
    this.fields_dict[table]?.grid?.refresh()
  }

  /**
   * Apply an edited row array from Petal's ChildTable: removals, additions,
   * cell edits and reordering, raising Desk's events for each.
   */
  async apply_table_rows(table: string, rows: Any[]) {
    const frappe = g.frappe
    const grid = this.fields_dict[table]?.grid
    if (!grid) return
    const cdt = grid.doctype
    const current: Any[] = [...(this.doc[table] ?? [])]
    const incoming = new Set(rows.filter((r) => r.name).map((r) => r.name))
    for (const row of current) if (!incoming.has(row.name)) await this.remove_row(table, row.name)

    const SKIP = new Set(["name", "idx", "doctype", "parent", "parenttype", "parentfield", "owner", "creation", "modified", "modified_by", "docstatus"])
    const order: string[] = []
    for (const r of rows) {
      let local = r.name ? frappe.get_doc(cdt, r.name) : null
      if (!local) {
        local = grid.add_new_row()
        await frappe.after_server_call()
        for (const [k, v] of Object.entries(r)) {
          if (SKIP.has(k) || k.startsWith("__")) continue
          const df = frappe.meta.get_docfield(cdt, k, local.name)
          if (!df) continue
          if (v === undefined || v === null || v === "" || (df.default !== undefined && String(df.default) === String(v))) continue
          if (local[k] !== v) await frappe.model.set_value(cdt, local.name, k, v, df.fieldtype)
        }
      } else {
        // Decide what the user changed before applying anything: handlers
        // recompute other cells (rate, discount_amount…) and the incoming row
        // still holds their old values, which must not be written back.
        const changed = Object.entries(r).filter(([k, v]) => {
          if (SKIP.has(k) || k.startsWith("__")) return false
          if (local[k] === v || (local[k] == null && (v === "" || v == null))) return false
          return !!frappe.meta.get_docfield(cdt, k, local.name)
        })
        for (const [k, v] of changed) {
          const df = frappe.meta.get_docfield(cdt, k, local.name)
          await frappe.model.set_value(cdt, local.name, k, v, df.fieldtype)
        }
      }
      order.push(local.name)
    }
    const list: Any[] = this.doc[table] ?? []
    const sorted = order.map((n) => list.find((d) => d.name === n)).filter(Boolean)
    const changed = sorted.some((d, i) => list[i] !== d)
    if (changed) {
      sorted.forEach((d, i) => { d.idx = i + 1 })
      this.doc[table] = sorted
      this.dirty()
    }
    grid.refresh()
  }

  // ── public frm API ────────────────────────────────────────────────────────
  dirty() {
    if (!this.doc) return
    this.doc.__unsaved = 1
    notifyForms()
  }
  is_dirty() { return !!this.doc?.__unsaved }
  is_new() { return !!this.doc?.__islocal }
  get_doc() { return g.locals[this.doctype][this.docname] }
  get_docinfo() { return g.frappe.model.get_docinfo(this.doctype, this.docname) }
  has_perm(ptype: string) { return g.frappe.perm.has_perm(this.doctype, 0, ptype, this.doc) }
  get_perm(permlevel: number, access_type: string) { return this.perm[permlevel] ? this.perm[permlevel][access_type] : null }
  get_field(field: string) { return this.fields_dict[field] }
  get_title() { return this.meta?.title_field ? this.doc[this.meta.title_field] : String(this.doc?.name) }
  refresh_field(fname: string) { notifyForms(); return fname }
  refresh_fields() { for (const t of this.grids) t.grid.sync_rows(); notifyForms() }
  trigger(event: string, doctype?: string, docname?: string) { return this.script_manager.trigger(event, doctype, docname) }
  enable_save() { this.saveDisabled = false; notifyForms() }
  disable_save(_set_dirty = false) { this.saveDisabled = true; notifyForms() }
  disable_form() {
    this.read_only = true
    for (const f of this.fields) { const df = f.df; if (df) df.read_only = 1 }
    this.disable_save()
  }
  set_read_only() { this.read_only = true; notifyForms() }
  set_intro(txt: string, color?: string) { this.dashboard.set_headline_alert(txt, color) }
  set_footnote(txt: string) { this.footnote = txt; notifyForms() }
  show_success_action() {}
  scroll_to_element() {}
  scroll_to_field(fieldname: string) {
    if (typeof document === "undefined") return false
    const el = document.getElementById(`field-${fieldname}`)
    el?.scrollIntoView({ behavior: "smooth", block: "center" })
    return !!el
  }
  set_active_tab() {}
  get_active_tab() { return null }
  setup_image_autocompletions_in_markdown() {}
  show_conflict_message() {}
  show_submission_queue_banner() {}
  print_doc() { g.frappe.set_route("print", this.doctype, this.docname) }
  email_doc() { g.frappe.msgprint(__("Email is not available in Petal yet.")) }
  share_doc() {}
  rename_doc() { g.frappe.msgprint(__("Rename is available from the document's menu.")) }
  navigate_records() {}
  get_involved_users() { return [] }
  set_indicator_formatter(fieldname: string, get_color: Any, get_text?: Any) {
    let doctype: string | null = g.frappe.meta.docfield_map[this.doctype]?.[fieldname] ? this.doctype : null
    if (!doctype) for (const df of g.frappe.meta.get_table_fields(this.doctype)) if (g.frappe.meta.docfield_map[df.options]?.[fieldname]) { doctype = df.options; break }
    const df = doctype ? g.frappe.meta.docfield_map[doctype][fieldname] : null
    if (df) df.formatter = (value: Any, _df: Any, _o: Any, doc: Any) => (value ? `<span class="indicator ${get_color(doc || {})}">${get_text ? get_text(doc) : value}</span>` : "")
  }

  add_fetch(link_field: string, source_field: string, target_field: string, target_doctype?: string) {
    if (!target_doctype) target_doctype = "*"
    this.fetch_dict[target_doctype] = this.fetch_dict[target_doctype] ?? {}
    this.fetch_dict[target_doctype][link_field] = this.fetch_dict[target_doctype][link_field] ?? {}
    this.fetch_dict[target_doctype][link_field][target_field] = source_field
  }

  add_custom_button(label: string, fn: Any, group?: string) {
    if (group && group.indexOf("fa fa-") !== -1) group = undefined
    const g2 = group ?? null
    this.buttons = this.buttons.filter((b) => !(b.label === label && b.group === g2))
    const btn = g.$(mkEl("button")).text(label)
    btn.on("click", () => fn && fn())
    this.buttons.push({ label, group: g2, fn })
    this.custom_buttons[label] = btn
    notifyForms()
    return btn
  }
  change_custom_button_type(label: string, group: string | null, type: string) {
    const b = this.buttons.find((x) => x.label === label && x.group === (group ?? null))
    if (b) { b.type = type; notifyForms() }
  }
  clear_custom_buttons() { this.buttons = []; this.primaryGroup = null; this.custom_buttons = {}; notifyForms() }
  remove_custom_button(label: string, group?: string) {
    this.buttons = this.buttons.filter((b) => !(b.label === label && (group === undefined || b.group === group)))
    delete this.custom_buttons[label]
    notifyForms()
  }

  set_currency_labels(fields_list: string[], currency: string, parentfield?: string) {
    if (!currency) return
    const doctype = parentfield ? this.fields_dict[parentfield]?.grid?.doctype : this.doc.doctype
    if (!doctype) return
    for (const fname of fields_list) {
      const docfield = g.frappe.meta.docfield_map[doctype]?.[fname]
      if (!docfield) continue
      const label = __(docfield.label || "").replace(/\([^)]*\)/g, "").trim() + " (" + currency + ")"
      if (parentfield) this.fields_dict[parentfield]!.grid.update_docfield_property(fname, "label", label)
      else this.fields_dict[fname]?.set_label(label)
    }
  }

  field_map(fnames: Any, fn: (df: Any) => void) {
    if (typeof fnames === "string") fnames = fnames == "*" ? Object.keys(this.fields_dict) : [fnames]
    for (const fieldname of fnames ?? []) {
      const df = g.frappe.meta.get_docfield(this.doctype, fieldname, this.docname)
      if (df) fn(df)
    }
    notifyForms()
  }
  get_docfield(fieldname1: string, fieldname2?: string): Any {
    if (fieldname2) {
      const doctype: string = this.get_docfield(fieldname1)?.options
      return g.frappe.meta.get_docfield(doctype, fieldname2, this.docname)
    }
    return g.frappe.meta.get_docfield(this.doctype, fieldname1, this.docname)
  }
  set_df_property(fieldname: string, property: string, value: Any, docname?: string, table_field?: string, table_row_name: string | null = null) {
    let df: Any
    if (!docname || !table_field) {
      df = this.get_docfield(fieldname)
    } else {
      const grid = this.fields_dict[fieldname]?.grid
      if (grid) df = g.frappe.meta.get_docfield(grid.doctype, table_field, table_row_name || docname)
    }
    if (df && df[property] != value) { df[property] = value; notifyForms() }
  }
  toggle_enable(fnames: Any, enable: Any) { this.field_map(fnames, (df) => { df.read_only = enable ? 0 : 1 }) }
  toggle_reqd(fnames: Any, mandatory: Any) { this.field_map(fnames, (df) => { df.reqd = mandatory ? 1 : 0 }) }
  toggle_display(fnames: Any, show: Any) { this.field_map(fnames, (df) => { df.hidden = show ? 0 : 1 }) }

  set_query(fieldname: string, opt1: Any, opt2?: Any) {
    if (opt2) {
      const grid = this.fields_dict[opt1]?.grid
      if (grid) grid.get_field(fieldname).get_query = opt2
    } else if (this.fields_dict[fieldname]) {
      this.fields_dict[fieldname]!.get_query = opt1
    }
  }

  clear_table(fieldname: string) { g.frappe.model.clear_table(this.doc, fieldname); notifyForms() }
  add_child(fieldname: string, values?: Any) {
    const doc = g.frappe.model.add_child(this.doc, g.frappe.meta.get_docfield(this.doctype, fieldname).options, fieldname)
    if (values) for (const [k, v] of Object.entries(values)) if (!["idx", "name"].includes(k)) doc[k] = v
    this.fields_dict[fieldname]?.grid?.sync_rows()
    notifyForms()
    return doc
  }

  set_value(field: Any, value?: Any, if_missing?: boolean, skip_dirty_trigger = false): Promise<Any> {
    const frappe = g.frappe
    const _set = (f: string, v: Any) => {
      const fieldobj = this.fields_dict[f]
      if (!fieldobj) {
        // Desk throws; scripts written against older doctypes sometimes set
        // fields that no longer exist, so warn instead of breaking the flow.
        console.warn(`[Petal compat] ${this.doctype}: field ${f} not found`)
        return Promise.resolve()
      }
      if (if_missing && frappe.model.has_value(this.doctype, this.doc.name, f)) return Promise.resolve()
      const df = fieldobj.df
      if (TABLE_FIELDS.includes(df.fieldtype) && Array.isArray(v)) {
        frappe.model.clear_table(this.doc, f)
        const standard = [...frappe.model.std_fields_list, ...frappe.model.child_table_field_list]
        v.forEach((d: Any, idx: number) => {
          const child = frappe.model.add_child(this.doc, df.options, f, idx + 1)
          const copy = { ...d }
          for (const s of standard) delete copy[s]
          Object.assign(child, copy)
        })
        fieldobj.grid?.sync_rows()
        notifyForms()
        return Promise.resolve()
      }
      // Desk passes `me.fieldtype` here, which is always undefined: a script
      // setting a Link to its current value must NOT re-fire its handlers
      // (only user input does). Passing the real type causes trigger loops.
      return frappe.model.set_value(this.doctype, this.doc.name, f, v, undefined, skip_dirty_trigger)
    }
    if (typeof field == "string") return _set(field, value)
    if (field && typeof field === "object") {
      const tasks = Object.entries(field).filter(([f]) => this.get_field(f)).map(([f, v]) => () => _set(f, v))
      return run_serially(tasks)
    }
    return Promise.resolve()
  }

  call(opts: Any, args?: Any, callback?: Any) {
    const frappe = g.frappe
    if (typeof opts === "string") opts = { method: opts, doc: this.doc, args, callback }
    if (!opts.doc) {
      if (opts.method.indexOf(".") === -1) opts.method = frappe.model.get_server_module_name(this.doctype) + "." + opts.method
      const original = opts.callback
      opts.callback = (r: Any) => {
        if (r.message && typeof r.message === "object" && !Array.isArray(r.message)) {
          if (opts.child) {
            const child = g.locals[opts.child.doctype]?.[opts.child.name]
            if (child) {
              const std = ["doctype", ...frappe.model.std_fields_list, ...frappe.model.child_table_field_list]
              for (const key in r.message) if (!std.includes(key)) child[key] = r.message[key]
              notifyForms()
            }
          } else {
            this.set_value(r.message)
          }
        }
        original && original(r)
      }
    } else {
      const original = opts.callback
      opts.callback = (r: Any) => {
        if (!r.exc) this.refresh_fields()
        original && original(r)
      }
    }
    return frappe.call(opts)
  }

  get_formatted(fieldname: string) { return cstr(this.doc?.[fieldname]) }
  open_grid_row() { return null }
  get_selected() {
    const selected: Any = {}
    for (const df of g.frappe.meta.get_table_fields(this.doctype)) {
      const s = this.fields_dict[df.fieldname]?.grid?.get_selected() ?? []
      if (s.length) selected[df.fieldname] = s
    }
    return selected
  }
  get_files() { return this.attachments.get_attachments() }
  get_sum(table: string, fieldname: string) { return (this.doc[table] || []).reduce((s: number, d: Any) => s + (d[fieldname] || 0), 0) }
  update_in_all_rows(table: string, fieldname: string, value: Any) {
    if (value === undefined) return
    for (const child of g.frappe.model.get_children(this.doc, table)) {
      if (!g.frappe.model.has_value(child.doctype, child.name, fieldname)) g.frappe.model.set_value(child.doctype, child.name, fieldname, value)
    }
  }

  can_create(doctype: string) {
    if (!g.frappe.model.can_create(doctype)) return false
    if (this.custom_make_buttons && this.custom_make_buttons[doctype]) return !!this.custom_buttons[__(this.custom_make_buttons[doctype])]
    if (this.can_make_methods && this.can_make_methods[doctype]) return this.can_make_methods[doctype](this)
    return !(this.meta.is_submittable && this.doc.docstatus !== 1)
  }
  make_new(doctype: string) {
    if (this.make_methods && this.make_methods[doctype]) return this.make_methods[doctype](this)
    if (this.custom_make_buttons && this.custom_make_buttons[doctype]) {
      return this.custom_buttons[__(this.custom_make_buttons[doctype])]?.trigger("click")
    }
    return g.frappe.model.with_doctype(doctype, () => {
      const new_doc = g.frappe.model.get_new_doc(doctype, null, null, true)
      this.set_link_field(doctype, new_doc)
      g.frappe.set_route("Form", doctype, new_doc.name)
    })
  }
  set_link_field(doctype: string, new_doc: Any) {
    for (const df of g.frappe.get_meta(doctype)?.fields ?? []) {
      if (df.fieldtype === "Link" && df.options === this.doctype) new_doc[df.fieldname] = this.doc.name
      else if (["Link", "Dynamic Link"].includes(df.fieldtype) && this.doc[df.fieldname]) new_doc[df.fieldname] = this.doc[df.fieldname]
    }
  }

  async reload_doc() {
    if (this.doc?.__islocal) return
    const r = await g.frappe.call({ method: "frappe.desk.form.load.getdoc", args: { doctype: this.doctype, name: this.docname } })
    if (r) await this.refresh()
  }

  copy_doc(onload?: Any, from_amend?: boolean) {
    const newdoc = g.frappe.model.copy_doc(this.doc, from_amend)
    newdoc.idx = null
    newdoc.__run_link_triggers = false
    if (onload) onload(newdoc)
    g.frappe.set_route("Form", newdoc.doctype, newdoc.name)
  }

  amend_doc() {
    if (!this.fields_dict["amended_from"]) {
      g.frappe.msgprint(__('"amended_from" field must be present to do an amendment.'))
      return
    }
    return g.frappe.xcall("frappe.client.is_document_amended", { doctype: this.doc.doctype, docname: this.doc.name }).then((amended: Any) => {
      if (amended) g.frappe.throw(__("This document is already amended, you cannot ammend it again"))
      this.copy_doc((newdoc: Any) => {
        newdoc.amended_from = this.docname
        if (this.fields_dict["amendment_date"]) newdoc.amendment_date = g.frappe.datetime.obj_to_str(new Date())
      }, true)
    })
  }

  // ── save / submit / cancel (form.js + save.js) ────────────────────────────
  validate_form_action(action: string) {
    const perm = (this.action_perm_type_map as Any)[action]
    if (perm && !this.perm?.[0]?.[perm] && !g.frappe.user_roles?.includes("Administrator")) {
      g.frappe.throw(__("No permission to '{0}' {1}", [__(action), __(this.doc.doctype)]))
    }
  }

  save(save_action?: string, callback?: Any, btn?: Any, on_error?: Any): Promise<Any> {
    return new Promise((resolve) => {
      this.validate_and_save(save_action || "Save", callback, btn, on_error, resolve)
    }).catch((e) => { console.error(e) })
  }

  validate_and_save(save_action: string, callback: Any, btn: Any, on_error: Any, resolve: Any) {
    const frappe = g.frappe
    const after_save = (r: Any) => {
      if (!r.exc) {
        this.script_manager.trigger("after_save")
        if (frappe.route_hooks.after_save) {
          const cb = frappe.route_hooks.after_save
          delete frappe.route_hooks.after_save
          try { cb(this) } catch (e) { console.error(e) }
        }
        void this.refresh(this.docname)
      } else if (on_error) {
        on_error()
      }
      callback && callback(r)
      resolve(r)
    }
    const fail = (e?: Any) => {
      if (e) console.error(e)
      on_error && on_error()
      resolve({ exc: e ?? "validation" })
    }
    try {
      if (save_action !== "Update") this.validate_form_action(save_action === "Submit" ? "Submit" : "Save")
    } catch (e) { return fail(e) }

    if (save_action != "Update") {
      frappe.validated = true
      run_serially([
        () => this.script_manager.trigger("validate"),
        () => this.script_manager.trigger("before_save"),
        () => {
          if (!frappe.validated) { fail(); return }
          this.ui_save(save_action, after_save)
        },
      ]).catch(fail)
    } else {
      this.ui_save(save_action, after_save)
    }
  }

  /** frappe.ui.form.save */
  ui_save(action: string, callback: Any) {
    const frappe = g.frappe
    const done = (r: Any) => {
      this.saving = false
      notifyForms()
      const doc = r?.docs?.[0]
      if (doc && doc.name && doc.name !== this.docname && doc.doctype === this.doctype) {
        this.opendocs[doc.name] = true
        this.docname = doc.name
        this.doc = frappe.get_doc(this.doctype, doc.name)
      }
      callback(r ?? { exc: "error" })
    }
    if (action === "cancel") {
      const args: Any = { doctype: this.doc.doctype, name: this.doc.name }
      const wf = frappe.workflow.get_state_fieldname(this.doctype)
      if (wf) Object.assign(args, { workflow_state_fieldname: wf, workflow_state: this.doc[wf] })
      this.saving = true
      notifyForms()
      frappe.call({ method: "frappe.desk.form.save.cancel", args, freeze: true, callback: done, error: done })
      return
    }
    if ((action !== "Save" || this.is_dirty()) && this.check_mandatory()) {
      if (this.saving) return
      this.saving = true
      notifyForms()
      frappe.call({ method: "frappe.desk.form.save.savedocs", args: { doc: this.doc, action }, freeze: true, callback: done, error: done })
    } else {
      if (!this.is_dirty()) frappe.show_alert({ message: __("No changes in document"), indicator: "orange" })
      callback({ exc: "no-op" })
    }
  }

  check_mandatory(): boolean {
    const frappe = g.frappe
    if (this.doc.docstatus == 2) return true
    let has_errors = false
    const messages: string[] = []
    for (const doc of frappe.model.get_all_docs(this.doc)) {
      const error_fields: string[] = []
      for (const docfield of frappe.meta.docfield_list[doc.doctype] ?? []) {
        if (!docfield.fieldname) continue
        const df = frappe.meta.get_docfield(doc.doctype, docfield.fieldname, doc.name) ?? docfield
        if (["Section Break", "Column Break", "Tab Break", "HTML", "Heading", "Button", "Fold"].includes(df.fieldtype)) continue
        if (cint(df.hidden) || !this.eval_depends(df.depends_on, doc)) continue
        if (this.is_docfield_mandatory(doc, df) && !frappe.model.has_value(doc.doctype, doc.name, df.fieldname)) {
          has_errors = true
          error_fields.push(__(df.label))
        }
      }
      if (this.is_new() && this.meta.autoname === "Prompt" && !this.doc.__newname && doc === this.doc) {
        has_errors = true
        error_fields.unshift(__("Name"))
      }
      if (error_fields.length) {
        const meta = frappe.get_meta(doc.doctype)
        let message: string
        if (meta?.istable) {
          const tf = frappe.meta.docfield_map[doc.parenttype]?.[doc.parentfield]
          message = __("Mandatory fields required in table {0}, Row {1}", [__(tf?.label || frappe.unscrub(doc.parentfield)).bold(), doc.idx])
        } else {
          message = __("Mandatory fields required in {0}", [__(doc.doctype)])
        }
        messages.push(message + "<br><br><ul><li>" + error_fields.join("</li><li>") + "</ul>")
      }
    }
    if (messages.length) frappe.msgprint({ message: messages.join("<br>"), indicator: "red", title: __("Missing Fields") })
    return !has_errors
  }

  is_docfield_mandatory(doc: Any, df: Any) {
    if (df.mandatory_depends_on && doc) {
      const expr = df.mandatory_depends_on
      if (typeof expr === "boolean") return expr
      if (typeof expr === "function") return !!expr(doc)
      if (typeof expr === "string" && expr.substr(0, 5) == "eval:") {
        try { return !!g.frappe.utils.eval(expr.substr(5), { doc, parent: this.doc }) } catch { return false }
      }
      const value = doc[expr]
      return Array.isArray(value) ? !!value.length : !!value
    }
    return !!cint(df.reqd)
  }

  eval_depends(expr: Any, doc: Any): boolean {
    if (!expr) return true
    try {
      if (typeof expr === "string" && expr.startsWith("eval:")) return !!g.frappe.utils.eval(expr.slice(5), { doc, parent: this.doc })
      if (typeof expr === "string") { const v = doc[expr]; return Array.isArray(v) ? !!v.length : !!v }
      return true
    } catch {
      return true
    }
  }

  savesubmit(btn?: Any, callback?: Any, on_error?: Any): Promise<Any> {
    const frappe = g.frappe
    return new Promise((resolve) => {
      try { this.validate_form_action("Submit") } catch { resolve(null); return }
      frappe.confirm(
        __("Permanently Submit {0}?", [this.docname]),
        () => {
          frappe.validated = true
          this.script_manager.trigger("before_submit").then(() => {
            if (!frappe.validated) { on_error && on_error(); resolve(null); return }
            this.save("Submit", (r: Any) => {
              if (r.exc) { on_error && on_error(); resolve(null); return }
              callback && callback()
              this.script_manager.trigger("on_submit").then(() => {
                resolve(this)
                if (frappe.route_hooks.after_submit) {
                  const cb = frappe.route_hooks.after_submit
                  delete frappe.route_hooks.after_submit
                  cb(this)
                }
              })
            }, btn, () => { on_error && on_error(); resolve(null) })
          }, () => resolve(null))
        },
        () => { on_error && on_error(); resolve(null) },
      )
    })
  }

  savecancel(btn?: Any, callback?: Any, on_error?: Any): Promise<Any> {
    const frappe = g.frappe
    this.validate_form_action("Cancel")
    this.ignore_doctypes_on_cancel_all = this.ignore_doctypes_on_cancel_all || []
    return frappe.call({
      method: "frappe.desk.form.linked_with.get_submitted_linked_docs",
      args: { doctype: this.doc.doctype, name: this.doc.name, ignore_doctypes_on_cancel_all: this.ignore_doctypes_on_cancel_all },
      freeze: true,
    }).then((r: Any) => {
      if (!r.exc && (r.message?.docs || []).length) return this._cancel_all(r, btn, callback, on_error)
      return this._cancel(btn, callback, on_error, false)
    })
  }

  _cancel_all(r: Any, btn: Any, callback: Any, on_error: Any) {
    const frappe = g.frappe
    const links = r.message.docs as Any[]
    const doctypes = Array.from(new Set(links.map((l) => l.doctype)))
    let links_text = ""
    for (const dt of doctypes) {
      if (this.ignore_doctypes_on_cancel_all.includes(dt)) continue
      const names = links.filter((l) => l.doctype == dt).map((l) => frappe.utils.get_form_link(l.doctype, l.name, true)).join(", ")
      links_text += `<li><strong>${__(dt)}</strong>: ${names}</li>`
    }
    let msg = __("{0} {1} is linked with the following submitted documents: {2}", [__(this.doc.doctype).bold(), this.doc.name, `<ul>${links_text}</ul>`])
    const can_cancel = links.every((l) => frappe.model.can_cancel(l.doctype))
    msg += can_cancel ? __("Do you want to cancel all linked documents?") : __("You do not have permissions to cancel all linked documents.")
    const d: Any = new frappe.ui.Dialog({ title: __("Cancel All Documents") }, () => { on_error && on_error() })
    d.message = msg
    if (can_cancel) {
      d.set_primary_action(__("Cancel All"), () => {
        d.hide()
        frappe.call({
          method: "frappe.desk.form.linked_with.cancel_all_linked_docs",
          args: { docs: links, ignore_doctypes_on_cancel_all: this.ignore_doctypes_on_cancel_all || [] },
          freeze: true,
          callback: (resp: Any) => { if (!resp.exc) { void this.reload_doc(); this._cancel(btn, callback, on_error, true) } },
        })
      })
    }
    d.show()
  }

  _cancel(_btn: Any, callback: Any, on_error: Any, skip_confirm: boolean) {
    const frappe = g.frappe
    const cancel_doc = () => {
      frappe.validated = true
      this.script_manager.trigger("before_cancel").then(() => {
        if (!frappe.validated) { on_error && on_error(); return }
        this.ui_save("cancel", (r: Any) => {
          if (r.exc) { on_error && on_error(); return }
          void this.refresh(this.docname)
          callback && callback()
          this.script_manager.trigger("after_cancel")
        })
      })
    }
    if (skip_confirm) cancel_doc()
    else frappe.confirm(__("Permanently Cancel {0}?", [this.docname]), cancel_doc, () => { on_error && on_error() })
  }

  savetrash() {
    this.validate_form_action("Delete")
    g.frappe.confirm(__("Permanently delete {0}?", [this.docname]), () =>
      g.frappe.call({ method: "frappe.client.delete", args: { doctype: this.doctype, name: this.docname }, freeze: true })
        .then(() => g.frappe.set_route("List", this.doctype)))
  }
}

function makePage(frm: Form): Any {
  const btn = () => g.$(mkEl("button"))
  return {
    wrapper: g.$(mkEl()),
    main: g.$(mkEl()),
    body: g.$(mkEl()),
    inner_toolbar: g.$(mkEl()),
    page_actions: g.$(mkEl()),
    btn_primary: btn(),
    btn_secondary: btn(),
    current_view_name: "Form",
    add_inner_button: (label: string, fn: Any, group?: string) => frm.add_custom_button(label, fn, group),
    remove_inner_button: (label: string, group?: string) => frm.remove_custom_button(label, group),
    change_inner_button_type: (label: string, group: string | null, type: string) => frm.change_custom_button_type(label, group, type),
    clear_inner_toolbar: () => frm.clear_custom_buttons(),
    clear_user_actions: () => {},
    set_inner_btn_group_as_primary: (group: string) => { frm.primaryGroup = group; notifyForms() },
    get_inner_group_button: (group: string) => g.$(mkEl()).attr("data-group", group),
    is_in_group_button_dropdown: () => null,
    set_primary_action: (label: string, fn: Any) => { frm.primaryAction = { label, fn }; notifyForms(); return btn() },
    clear_primary_action: () => { frm.primaryAction = null; frm.saveDisabled = true; notifyForms() },
    set_secondary_action: (label: string, fn: Any) => { frm.secondaryAction = { label, fn }; notifyForms(); return btn() },
    clear_secondary_action: () => { frm.secondaryAction = null; notifyForms() },
    clear_actions: () => { frm.primaryAction = null; frm.secondaryAction = null; notifyForms() },
    add_menu_item: (label: string, fn: Any) => { frm.menuItems = frm.menuItems.filter((m) => m.label !== label); frm.menuItems.push({ label, fn }); notifyForms(); return g.$(mkEl()) },
    add_action_item: (label: string, fn: Any) => { frm.menuItems.push({ label, fn }); notifyForms(); return g.$(mkEl()) },
    clear_menu: () => { frm.menuItems = []; notifyForms() },
    clear_action_items: () => {},
    set_indicator: (label: string, color: string) => { frm.indicator = { label, color }; notifyForms() },
    clear_indicator: () => { frm.indicator = null; notifyForms() },
    set_title: () => {},
    set_title_sub: () => {},
    hide_icon_group: () => {},
    show_icon_group: () => {},
    add_button: (label: string, fn: Any) => frm.add_custom_button(label, fn),
    add_field: (df: Any) => g.frappe.ui.form.make_control({ df }),
    show_form: () => {},
    hide: () => {},
    show: () => {},
  }
}

function makeDashboard(frm: Form): Any {
  const d: Any = {
    frm,
    stats_area: g.$(mkEl()),
    stats_area_row: g.$(mkEl()),
    progress_area: g.$(mkEl()),
    heatmap_area: g.$(mkEl()),
    chart_area: g.$(mkEl()),
    links_area: g.$(mkEl()),
    transactions_area: g.$(mkEl()),
    wrapper: g.$(mkEl()),
    data: {},
    reset() {
      frm.headline = null
      frm.dashboardIndicators = []
      frm.dashboardProgress = []
      frm.dashboardComments = []
      frm.dashboardSections = []
      notifyForms()
    },
    refresh() { notifyForms() },
    after_refresh() {},
    show() {},
    hide() {},
    set_headline(html: string, color?: string) { frm.headline = { html, color: color ?? "blue" }; notifyForms() },
    set_headline_alert(html: string, color?: string) { frm.intro = html ? { html, color: color ?? "blue" } : null; notifyForms() },
    clear_headline() { frm.headline = null; frm.intro = null; notifyForms() },
    add_indicator(label: string, color: string) { frm.dashboardIndicators.push({ label, color }); notifyForms(); return g.$(mkEl()) },
    add_progress(title: string, percent: Any, message: string) { frm.dashboardProgress.push({ title, percent, message }); notifyForms(); return g.$(mkEl()) },
    show_progress(title: string, percent: Any, message: string) { frm.dashboardProgress = [{ title, percent, message }]; notifyForms() },
    hide_progress() { frm.dashboardProgress = []; notifyForms() },
    add_comment(html: string, color: string, permanent?: boolean) { frm.dashboardComments.push({ html, color }); notifyForms(); return permanent },
    clear_comment() { frm.dashboardComments = []; notifyForms() },
    add_section(body_html: string, label?: string) {
      const el = mkEl()
      el.innerHTML = (label ? `<div class="petal-compat-section-label">${label}</div>` : "") + (body_html ?? "")
      frm.dashboardSections.push(el)
      notifyForms()
      return g.$(el)
    },
    render_graph() {},
    render_heatmap() {},
    set_badge_count() {},
    add_transactions() {},
    refresh_heatmap() {},
    format_percent: (title: string, percent: Any) => Math.round(percent),
  }
  return d
}

export function installForm(frappe: Any) {
  frappe.ui = frappe.ui ?? {}
  frappe.ui.form = frappe.ui.form ?? {}
  frappe.provide("frappe.ui.form.handlers")
  const F = frappe.ui.form

  F.Controller = class Controller {
    constructor(opts: Any) { Object.assign(this, opts) }
  }
  g.extend_cscript = (cscript: Any, controller: Any) => {
    Object.assign(cscript, controller)
    if (cscript && controller) Object.setPrototypeOf(cscript, Object.getPrototypeOf(controller))
    return cscript
  }

  F.get_event_handler_list = (doctype: string, fieldname: string) => {
    if (!F.handlers[doctype]) F.handlers[doctype] = {}
    if (!F.handlers[doctype][fieldname]) F.handlers[doctype][fieldname] = []
    return F.handlers[doctype][fieldname]
  }
  F.on = F.on_change = (doctype: string, fieldname: Any, handler?: Any) => {
    const add = (fn: string, h: Any) => {
      const list = F.get_event_handler_list(doctype, fn)
      const wrapped = (...args: Any[]) => h(...args)
      list.push(wrapped)
      if (g.cur_frm && g.cur_frm.doctype === doctype) g.cur_frm.events[fn] = wrapped
      const form = forms.get(doctype)
      if (form && form !== g.cur_frm) form.events[fn] = wrapped
    }
    if (!handler && fieldname && typeof fieldname === "object") {
      for (const key in fieldname) if (typeof fieldname[key] === "function") add(key, fieldname[key])
    } else {
      add(fieldname, handler)
    }
  }
  F.off = (doctype: string, fieldname: string) => {
    if (F.handlers[doctype]?.[fieldname]) F.handlers[doctype][fieldname] = []
    if (g.cur_frm && g.cur_frm.doctype === doctype) {
      delete g.cur_frm.events[fieldname]
      delete g.cur_frm.cscript?.[fieldname]
    }
  }
  F.trigger = (_doctype: string, fieldname: string) => g.cur_frm?.script_manager.trigger(fieldname)
  F.is_saving = false
  F.close_grid_form = () => {}
  F.get_open_grid_form = () => null
  F.ScriptManager = ScriptManager
  F.Form = Form
  F.save = (frm: Form, action: string, callback: Any) => frm.ui_save(action, callback)
  F.check_mandatory = (frm: Form) => frm.check_mandatory()
  F.update_calling_link = () => {}
  F.remove_old_form_route = () => {}
  F.make_quick_entry = (doctype: string, _after_insert?: Any, init_callback?: Any, doc?: Any) =>
    frappe.model.with_doctype(doctype).then(() => {
      const d = doc ?? frappe.model.get_new_doc(doctype, null, null, true)
      if (init_callback) init_callback(d)
      return frappe.set_route("Form", doctype, d.name)
    })

  // Base classes app bundles extend (their DOM rendering isn't used by Petal)
  class Control { [k: string]: Any; constructor(opts: Any = {}) { Object.assign(this, opts) } make() {} refresh() {} set_value(v: Any) { this.value = v; return Promise.resolve() } get_value() { return this.value } }
  for (const name of ["Control", "ControlInput", "ControlData", "ControlLink", "ControlSelect", "ControlHTML", "ControlInt", "ControlFloat", "ControlCurrency", "ControlCheck", "ControlDate", "ControlDatetime", "ControlTable", "ControlAutocomplete", "ControlMultiSelectPills", "ControlButton", "ControlDynamicLink", "ControlText", "ControlSmallText", "ControlTextEditor"]) {
    F[name] = F[name] ?? class extends Control {}
  }
  F.QuickEntryForm = F.QuickEntryForm ?? class QuickEntryForm {
    [k: string]: Any
    constructor(doctype: string, after_insert?: Any, init_callback?: Any, doc?: Any) {
      Object.assign(this, { doctype, after_insert, init_callback, doc })
      this.setup()
    }
    setup() { return F.make_quick_entry(this.doctype, this.after_insert, this.init_callback, this.doc) }
    render_dialog() {}
    get_variant_fields() { return [] }
  }
  F.FormTour = class { init() { return Promise.resolve() } start() {} }
  F.Layout = class { [k: string]: Any; constructor(opts: Any) { Object.assign(this, opts) } make() {} refresh() {} }
  F.Dashboard = class {}
  F.States = class {}
  F.LinkSelector = class { constructor() { frappe.msgprint(__("This selector is not available in Petal yet.")) } }
  F.ItemQuickEntryForm = F.QuickEntryForm
  frappe.ui.form.Grid = Grid
  frappe.ui.form.GridRow = class {}
}

const forms = new Map<string, Form>()

/** The cached Form for a doctype (created on first open, like Desk). */
export function getForm(doctype: string): Form {
  let f = forms.get(doctype)
  if (!f) {
    f = new Form(doctype)
    forms.set(doctype, f)
    g.frappe.views.formview[doctype] = { frm: f }
  }
  return f
}

/** Legacy globals Desk form scripts still call. */
export function installLegacyFormGlobals() {
  g.refresh_field = (n: Any, docname?: string, table_field?: string) => {
    if (typeof n === "string" && docname && table_field) return g.cur_frm?.fields_dict[table_field]?.grid?.refresh()
    if (Array.isArray(n)) return n.forEach((f) => g.cur_frm?.refresh_field(f))
    g.cur_frm?.refresh_field(n)
  }
  g.refresh_many = (flist: string[]) => flist.forEach((f) => g.refresh_field(f))
  g.hide_field = (n: Any) => g.cur_frm?.toggle_display(n, false)
  g.unhide_field = (n: Any) => g.cur_frm?.toggle_display(n, true)
  g.get_field = (doctype: string, fieldname: string, docname?: string) => g.frappe.meta.get_docfield(doctype, fieldname, docname)
  g.set_field_options = (n: string, options: Any) => g.cur_frm?.set_df_property(n, "options", options)
  g.set_multiple = (dt: string, dn: string, dict: Any, table_field?: string) => {
    const d = g.locals[dt]?.[dn]
    if (!d) return
    for (const k in dict) d[k] = dict[k]
    g.refresh_field(Object.keys(dict), table_field ? dn : undefined, table_field)
  }
  g.set_value = (dt: string, dn: string, f: string, v: Any) => g.frappe.model.set_value(dt, dn, f, v)
}
