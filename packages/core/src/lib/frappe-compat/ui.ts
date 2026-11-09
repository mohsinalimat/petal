/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * frappe.msgprint / throw / confirm / prompt / show_alert / ui.Dialog /
 * ui.FieldGroup / ui.form.MultiSelectDialog — the logic half. Entries are
 * pushed into a tiny external store that <CompatHost /> renders with React.
 *
 * Elements scripts poke at ($wrapper, $body, HTML fields) are real DOM nodes
 * created up front; React adopts them into the rendered dialog, so jQuery code
 * like `d.fields_dict.preview.$wrapper.html(...)` works unchanged.
 */
import { __, cint, cstr, type Any } from "./env"
import { whenConnected } from "./widgets"

const g: Any = typeof window !== "undefined" ? window : globalThis

// ── Store ─────────────────────────────────────────────────────────────────────
export type Indicator = string

export type MsgEntry = { kind: "msg"; id: number; title: string; indicator: Indicator; messages: string[]; primary?: { label: string; action: () => void } | undefined; wide?: boolean | undefined }
export type DialogEntry = { kind: "dialog"; id: number; dialog: CompatDialog }
export type PickerEntry = { kind: "picker"; id: number; picker: Any }
export type Entry = MsgEntry | DialogEntry | PickerEntry

type State = { entries: Entry[]; freeze: { count: number; message: string }; progress: { title: string; count: number; total: number; description?: string } | null; version: number }

let state: State = { entries: [], freeze: { count: 0, message: "" }, progress: null, version: 0 }
const listeners = new Set<() => void>()
let nextId = 1

function emit() {
  state = { ...state, version: state.version + 1 }
  listeners.forEach((l) => l())
}

export const uiStore = {
  getState: () => state,
  subscribe(l: () => void) {
    listeners.add(l)
    return () => { listeners.delete(l) }
  },
  remove(id: number) {
    const entry = state.entries.find((e) => e.id === id)
    state.entries = state.entries.filter((e) => e.id !== id)
    emit()
    return entry
  },
  bump: emit,
}

let toastImpl: (variant: "success" | "error" | "warning" | "info", title: string, detail?: string) => void = (v, t) => console.info(`[${v}]`, t)
export function setToast(fn: typeof toastImpl) { toastImpl = fn }

function strip(html: string): string {
  if (typeof document === "undefined") return html.replace(/<[^>]*>/g, "")
  const d = document.createElement("div")
  d.innerHTML = html
  return d.textContent?.trim() ?? ""
}

// ── Field defaults (ui/field_group.js) ───────────────────────────────────────
function defaultFor(df: Any): Any {
  const frappe = g.frappe
  let v = df.default
  if (v === undefined || v === null) return df.fieldtype === "Table" ? [] : undefined
  if (typeof v === "string") {
    if (v.toLowerCase() === "today" && ["Date", "Datetime"].includes(df.fieldtype)) v = frappe.datetime.get_today()
    else if (v.toLowerCase() === "now") v = df.fieldtype === "Time" ? frappe.datetime.now_time() : frappe.datetime.now_datetime()
    else if (v === "__user") v = frappe.session.user
  }
  if (["Check", "Int"].includes(df.fieldtype)) v = cint(v)
  return v
}

/** One input in a dialog — the subset of frappe.ui.form.Control scripts use. */
export class DialogField {
  df: Any
  layout: Any
  value: Any
  wrapper: HTMLElement
  $wrapper: Any
  input: HTMLElement
  $input: Any
  grid: Any
  last_value: Any

