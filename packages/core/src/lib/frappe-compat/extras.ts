/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Smaller Desk APIs form scripts reach for: status indicators, the
 * address/contact panels and file uploads. Charts, tables and the scanner are
 * real (widgets.ts); the few Desk widgets Petal doesn't draw are inert
 * stand-ins so scripts that build them keep running.
 */
import { __, cstr, type Any } from "./env"
import { installWidgets } from "./widgets"
import { installDeskUtils } from "./desk-utils"
import { installPages } from "./page"

const g: Any = typeof window !== "undefined" ? window : globalThis

const esc = (s: Any) => g.frappe.utils.escape_html(cstr(s))

export function installExtras(frappe: Any, opts: { upload?: (file: File, meta: Any) => Promise<Any> } = {}) {
  // ── frappe.get_indicator (model/indicator.js) ────────────────────────────
  frappe.workflow.workflows = frappe.workflow.workflows ?? {}
  frappe.workflow.avoid_status_override = frappe.workflow.avoid_status_override ?? {}
  frappe.get_indicator = (doc: Any, doctype?: string, show_workflow_state?: boolean) => {
    if (doc.__unsaved) return [__("Not Saved"), "orange"]
    if (!doctype) doctype = doc.doctype
    const meta = frappe.get_meta(doctype)
    const settings = frappe.listview_settings[doctype!] || {}
    const is_submittable = frappe.model.is_submittable(doctype)
    const wf_field = frappe.workflow.get_state_fieldname(doctype)
    const workflow = frappe.model.get_list("Workflow", { document_type: doctype })[0]
    const without_workflow = workflow ? workflow.override_status : true
    if (wf_field && (!without_workflow || show_workflow_state) && doc[wf_field]) {
      const style = g.locals["Workflow State"]?.[doc[wf_field]]?.style
      const colour = ({ Success: "green", Warning: "orange", Danger: "red", Primary: "blue", Inverse: "black", Info: "light-blue" } as Any)[style] || "gray"
      return [__(doc[wf_field]), colour, wf_field + ",=," + doc[wf_field]]
    }
    if (is_submittable && doc.docstatus == 0 && !settings.has_indicator_for_draft) return [__("Draft"), "red", "docstatus,=,0"]
    if (is_submittable && doc.docstatus == 2 && !settings.has_indicator_for_cancelled) return [__("Cancelled"), "red", "docstatus,=,2"]
    const state = doc.status && meta?.states?.find((d: Any) => d.title === doc.status)
    if (state) return [__(doc.status), frappe.scrub(state.color).replace(/_/g, "-"), "status,=," + doc.status]
    if (settings.get_indicator) {
      try {
        const ind = settings.get_indicator(doc)
        if (ind) return ind
      } catch (e) {
        console.warn("[Petal compat] get_indicator", e)
      }
    }
    if (is_submittable && doc.docstatus == 1) return [__("Submitted"), "blue", "docstatus,=,1"]
    if (doc.status) return [__(doc.status), guessColour(doc.status), "status,=," + doc.status]
    if (frappe.meta.has_field(doctype, "enabled")) return doc.enabled ? [__("Enabled"), "blue", "enabled,=,1"] : [__("Disabled"), "grey", "enabled,=,0"]
    if (frappe.meta.has_field(doctype, "disabled")) return doc.disabled ? [__("Disabled"), "grey", "disabled,=,1"] : [__("Enabled"), "blue", "disabled,=,0"]
  }
  frappe.utils.guess_colour = guessColour

  // ── frappe.contacts (contacts/address_and_contact.js) ────────────────────
  frappe.provide("frappe.contacts")
  frappe.contacts.render_address_and_contact = (frm: Any) => {
    const onload = frm.doc.__onload ?? {}
    const link = (dt: string) => `/form/${encodeURIComponent(dt)}/new`
    const addrs = (onload.addr_list ?? []) as Any[]
    const contacts = (onload.contact_list ?? []) as Any[]
    const addrHtml = addrs.map((a) =>
      `<div class="petal-compat-card"><a href="/form/Address/${encodeURIComponent(a.name)}"><b>${esc(a.address_title || a.name)}</b></a>${a.is_primary_address ? ` <span class="petal-compat-pill">${__("Primary")}</span>` : ""}<div>${a.display ?? ""}</div></div>`).join("")
    const contactHtml = contacts.map((c) =>
      `<div class="petal-compat-card"><a href="/form/Contact/${encodeURIComponent(c.name)}"><b>${esc([c.first_name, c.last_name].filter(Boolean).join(" ") || c.name)}</b></a>${c.is_primary_contact ? ` <span class="petal-compat-pill">${__("Primary")}</span>` : ""}<div>${esc(c.email_id ?? "")}${c.phone ? " · " + esc(c.phone) : ""}${c.mobile_no ? " · " + esc(c.mobile_no) : ""}</div></div>`).join("")
    const set = (field: string, html: string) => frm.fields_dict[field]?.$wrapper.html(html)
    frappe.dynamic_link = { doc: frm.doc, fieldname: "name", doctype: frm.doctype }
    set("address_html", (addrHtml || `<p class="petal-compat-muted">${__("No address added yet.")}</p>`) + `<a class="petal-compat-btn" data-new="Address" href="${link("Address")}">${__("New Address")}</a>`)
    set("contact_html", (contactHtml || `<p class="petal-compat-muted">${__("No contacts added yet.")}</p>`) + `<a class="petal-compat-btn" data-new="Contact" href="${link("Contact")}">${__("New Contact")}</a>`)
    // "New Address/Contact" pre-links the new record to this party, as Desk does.
    for (const field of ["address_html", "contact_html"]) {
      frm.fields_dict[field]?.$wrapper.off("click.petal").on("click.petal", "[data-new]", (e: Any) => {
        e.preventDefault()
        const dt = g.$(e.currentTarget).attr("data-new")
        frappe.route_options = { links: undefined }
        void frappe.model.with_doctype(dt).then(() => {
          const doc = frappe.model.get_new_doc(dt)
          const row = frappe.model.add_child(doc, "Dynamic Link", "links")
          row.link_doctype = frm.doctype
          row.link_name = frm.doc.name
          frappe.set_route("Form", dt, doc.name)
        })
      })
    }
  }
  frappe.contacts.clear_address_and_contact = (frm: Any) => {
    frm.fields_dict.address_html?.$wrapper.html("")
    frm.fields_dict.contact_html?.$wrapper.html("")
  }

  // ── File uploads ─────────────────────────────────────────────────────────
  frappe.ui.FileUploader = class FileUploader {
    [k: string]: Any
    constructor(opts: Any = {}) {
      Object.assign(this, opts)
      if (typeof document === "undefined" || !opts.upload_now) {
        if (typeof document === "undefined") return
      }
      const input = document.createElement("input")
      input.type = "file"
      if (opts.allow_multiple) input.multiple = true
      if (opts.restrictions?.allowed_file_types?.length) input.accept = opts.restrictions.allowed_file_types.join(",")
      input.onchange = async () => {
        for (const file of Array.from(input.files ?? [])) {
          try {
            const doc = await opts_upload(opts, file)
            if (opts.on_success) opts.on_success(doc)
          } catch (e: Any) {
            frappe.msgprint({ title: __("Upload failed"), message: esc(e?.message ?? e), indicator: "red" })
          }
        }
      }
      input.click()
    }
  }
  const opts_upload = async (o: Any, file: File) => {
    if (!opts.upload) throw new Error(__("Uploads are not available"))
    return opts.upload(file, { doctype: o.doctype, docname: o.docname, fieldname: o.fieldname, folder: o.folder, is_private: o.make_attachments_public ? 0 : 1 })
  }

  // ── Inert widget stand-ins ───────────────────────────────────────────────
  const inert = (label: string) =>
    class {
      [k: string]: Any
      constructor(...args: Any[]) {
        this.args = args
        this.wrapper = g.$(typeof document !== "undefined" ? document.createElement("div") : {})
        this.datamanager = { rows: [], getRows: () => [], data: [] }
        this.rowmanager = { checkMap: [], getCheckedRows: () => [], checkAll() {} }
        this.options = { ...(args[1] ?? {}) }
        this.style = { setStyle() {} }
        console.info(`[Petal compat] ${label} is not rendered in Petal`)
      }
      refresh() {}
      update() {}
      destroy() {}
      render() {}
      draw() {}
      export() {}
      unmount() {}
      setDimensions() {}
      updateDataset() {}
      addDataPoint() {}
      removeDataPoint() {}
      getColumns() { return [] }
      getRows() { return [] }
      getCheckedRows() { return [] }
      on() {}
    }
  // Bootstrap's jQuery plugins, which Desk pages call on their own markup.
  for (const plugin of ["tab", "modal", "tooltip", "popover", "dropdown", "collapse", "alert", "button", "carousel", "scrollspy", "toast"]) {
    if (!g.$.fn[plugin]) g.$.fn[plugin] = function (this: Any) { return this }
  }
  installDeskUtils(frappe)
  installPages(frappe)
  installWidgets(frappe)
  // Replaced by Frappe's own tree.js once it loads (index.ts).
  frappe.ui.Tree = frappe.ui.Tree ?? inert("frappe.ui.Tree")
  frappe.ui.Capture = frappe.ui.Capture ?? inert("frappe.ui.Capture")
  frappe.ui.GroupBy = frappe.ui.GroupBy ?? inert("GroupBy")
  frappe.ui.FilterGroup = frappe.ui.FilterGroup ?? class {
    [k: string]: Any
    constructor(opts: Any) { Object.assign(this, opts); this.filters = [] }
    get_filters() { return this.filters }
    add_filters_to_filter_group(f: Any[]) { this.filters = f }
    clear_filters() { this.filters = [] }
  }
  frappe.ui.form.ControlGeolocation = frappe.ui.form.ControlGeolocation ?? class {}
  frappe.ui.keys = frappe.ui.keys ?? { add_shortcut() {}, on() {}, off() {} }
  frappe.ui.toolbar = frappe.ui.toolbar ?? { clear_cache() {}, show_about() {} }
  frappe.ui.get_print_settings = (_pdf: boolean, callback: Any) => callback && callback({})
  frappe.phone_call = frappe.phone_call ?? { handler: null }
  frappe.views.trees = frappe.views.trees ?? {}
  frappe.query_report = frappe.query_report ?? { get_filter_value: () => null, set_filter_value() {}, refresh() {}, toggle_filter_display() {}, filters: [] }
  frappe.ui.form.SuccessAction = class { show() {} }
}

function guessColour(text: string): string {
  const colors: Record<string, string[]> = {
    green: ["Paid", "Completed", "Delivered", "Active", "Enabled", "Approved", "Closed", "Received", "Submitted", "Success"],
    red: ["Overdue", "Cancelled", "Rejected", "Failed", "Expired", "Lost", "Disabled"],
    orange: ["Unpaid", "Pending", "Draft", "Open", "To Bill", "To Deliver", "To Receive", "Partly Paid", "Partially Delivered", "Hold", "On Hold"],
  }
  for (const [c, words] of Object.entries(colors)) if (words.some((w) => text?.includes(w))) return c
  return "gray"
}
