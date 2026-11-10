/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Desk pages (frappe.pages[name], served at /app/<name> in Desk) on Petal.
 *
 * Like frappe.views.Page: fetch the Page doc, put its HTML in a wrapper
 * element, run its script, then call on_page_load / on_page_show / refresh.
 * frappe.ui.make_app_page returns an AppPage whose header (title, indicator,
 * buttons, menu) Petal draws in React; its form bar and body are real DOM
 * inside the wrapper, which the page route adopts as-is, so jQuery code that
 * draws into page.main / page.body works unchanged. Header fields
 * (page.add_field) are Desk's own controls.
 */
import { __, type Any } from "./env"
import { loadDeskControls } from "./desk-controls"

const g: Any = typeof window !== "undefined" ? window : globalThis

export type PageAction = { label: string; fn: () => unknown; group?: string }

const mk = (cls = "", tag = "div") => {
  const el = document.createElement(tag)
  if (cls) el.className = cls
  return el
}

export class AppPage {
  [k: string]: Any
  title = ""
  title_sub = ""
  indicator: { label: string; color: string } | null = null
  primary: PageAction | null = null
  secondary: PageAction | null = null
  innerButtons: PageAction[] = []
  menuItems: PageAction[] = []
  actionItems: PageAction[] = []
  innerMessage = ""
  fields_dict: Record<string, Any> = {}
  private listeners = new Set<() => void>()

  constructor(opts: Any = {}) {
    Object.assign(this, { single_column: !!opts.single_column, card_layout: !!opts.card_layout })
    this.title = opts.title ?? ""
    const parent: HTMLElement = opts.parent?.jquery ? opts.parent[0] : opts.parent
    // Desk's page structure (page.js), minus the header Petal draws itself:
    // .page-body > .page-content > .row.layout-main > (.layout-side-section,
    // .layout-main-section-wrapper > .layout-main-section), page_form first in main.
    const root = mk("page-container petal-desk-page petal-desk")
    root.innerHTML = `<div class="page-body"><div class="page-wrapper"><div class="page-content">
      <div class="row layout-main">
        <div class="layout-side-section hidden"></div>
        <div class="col layout-main-section-wrapper"><div class="layout-main-section"></div><div class="layout-footer hidden"></div></div>
      </div></div></div></div>`
    this.$wrapper = g.$(root)
    this.wrapper = this.$wrapper
    this.container = this.$wrapper
    this.body = this.main = this.$wrapper.find(".layout-main-section")
    this.sidebar = this.$wrapper.find(".layout-side-section")
    this.footer = this.$wrapper.find(".layout-footer")
    this.page_form = g.$(mk("page-form row hide")).prependTo(this.main)
    this.$title_area = g.$(mk("title-area"))
    this.inner_toolbar = g.$(mk("custom-actions"))
    if (parent) parent.appendChild(root)
    this.btn_primary = g.$(mk("", "button"))
    this.btn_secondary = g.$(mk("", "button"))
    this.menu = g.$(mk())
    this.actions = g.$(mk())
    if (parent) (parent as Any).page = this
  }

  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  private emit() { for (const fn of this.listeners) fn() }
  private add<T extends PageAction>(list: "innerButtons" | "menuItems" | "actionItems", item: T) {
    this[list] = [...(this[list] as PageAction[]).filter((a) => !(a.label === item.label && a.group === item.group)), item]
    this.emit()
    return g.$(mk("", "button")).text(item.label)
  }

  // Title & indicator
  set_title(title: string) { this.title = String(title ?? ""); this.emit() }
  set_title_sub(txt: string) { this.title_sub = String(txt ?? ""); this.emit() }
  get_title_area() { return this.$title_area }
  set_indicator(label: string, color = "gray") { this.indicator = label ? { label: String(label), color } : null; this.emit() }
  clear_indicator() { this.indicator = null; this.emit() }

  // Primary / secondary actions
  set_primary_action(label: string, click: () => unknown) { this.primary = { label: __(label), fn: click }; this.emit(); return this.btn_primary }
  clear_primary_action() { this.primary = null; this.emit() }
  set_secondary_action(label: string, click: () => unknown) { this.secondary = { label: __(label), fn: click }; this.emit(); return this.btn_secondary }
  clear_secondary_action() { this.secondary = null; this.emit() }
  set_action(label: string, click: () => unknown) { return this.set_primary_action(label, click) }

  // Buttons and menus
  add_inner_button(label: string, action: () => unknown, group?: string) {
    return this.add("innerButtons", { label: __(label), fn: action, ...(group ? { group: __(group) } : {}) })
  }
  remove_inner_button(label: string, group?: string) {
    this.innerButtons = this.innerButtons.filter((b) => !(b.label === __(label) && (group === undefined || b.group === __(group))))
    this.emit()
  }
  change_inner_button_type() {}
  clear_inner_toolbar() { this.innerButtons = []; this.emit() }
  add_button(label: string, click: () => unknown) { return this.add_inner_button(label, click) }
  add_menu_item(label: string, click: () => unknown) { return this.add("menuItems", { label: __(label), fn: click }) }
  add_dropdown_item({ label, click, parent }: Any) { return parent ? this.add_inner_button(label, click, parent) : this.add_menu_item(label, click) }
  clear_menu() { this.menuItems = []; this.emit() }
  add_action_item(label: string, click: () => unknown) { return this.add("actionItems", { label: __(label), fn: click }) }
  clear_actions_menu() { this.actionItems = []; this.emit() }
  add_inner_message(message: string) { this.innerMessage = String(message ?? ""); this.emit(); return g.$(mk()) }
  clear_inner_message() { this.innerMessage = ""; this.emit() }
  clear_user_actions() {}
  add_sidebar_item(label: string, action: () => unknown) { return this.add_menu_item(label, action) }
  setup_sidebar_toggle() {}
  show_form() { this.page_form.removeClass("hide hidden") }
  hide_form() { this.page_form.addClass("hide") }