  constructor(df: Any, layout: Any) {
    this.df = df
    this.layout = layout
    this.wrapper = typeof document !== "undefined" ? document.createElement("div") : ({} as HTMLElement)
    this.$wrapper = g.$(this.wrapper)
    this.input = typeof document !== "undefined" ? document.createElement("input") : ({} as HTMLElement)
    this.$input = g.$(this.input)
    if (df.fieldtype === "HTML" && df.options && typeof document !== "undefined") this.wrapper.innerHTML = df.options
    this.value = defaultFor(df)
    if (df.fieldtype === "Table") {
      if (!Array.isArray(df.data)) df.data = Array.isArray(this.value) ? this.value : []
      const field = this
      this.grid = {
        df,
        get data() { return field.df.data },
        set data(v: Any) { field.df.data = v },
        refresh() { layout.refresh() },
        get_selected_children() { return (field.df.data ?? []).filter((r: Any) => r.__checked) },
        get_selected() { return this.get_selected_children().map((r: Any) => r.name) },
        add_new_row(_idx?: number, _cb?: Any, _show?: boolean, values?: Any) {
          const row = { idx: field.df.data.length + 1, name: "row " + (field.df.data.length + 1), ...(values ?? {}) }
          field.df.data.push(row)
          layout.refresh()
          return row
        },
        get_field(fieldname: string) {
          const cdf = (df.fields ?? []).find((f: Any) => f.fieldname === fieldname) ?? {}
          return { df: cdf, get_query: undefined }
        },
        update_docfield_property(fieldname: string, prop: string, value: Any) {
          const cdf = (df.fields ?? []).find((f: Any) => f.fieldname === fieldname)
          if (cdf) { cdf[prop] = value; layout.refresh() }
        },
        toggle_reqd(fieldname: string, reqd: Any) { this.update_docfield_property(fieldname, "reqd", reqd ? 1 : 0) },
        toggle_enable(fieldname: string, enable: Any) { this.update_docfield_property(fieldname, "read_only", enable ? 0 : 1) },
        set_column_disp(fieldname: string, show: Any) { this.update_docfield_property(fieldname, "hidden", show ? 0 : 1) },
        set_multiple_add() {},
        wrapper: g.$(document.createElement("div")),
        grid_rows: [],
        cannot_add_rows: false,
      }
    }
  }

  get_value() {
    if (this.df.fieldtype === "Table") return this.df.data
    return this.value
  }
  get_input_value() { return this.get_value() }

  set_value(value: Any) {
    if (this.df.fieldtype === "Table") {
      this.df.data = Array.isArray(value) ? value : []
      this.layout.refresh()
      return Promise.resolve()
    }
    this.value = value
    this.layout.refresh()
    return this.fire_change()
  }
  set_input(value: Any) { this.value = value; this.layout.refresh() }

  /** Called by the UI on user input. */
  user_set(value: Any) {
    this.value = value
    this.layout.refresh()
    void this.fire_change()
  }

  fire_change(): Promise<void> {
    if (this.last_value === this.value) return Promise.resolve()
    this.last_value = this.value
    const fn = this.df.onchange || this.df.change
    if (fn) {
      try {
        const r = fn.apply(this, [])
        if (r && r.then) return r.then(() => undefined)
      } catch (e) {
        console.error("[Petal compat] dialog onchange", e)
      }
    }
    return Promise.resolve()
  }

  refresh() { this.layout.refresh() }
  refresh_input() { this.layout.refresh() }
  set_label(label: string) { this.df.label = label; this.layout.refresh() }
  set_description(d: string) { this.df.description = d; this.layout.refresh() }
  toggle(show: boolean) { this.df.hidden = show ? 0 : 1; this.layout.refresh() }
  set_focus() {}
  set_mandatory() {}
  set_invalid() {}
  set_data(data: Any) { if (this.df.fieldtype === "Table") this.set_value(data); else this.df.options = data; this.layout.refresh() }
  get_query: Any
}

/** frappe.ui.FieldGroup — fields without a modal. */
export class CompatFieldGroup {
  fields: Any[]
  fields_dict: Record<string, DialogField> = {}
  fields_list: DialogField[] = []
  body: HTMLElement
  $body: Any
  wrapper: HTMLElement
  $wrapper: Any
  parent: Any
  version = 0
  ;[key: string]: Any

  constructor(opts: Any = {}) {
    Object.assign(this, opts)
    this.fields = (opts.fields ?? []).filter(Boolean)
    this.wrapper = typeof document !== "undefined" ? document.createElement("div") : ({} as HTMLElement)
    this.$wrapper = g.$(this.wrapper)
    this.body = typeof document !== "undefined" ? document.createElement("div") : ({} as HTMLElement)
    this.$body = g.$(this.body)
    for (const df of this.fields) this.add_field(df)
  }

  add_field(df: Any) {
    const f = new DialogField(df, this)
    this.fields_list.push(f)
    if (df.fieldname) this.fields_dict[df.fieldname] = f
    return f
  }

  make() { this.refresh() }
  refresh() { this.version++; uiStore.bump() }
  get_field(fieldname: string) { return this.fields_dict[fieldname] }
  get_input(fieldname: string) { return this.fields_dict[fieldname]?.$input }
  has_field(fieldname: string) { return !!this.fields_dict[fieldname] }
  get_value(key: string) { return this.fields_dict[key]?.get_value() }
  set_value(key: string, val: Any) { return this.fields_dict[key]?.set_value(val) ?? Promise.resolve() }
  set_input(key: string, val: Any) { this.fields_dict[key]?.set_input(val) }
  set_values(dict: Any) {
    const tasks = Object.entries(dict ?? {}).map(([k, v]) => () => this.set_value(k, v))
    return g.frappe.run_serially(tasks)
  }
  clear() {
    for (const f of this.fields_list) f.value = defaultFor(f.df)
    this.refresh()
  }
  set_df_property(fieldname: string, prop: string, value: Any) {
    const f = this.fields_dict[fieldname]
    if (f) { f.df[prop] = value; this.refresh() }
  }
  focus_on_first_input() {}

  get_values(ignore_errors?: boolean) {
    const ret: Any = {}
    const errors: string[] = []
    for (const f of this.fields_list) {
      const df = f.df
      if (!df.fieldname || ["Section Break", "Column Break", "HTML", "Button", "Heading"].includes(df.fieldtype)) continue
      let v = f.get_value()
      if (df.fieldtype === "Table") v = (v ?? []).filter((r: Any) => Object.keys(r).some((k) => !["idx", "name", "__checked"].includes(k) && r[k] !== "" && r[k] != null))
      const visible = !cint(df.hidden) && this.evalDepends(df.depends_on)
      const reqd = cint(df.reqd) || (df.mandatory_depends_on && this.evalDepends(df.mandatory_depends_on))
      const empty = v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)
      if (reqd && visible && empty) errors.push(__(df.label))
      if (!empty) ret[df.fieldname] = v
    }
    if (errors.length && !ignore_errors) {
      g.frappe.msgprint({ title: __("Missing Values Required"), message: __("Following fields have missing values:") + "<br><br><ul><li>" + errors.join("<li>") + "</ul>", indicator: "orange" })
      return null
    }
    return ret
  }

  evalDepends(expr: Any): boolean {
    if (!expr) return true
    const doc = this.get_values_raw()
    try {
      if (typeof expr === "function") return !!expr(doc)
      if (typeof expr === "string" && expr.startsWith("eval:")) return !!new Function("doc", `return (${expr.slice(5)})`)(doc)
      return !!doc[expr]
    } catch {
      return true
    }
  }

  get_values_raw() {
    const out: Any = {}
    for (const f of this.fields_list) if (f.df.fieldname) out[f.df.fieldname] = f.get_value()
    return out
  }
}

/** frappe.ui.Dialog */
export class CompatDialog extends CompatFieldGroup {
  title = ""
  display = false
  entryId: number | null = null
  primary_action_label: string | undefined
  secondary_action_label: string | undefined
  primary_action: Any
  secondary_action: Any
  primary_action_fulfilled = false
  primary_disabled = false
  size: string | undefined
  indicator: string | undefined
  message: string | null = null
  custom_actions: Array<{ label: string; action: Any }> = []
  static_backdrop = false
  no_cancel_flag = false
  header: Any
  standard_actions: Any
  modal_body: Any
  confirm_dialog = false
  onhide: Any