  // Header fields: Desk's own controls (page.js add_field)
  add_field(df: Any, parent?: Any) {
    this.show_form()
    if (!df.placeholder) df.placeholder = df.label
    df.input_class = "input-xs"
    const f = g.frappe.ui.form.make_control({
      df, parent: parent || this.page_form, only_input: df.fieldtype !== "Check",
    })
    f.refresh()
    g.$(f.wrapper).addClass("col-md-2 petal-page-field").attr("title", __(df.label))
    if (df.fieldtype === "HTML") return
    if (!f.$input) f.make_input()
    f.$input.attr("placeholder", __(df.label)).attr("aria-label", __(df.label))
    if (df["default"]) f.set_input(df["default"])
    this.fields_dict[df.fieldname || df.label] = f
    return f
  }
  // page.js: these return the input element, not the control
  add_select(label: string, options: Any) {
    const f = this.add_field({ label, fieldtype: "Select" })
    return f.$wrapper.find("select").empty().add_options(options)
  }
  add_data(label: string) { return this.add_field({ label, fieldtype: "Data" }).$wrapper.find("input").attr("placeholder", label) }
  add_date(label: string, date?: string) { return this.add_field({ label, fieldtype: "Date", default: date }).$wrapper.find("input").attr("placeholder", label) }
  add_check(label: string) {
    return g.$(`<div class='checkbox'><label><input type='checkbox'>${g.frappe.utils.escape_html(label)}</label></div>`).appendTo(this.page_form).find("input")
  }
  add_break() { this.page_form.append('<div class="clearfix invisible-xs"></div>') }
  get_form_values() {
    const out: Any = {}
    for (const [k, f] of Object.entries(this.fields_dict)) out[k] = (f as Any).get_value?.()
    return out
  }
  clear_fields() { this.page_form.empty(); this.fields_dict = {} }
}

export type DeskPage = {
  name: string
  wrapper: HTMLElement
  /** The AppPage the script made (set by make_app_page), once it has. */
  page: () => AppPage | null
  show: () => void
}

/** Load and start a Desk page into a fresh wrapper element. */
export async function openDeskPage(name: string): Promise<DeskPage> {
  const frappe = g.frappe
  // Pages' header fields are Desk controls; load them before the script runs.
  await loadDeskControls().catch((e) => console.warn("[Petal compat] Desk controls", e))
  let doc = g.locals.Page?.[name]
  if (!doc?.script && !doc?.__script) {
    const r = await frappe.call({ method: "frappe.desk.desk_page.getpage", args: { name } })
    const docs: Any[] = Array.isArray(r?.docs) ? r.docs : r?.docs ? [r.docs] : []
    for (const d of docs) if (!d.doctype) d.doctype = "Page"
    frappe.model.sync(docs)
    doc = g.locals.Page?.[name] ?? docs[0]
  }
  if (!doc) throw new Error(__("Page {0} not found", [name]))

  const wrapper = document.createElement("div") as Any
  wrapper.className = "petal-desk petal-desk-page-root"
  wrapper.id = "page-" + name
  wrapper.page_name = doc.name
  wrapper.label = doc.title || doc.name
  frappe.pages[name] = wrapper
  if (doc.content) wrapper.innerHTML = doc.content
  try {
    frappe.dom.eval(doc.__script || doc.script || "")
  } catch (e) {
    console.error(`[Petal compat] page ${name}`, e)
  }
  frappe.dom.set_style(doc.style || "")
  const trigger = (event: string) => {
    try { wrapper[event]?.(wrapper) } catch (e) { console.error(`[Petal compat] page ${name} ${event}`, e) }
  }
  trigger("on_page_load")
  return {
    name,
    wrapper,
    page: () => (wrapper.page instanceof AppPage ? wrapper.page : null),
    show: () => {
      g.cur_frm = null
      trigger("on_page_show")
      trigger("refresh")
    },
  }
}

export function installPages(frappe: Any) {
  frappe.pages = frappe.pages ?? {}
  frappe.ui.make_app_page = (opts: Any) => new AppPage(opts)
  frappe.ui.Page = AppPage
  frappe.container = frappe.container ?? {
    add_page: (name: string) => { const el = document.createElement("div"); frappe.pages[name] = el; return el },
    change_to: (name: string) => frappe.set_route(name),
    page: null,
  }
  frappe.breadcrumbs = frappe.breadcrumbs ?? { add() {}, clear() {}, update() {} }
  frappe.show_not_found = (page_name: string) => frappe.msgprint({ title: __("Not found"), message: __("Page {0} not found", [page_name]) })
  frappe.show_not_permitted = (page_name: string) => frappe.msgprint({ title: __("Not permitted"), message: __("You are not permitted to view {0}", [page_name]), indicator: "red" })
  frappe.show_message_page = (opts: Any) => frappe.msgprint({ message: opts.message, title: opts.title })
}