  constructor(opts: Any = {}, onhide?: Any) {
    super(opts)
    if (onhide) this.onhide = onhide
    this.title = opts.title ?? ""
    const mk = () => (typeof document !== "undefined" ? document.createElement("div") : ({} as HTMLElement))
    this.header = g.$(mk())
    this.header.append('<span class="indicator"></span>')
    this.standard_actions = g.$(mk())
    this.modal_body = this.$body
  }

  show() {
    this.display = true
    this.primary_action_fulfilled = false
    if (this.entryId == null) {
      this.entryId = nextId++
      state.entries = [...state.entries, { kind: "dialog", id: this.entryId, dialog: this }]
    }
    g.cur_dialog = this
    emit()
    this.onshow?.()
    // Desk fires on_page_show once the modal is on screen ("shown.bs.modal");
    // scripts use it to draw into the dialog's fields.
    if (this.on_page_show) {
      const el = this.$body?.[0]
      const run = () => { if (this.display) try { this.on_page_show() } catch (e) { console.error(e) } }
      if (el && typeof el.isConnected === "boolean") whenConnected(el, run)
      else setTimeout(run, 0)
    }
    return this
  }

  hide() {
    if (this.entryId == null) return
    const id = this.entryId
    this.entryId = null
    this.display = false
    uiStore.remove(id)
    if (g.cur_dialog === this) g.cur_dialog = null
    try { this.onhide && this.onhide() } catch (e) { console.error(e) }
    try { this.on_hide && this.on_hide() } catch (e) { console.error(e) }
  }

  cancel() { this.hide() }
  no_cancel() { this.no_cancel_flag = true; emit() }
  set_title(t: string) { this.title = t; emit() }
  set_message(text: string) { this.message = text; emit() }
  clear_message() { this.message = null; emit() }
  set_indicator() {}
  set_primary_action(label: string, click: Any) {
    this.primary_action_label = label
    this.primary_action = click
    emit()
    return this.get_primary_btn()
  }
  set_secondary_action(click: Any) { this.secondary_action = click; emit() }
  set_secondary_action_label(label: string) { this.secondary_action_label = label; emit() }
  disable_primary_action() { this.primary_disabled = true; emit() }
  enable_primary_action() { this.primary_disabled = false; emit() }
  add_custom_action(label: string, action: Any) { this.custom_actions.push({ label, action }); emit() }
  get_primary_btn() { return g.$(document.createElement("button")) }
  get_secondary_btn() { return g.$(document.createElement("button")) }
  get_close_btn() { return g.$(document.createElement("button")) }
  get_minimize_btn() { return g.$(document.createElement("button")) }
  toggle_minimize() {}
  hide_scrollbar() {}
  set_modal_size() {}

  /** UI: primary button pressed. Mirrors Dialog.set_primary_action's click wrapper. */
  run_primary() {
    if (!this.primary_action) return this.hide()
    this.primary_action_fulfilled = true
    const values = this.get_values()
    if (!values) return
    try {
      const r = this.primary_action.call(this, values)
      if (r && r.catch) r.catch((e: Any) => console.error(e))
    } catch (e) {
      console.error("[Petal compat] dialog primary action", e)
    }
  }

  run_secondary() {
    if (this.secondary_action) {
      try { this.secondary_action.call(this) } catch (e) { console.error(e) }
    } else {
      this.hide()
    }
  }
}

// ── messages.js ──────────────────────────────────────────────────────────────
export function installUI(frappe: Any) {
  frappe.ui = frappe.ui ?? {}
  frappe.ui.Dialog = CompatDialog
  frappe.ui.FieldGroup = CompatFieldGroup
  frappe.ui.form = frappe.ui.form ?? {}
  frappe.ui.form.make_control = (opts: Any) => {
    const fg = new CompatFieldGroup({ fields: [opts.df] })
    const f = fg.fields_list[0]!
    if (opts.parent) try { g.$(opts.parent).append(f.wrapper) } catch { /* noop */ }
    return f
  }

  frappe.msgprint = (msg: Any, title?: string) => {
    if (!msg) return
    let data: Any
    if (msg && typeof msg === "object" && !Array.isArray(msg)) data = { ...msg }
    else if (typeof msg === "string" && msg.substr(0, 1) === "{") { try { data = JSON.parse(msg) } catch { data = { message: msg, title } } }
    else data = { message: msg, title }

    if (Array.isArray(data.message) && !data.as_list && !data.as_table) {
      let messages = data.message.map((m: Any) => (typeof m === "string" ? safeParse(m) : m))
      const exceptions = messages.filter((m: Any) => m && m.raise_exception)
      if (exceptions.length) messages = exceptions
      messages.forEach((m: Any) => frappe.msgprint(m))
      return
    }
    if (data.as_list) data.message = `<ul style="padding-left:20px">${data.message.map((m: Any) => `<li>${m}</li>`).join("")}</ul>`
    if (data.as_table) data.message = `<table>${data.message.map((row: Any[]) => `<tr>${row.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`
    if (!data.indicator) data.indicator = "blue"
    if (data.alert || data.toast) return frappe.show_alert(data)

    const message = cstr(data.message)
    const open = [...state.entries].reverse().find((e): e is MsgEntry => e.kind === "msg")
    let primary: MsgEntry["primary"]
    if (data.primary_action) {
      const pa = data.primary_action
      let action = pa.action
      if (pa.server_action) action = () => frappe.call({ method: pa.server_action, args: { args: pa.args }, callback() { if (pa.hide_on_success) frappe.hide_msgprint() } })
      if (pa.client_action) {
        let obj: Any = g
        for (const part of String(pa.client_action).split(".")) obj = obj?.[part]
        action = () => { if (typeof obj === "function") obj(pa.args) }
      }
      primary = { label: pa.label ?? __("Proceed"), action }
    }
    if (open) {
      open.messages = [...open.messages, message]
      if (data.title) open.title = data.title
      if (data.indicator && data.indicator !== "blue") open.indicator = data.indicator
      if (primary) open.primary = primary
      emit()
    } else {
      state.entries = [...state.entries, { kind: "msg", id: nextId++, title: data.title || __("Message"), indicator: data.indicator, messages: [message], primary, wide: data.wide }]
      emit()
    }
    frappe.msg_dialog = { hide: () => frappe.hide_msgprint(), clear() {}, msg_area: g.$(document.createElement("div")), $wrapper: g.$(document.createElement("div")), set_primary_action() {}, display: true }
    return frappe.msg_dialog
  }

  frappe.hide_msgprint = () => {
    state.entries = state.entries.filter((e) => e.kind !== "msg")
    emit()
  }
  frappe.update_msgprint = (html: string) => {
    const open = state.entries.find((e): e is MsgEntry => e.kind === "msg")
    if (open) { open.messages = [html]; emit() } else frappe.msgprint(html)
  }

  frappe.throw = (msg: Any) => {
    if (typeof msg === "string") msg = { message: msg, title: __("Error") }
    if (!msg.indicator) msg.indicator = "red"
    frappe.msgprint(msg)
    throw new Error(strip(cstr(msg.message)))
  }

  frappe.confirm = (message: string, confirm_action?: Any, reject_action?: Any) => {
    const d: Any = new CompatDialog({
      title: __("Confirm"),
      primary_action_label: __("Yes"),
      primary_action: () => { d.hide(); confirm_action && confirm_action() },
      secondary_action_label: __("No"),
      secondary_action: () => d.hide(),
    })
    d.message = message
    d.confirm_dialog = true
    if (reject_action) d.onhide = () => { if (!d.primary_action_fulfilled) reject_action() }
    d.show()
    return d
  }

  frappe.warn = (title: string, message_html: string, proceed_action?: Any, primary_label?: string) => {
    const d: Any = new CompatDialog({
      title, indicator: "red", primary_action_label: primary_label ?? __("Proceed"),
      primary_action: () => { d.hide(); proceed_action && proceed_action() },
      secondary_action_label: __("Cancel"), secondary_action: () => d.hide(),
    })
    d.message = message_html
    d.show()
    return d
  }

  frappe.prompt = (fields: Any, callback: Any, title?: string, primary_label?: string) => {
    if (typeof fields === "string") fields = [{ label: fields, fieldname: "value", fieldtype: "Data", reqd: 1 }]
    if (!Array.isArray(fields)) fields = [fields]
    const d: Any = new CompatDialog({
      fields, title: title || __("Enter Value"),
      primary_action_label: primary_label || __("Submit"),
      primary_action: (values: Any) => { d.hide(); callback && callback(values) },
    })
    d.show()
    return d
  }

  frappe.show_alert = (message: Any, _seconds?: number) => {
    if (typeof message === "string") message = { message }
    const text = strip(cstr(message.message ?? message.body ?? ""))
    const sub = message.subtitle ? strip(cstr(message.subtitle)) : undefined
    const ind = message.indicator
    const variant = ind === "green" || ind === "success" ? "success"
      : ind === "red" || ind === "error" ? "error"
      : ind === "orange" || ind === "yellow" || ind === "warning" ? "warning" : "info"
    toastImpl(variant, text, sub)
  }
  g.msgprint = frappe.msgprint
  g.show_alert = frappe.show_alert

  frappe.show_progress = (title: string, count: number, total = 100, description?: string, hide_on_completion = false) => {
    state.progress = { title, count, total, ...(description ? { description } : {}) }
    emit()
    if (hide_on_completion && count >= total) setTimeout(() => frappe.hide_progress(), 500)
    return { hide: () => frappe.hide_progress() }
  }
  frappe.hide_progress = () => { state.progress = null; emit() }

  frappe.dom = frappe.dom ?? {}
  Object.assign(frappe.dom, {
    freeze(msg?: string) {
      state.freeze = { count: state.freeze.count + 1, message: msg ?? state.freeze.message }
      frappe.dom.freeze_count = state.freeze.count
      emit()
    },
    unfreeze() {
      state.freeze = { count: Math.max(0, state.freeze.count - 1), message: state.freeze.count > 1 ? state.freeze.message : "" }
      frappe.dom.freeze_count = state.freeze.count
      emit()
    },
    freeze_count: 0,
    set_style(css: string) {
      if (typeof document === "undefined" || !css) return
      const el = document.createElement("style")
      el.textContent = css
      document.head.appendChild(el)
    },
    eval(code: string) { if (code) new Function(code)() },
    is_touchscreen: () => false,
    scroll_to_bottom() {},
    id_count: 0,
    get_unique_id() { return "unique-" + frappe.dom.id_count++ },
    // dom.js remove_script_and_style
    remove_script_and_style(txt: string) {
      if (typeof DOMParser === "undefined") return txt
      const doc = new DOMParser().parseFromString(txt, "text/html")
      let found = !!doc.head.innerHTML
      for (const tag of ["script", "style", "noscript", "title", "meta", "base", "head"]) {
        for (const el of Array.from(doc.body.getElementsByTagName(tag))) { found = true; el.remove() }
      }
      for (const el of Array.from(doc.body.getElementsByTagName("link"))) {
        if ((el.getAttribute("rel") ?? "").toLowerCase().trim() === "stylesheet") { found = true; el.remove() }
      }
      return found ? doc.body.innerHTML : txt
    },
    is_element_in_viewport(el: Any, tolerance = 0) {
      const node = el?.jquery ? el[0] : el
      if (!node?.getBoundingClientRect) return false
      const r = node.getBoundingClientRect()
      return r.top + tolerance >= 0 && r.left + tolerance >= 0
        && r.bottom - tolerance <= (window.innerHeight || document.documentElement.clientHeight)
        && r.right - tolerance <= (window.innerWidth || document.documentElement.clientWidth)
    },
    is_element_in_modal: (el: Any) => Boolean(g.$(el).parents(".modal, [role=dialog]").length),
    set_unique_id(el: Any) {
      const node = el?.jquery ? el[0] : el
      if (!node) return ""
      node.id = node.id || "petal-" + Math.random().toString(36).slice(2)
      return node.id
    },
  })

  frappe.ui.form.MultiSelectDialog = MultiSelectPicker
}

function safeParse(s: string): Any {
  try { return JSON.parse(s) } catch { return { message: s } }
}

/**
 * frappe.ui.form.MultiSelectDialog — the "Get Items From" picker used by
 * erpnext.utils.map_current_doc. The search/selection UI is native React
 * (<CompatPicker />); this class keeps the options and Desk's public surface.
 */
export class MultiSelectPicker {
  ;[key: string]: Any
  dialog: Any
  entryId: number

  constructor(opts: Any) {
    Object.assign(this, opts)
    this.setters = this.setters ?? {}
    this.entryId = nextId++
    const self = this
    this.dialog = {
      hide() { uiStore.remove(self.entryId) },
      show() {},
      get_value: (k: string) => self.values?.[k],
      fields_dict: {},
      $wrapper: g.$(document.createElement("div")),
    }
    void g.frappe.model.with_doctype(this.doctype).then(() => {
      state.entries = [...state.entries, { kind: "picker", id: this.entryId, picker: this }]
      emit()
    })
  }

  /** Setter fields as Desk builds them in get_primary_filters(). */
  get_setter_fields(): Any[] {
    const frappe = g.frappe
    if (Array.isArray(this.setters)) return this.setters
    return Object.keys(this.setters).map((setter) => {
      const df = frappe.meta.docfield_map[this.doctype]?.[setter] ?? { fieldtype: "Data", label: setter }
      return { fieldtype: df.fieldtype, label: df.label, fieldname: setter, options: df.options, default: this.setters[setter], read_only: this.read_only_setters?.includes(setter) ? 1 : 0 }
    })
  }

  get_query_result() { return typeof this.get_query === "function" ? this.get_query() ?? {} : {} }

  build_search_args(txt: string, values: Record<string, Any>, pageLength: number) {
    const q = this.get_query_result()
    const filters: Any = { ...(q.filters ?? {}) }
    const filter_fields: string[] = []
    for (const df of this.get_setter_fields()) {
      const value = values[df.fieldname]
      if (df.fieldtype === "Data" && value) filters[df.fieldname] = ["like", "%" + value + "%"]
      else { filters[df.fieldname] = value || undefined; filter_fields.push(df.fieldname) }
    }
    if (this.date_field && values.__from_date && values.__to_date) {
      filters[this.date_field] = ["between", [values.__from_date, values.__to_date]]
    }
    for (const k of Object.keys(filters)) if (filters[k] === undefined) delete filters[k]
    return { doctype: this.doctype, txt, filters, filter_fields, page_length: pageLength + 5, query: q.query ?? "", as_dict: 1 }
  }

  columns_to_show(): string[] {
    const q = this.get_query_result()
    if (q.query && this.columns) return this.columns
    return ["name", ...this.get_setter_fields().map((df: Any) => df.fieldname)]
  }

  finish(selected: string[], childNames: string[], childParents: string[], values: Record<string, Any>) {
    this.values = values
    const args: Any = { ...(this.args ?? {}) }
    for (const df of this.get_setter_fields()) if (values[df.fieldname]) args[df.fieldname] = values[df.fieldname]
    for (const df of this.data_fields ?? []) if (df.fieldname && values[df.fieldname] !== undefined) args[df.fieldname] = values[df.fieldname]
    const selections = [...new Set([...selected, ...childParents])]
    try {
      this.action(selections, { ...args, filtered_children: childNames })
    } catch (e) {
      console.error("[Petal compat] picker action", e)
    }
  }
}
