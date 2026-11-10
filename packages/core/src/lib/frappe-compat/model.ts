/* eslint-disable @typescript-eslint/no-explicit-any, no-new-func */
/**
 * frappe.model / frappe.meta / frappe.defaults / frappe.perm — ported from
 * frappe/public/js/frappe/model/{model,meta,sync,create_new}.js and defaults.js.
 * Documents live in `locals[doctype][name]`, exactly as in Desk, so form
 * scripts that read or mutate them directly keep working.
 */
import { cint, flt, provide, __, type Any } from "./env"

const g: Any = typeof window !== "undefined" ? window : globalThis

export const TABLE_FIELDS = ["Table", "Table MultiSelect"]
const NO_VALUE_TYPE = ["Section Break", "Column Break", "Tab Break", "HTML", "Table", "Table MultiSelect", "Button", "Image", "Fold", "Heading"]
const STD_FIELDS_LIST = ["name", "owner", "creation", "modified", "modified_by", "_user_tags", "_comments", "_assign", "_liked_by", "docstatus", "idx"]
const CHILD_TABLE_FIELD_LIST = ["parent", "parenttype", "parentfield"]

/** Runs functions one after another; each may return a promise. Mirrors frappe.run_serially. */
export function run_serially(tasks: Any[]): Promise<Any> {
  let result: Promise<Any> = Promise.resolve()
  for (const task of tasks) {
    if (!task) continue
    result = result.then((prev) => (typeof task === "function" ? task(prev) : task))
  }
  return result
}

export function installModel(frappe: Any) {
  const locals = g.locals

  frappe.run_serially = run_serially
  // Desk resolves these once in-flight requests settle; Petal's requests are
  // awaited by callers, so a resolved promise keeps ordering semantics.
  frappe.after_ajax = (fn?: Any) => {
    const p = frappe.request?.wait_for_pending ? frappe.request.wait_for_pending() : Promise.resolve()
    return p.then(() => fn && fn())
  }
  frappe.after_server_call = () => (frappe.request?.wait_for_pending ? frappe.request.wait_for_pending() : Promise.resolve())

  // ── defaults ──────────────────────────────────────────────────────────────
  frappe.defaults = {
    get_user_default(key: string) {
      const defaults = frappe.boot.user.defaults ?? {}
      let d = defaults[key]
      if (!d && this.is_a_user_permission_key(key)) {
        d = defaults[frappe.model.scrub(key)]
        const ud = this.get_user_permission_default(key, defaults)
        if (ud) d = ud
      }
      if (Array.isArray(d)) d = d[0]
      if (!this.in_user_permission(key, d)) return
      return d
    },
    get_user_permission_default(key: string, defaults: Any) {
      const perms = this.get_user_permissions()
      let ud = null
      for (const item of perms[key] ?? []) if (defaults[key] == item.doc) ud = item.doc
      for (const item of perms[key] ?? []) if (item.is_default) ud = item.doc
      return ud
    },
    get_user_defaults(key: string) {
      const defaults = frappe.boot.user.defaults ?? {}
      let d = defaults[key]
      if (this.is_a_user_permission_key(key)) {
        if (d && Array.isArray(d) && d.length === 1) d = d[0]
        else d = defaults[key] || defaults[frappe.model.scrub(key)]
      }
      if (!Array.isArray(d)) d = [d]
      return d
    },
    get_global_default(key: string) {
      let d = frappe.sys_defaults[key]
      if (Array.isArray(d)) d = d[0]
      return d
    },
    get_global_defaults(key: string) {
      const d = frappe.sys_defaults[key]
      return Array.isArray(d) ? d : [d]
    },
    set_user_default_local(key: string, value: Any) { frappe.boot.user.defaults[key] = value },
    // Desk (v15) has no server call for this; frappe.client.set_default isn't whitelisted.
    set_default(key: string, value: Any) {
      frappe.boot.user.defaults[key] = value
      return Promise.resolve()
    },
    get_default(key: string) {
      const defaults = frappe.boot.user.defaults ?? {}
      let value = defaults[key]
      if (this.is_a_user_permission_key(key)) {
        if (value && Array.isArray(value) && value.length === 1) value = value[0]
        else value = defaults[frappe.model.scrub(key)]
      }
      if (!this.in_user_permission(key, value)) return
      if (value) {
        try { return JSON.parse(value) } catch { return value }
      }
    },
    is_a_user_permission_key: (key: string) => key.indexOf(":") === -1 && key !== frappe.model.scrub(key),
    in_user_permission(key: string, value: Any) {
      const up = this.get_user_permissions()[frappe.model.unscrub(key)]
      if (up && up.length) return up.some((p: Any) => p.doc === value)
      return true
    },
    get_user_permissions() { return this._user_permissions || {} },
    load_user_permission_from_boot() {
      this._user_permissions = Object.assign({}, frappe.boot.user?.user_permissions ?? {})
    },
    update_user_permissions() {},
  }
  frappe.user_defaults = frappe.boot.user.defaults

  // ── meta ──────────────────────────────────────────────────────────────────
  provide("frappe.meta.docfield_map")
  provide("frappe.meta.docfield_copy")
  provide("frappe.meta.docfield_list")
  provide("frappe.meta.doctypes")
  provide("frappe.meta.precision_map")

  frappe.get_meta = (doctype: string) => (locals.DocType ? locals.DocType[doctype] : null)

  Object.assign(frappe.meta, {
    sync(doc: Any) {
      for (const df of doc.fields ?? []) frappe.meta.add_field(df)
      if (doc.__messages) Object.assign(frappe._messages, doc.__messages)
      if (doc.__print_formats) frappe.model.sync(doc.__print_formats)
      if (doc.__workflow_docs) frappe.model.sync(doc.__workflow_docs)
    },
    add_field(df: Any) {
      provide("frappe.meta.docfield_map." + df.parent)
      frappe.meta.docfield_map[df.parent][df.fieldname || df.label] = df
      if (!frappe.meta.docfield_list[df.parent]) frappe.meta.docfield_list[df.parent] = []
      if (frappe.meta.docfield_list[df.parent].some((d: Any) => d.fieldname == df.fieldname)) return
      frappe.meta.docfield_list[df.parent].push(df)
    },
    make_docfield_copy_for(doctype: string, docname: string, docfield_list: Any = null) {
      const c = frappe.meta.docfield_copy
      if (!c[doctype]) c[doctype] = {}
      if (!c[doctype][docname]) c[doctype][docname] = {}
      docfield_list = docfield_list || frappe.meta.docfield_list[doctype] || []
      for (const df of docfield_list) c[doctype][docname][df.fieldname || df.label] = { ...df }
    },
    get_field(doctype: string, fieldname: string, name?: string) {
      let out = frappe.meta.get_docfield(doctype, fieldname, name)
      if (!out) out = frappe.model.std_fields.find((d: Any) => d.fieldname === fieldname)
      return out
    },
    get_docfield(doctype: string, fieldname: string, name?: string) {
      const fd = frappe.meta.get_docfield_copy(doctype, name)
      return fd ? fd[fieldname] : null
    },
    set_formatter(doctype: string, fieldname: string, name: string, formatter: Any) {
      const df = frappe.meta.get_docfield(doctype, fieldname, name)
      if (df) df.formatter = formatter
    },
    set_indicator_formatter() {},
    get_docfields(doctype: string, name?: string, filters?: Any, docfield_list: Any = null) {
      const map = frappe.meta.get_docfield_copy(doctype, name, docfield_list)
      let docfields = frappe.meta.sort_docfields(map)
      if (filters) docfields = frappe.utils.filter_dict(docfields, filters)
      return docfields
    },
    get_linked_fields(doctype: string) {
      return (frappe.get_meta(doctype)?.fields ?? []).filter((d: Any) => d.fieldtype == "Link").map((d: Any) => d.options)
    },
    sort_docfields(docs: Any) {
      return Object.values(docs ?? {}).sort((a: Any, b: Any) => a.idx - b.idx)
    },
    get_docfield_copy(doctype: string, name?: string, docfield_list: Any = null) {
      if (!name) return frappe.meta.docfield_map[doctype]
      if (!(frappe.meta.docfield_copy[doctype] && frappe.meta.docfield_copy[doctype][name])) {
        frappe.meta.make_docfield_copy_for(doctype, name, docfield_list)
      }
      return frappe.meta.docfield_copy[doctype][name]
    },
    get_fieldnames(doctype: string, _name: string, filters: Any) {
      return frappe.utils.filter_dict(frappe.meta.docfield_map[doctype], filters).map((df: Any) => df.fieldname)
    },
    has_field(dt: string, fn: string) {
      const m = frappe.meta.docfield_map[dt]
      return m && m[fn]
    },
    get_table_fields(dt: string) {
      return (frappe.meta.docfield_list[dt] ?? []).filter((d: Any) => TABLE_FIELDS.includes(d.fieldtype))
    },
    get_doctype_for_field(doctype: string, key: string) {
      if (STD_FIELDS_LIST.includes(key) || frappe.meta.has_field(doctype, key)) return doctype
      for (const d of frappe.meta.get_table_fields(doctype)) {
        if (frappe.meta.has_field(d.options, key) || CHILD_TABLE_FIELD_LIST.includes(key)) return d.options
      }
      return null
    },
    get_parentfield(parent_dt: string, child_dt: string) {
      const df = (frappe.get_meta(parent_dt)?.fields ?? []).filter(
        (d: Any) => TABLE_FIELDS.includes(d.fieldtype) && d.options === child_dt)
      if (!df.length) throw "parentfield not found for " + parent_dt + ", " + child_dt
      return df[0].fieldname
    },
    get_label(dt: string, fn: string, dn?: string) {
      const standard: Record<string, string> = {
        name: __("ID"), creation: __("Created On"), docstatus: __("Document Status"), idx: __("Index"),
        modified: __("Last Updated On"), modified_by: __("Last Updated By"), owner: __("Created By"),
      }
      if (standard[fn]) return standard[fn]
      const df = frappe.meta.get_docfield(dt, fn, dn)
      return (df ? df.label : "") || fn
    },
    get_print_formats(doctype: string) {
      const list = ["Standard"]
      for (const d of frappe.model.get_list("Print Format", { doc_type: doctype })) if (!list.includes(d.name)) list.push(d.name)
      const def = locals.DocType[doctype]?.default_print_format
      if (def && def !== "Standard") { list.splice(list.indexOf(def), 1); list.unshift(def) }
      return list
    },
    get_field_currency(df: Any, doc?: Any) {
      let currency = frappe.boot.sysdefaults.currency || "USD"
      if (!doc && g.cur_frm) doc = g.cur_frm.doc
      if (df && df.options) {
        if (df.options.indexOf(":") != -1) {
          const options = df.options.split(":")
          if (options.length == 3) {
            let docname = doc ? doc[options[1]] : null
            if (!docname && g.cur_frm) docname = g.cur_frm.doc[options[1]]
            if (!docname) docname = frappe.defaults.get_user_default(options[1])
            currency = frappe.model.get_value(options[0], docname, options[2])
              || frappe.model.get_value(":" + options[0], docname, options[2]) || currency
          }
        } else if (doc && doc[df.options]) {
          currency = doc[df.options]
        } else if (g.cur_frm && g.cur_frm.doc[df.options]) {
          currency = g.cur_frm.doc[df.options]
        }
      }
      return currency
    },
    get_field_precision(df: Any, _doc?: Any) {
      if (df && df.precision) return cint(df.precision)
      if (df && df.fieldtype === "Currency") {
        let p = cint(frappe.defaults.get_default("currency_precision"))
        if (!p) p = g.get_number_format_info(g.get_number_format()).precision
        return p
      }
      return cint(frappe.defaults.get_default("float_precision")) || 3
    },
  })

  // ── model ─────────────────────────────────────────────────────────────────
  provide("frappe.model")
  Object.assign(frappe.model, {
    no_value_type: NO_VALUE_TYPE,
    layout_fields: ["Section Break", "Column Break", "Tab Break", "Fold"],
    std_fields_list: STD_FIELDS_LIST,
    child_table_field_list: CHILD_TABLE_FIELD_LIST,
    core_doctypes_list: ["DocType", "DocField", "DocPerm", "User", "Role", "Has Role", "Page", "Module Def", "Print Format", "Report", "Customize Form", "Customize Form Field", "Property Setter", "Custom Field", "Client Script"],
    restricted_fields: ["name", "parent", "creation", "modified", "modified_by", "parentfield", "parenttype", "file_list", "flags", "docstatus"],
    html_fieldtypes: ["Text Editor", "Text", "Small Text", "Long Text", "HTML Editor", "Markdown Editor", "Code"],
    std_fields: [
      { fieldname: "name", fieldtype: "Link", label: __("ID") },
      { fieldname: "owner", fieldtype: "Link", label: __("Created By"), options: "User" },
      { fieldname: "idx", fieldtype: "Int", label: __("Index") },
      { fieldname: "creation", fieldtype: "Datetime", label: __("Created On") },
      { fieldname: "modified", fieldtype: "Datetime", label: __("Last Updated On") },
      { fieldname: "modified_by", fieldtype: "Link", label: __("Last Updated By"), options: "User" },
      { fieldname: "docstatus", fieldtype: "Int", label: __("Document Status") },
    ],
    numeric_fieldtypes: ["Int", "Float", "Currency", "Percent", "Duration"],
    table_fields: TABLE_FIELDS,
    new_names: {},
    events: {},
    user_settings: {},
    docinfo: {},

    is_value_type(fieldtype: Any) {
      if (typeof fieldtype == "object") fieldtype = fieldtype.fieldtype
      return NO_VALUE_TYPE.indexOf(fieldtype) === -1
    },
    is_non_std_field: (fieldname: string) => ![...STD_FIELDS_LIST, ...CHILD_TABLE_FIELD_LIST].includes(fieldname),
    is_numeric_field(fieldtype: Any) {
      if (!fieldtype) return
      if (typeof fieldtype === "object") fieldtype = fieldtype.fieldtype
      return frappe.model.numeric_fieldtypes.includes(fieldtype)
    },
    scrub: (txt: string) => (txt || "").replace(/ /g, "_").toLowerCase(),
    unscrub: (txt: string) => frappe.unscrub(txt),

    // Doctype loading goes through the loader (installed later), which also
    // evaluates list/tree scripts; this is the fallback when it isn't.
    with_doctype(doctype: string, callback?: Any) {
      if (locals.DocType[doctype]) {
        callback && callback()
        return Promise.resolve()
      }
      return frappe.call({ method: "frappe.desk.form.load.getdoctype", args: { doctype, with_parent: 1 } })
        .then((r: Any) => {
          if (r?.docs) for (const d of r.docs) if (d.doctype === "DocType" || d.fields) { d.doctype = "DocType"; frappe.model.sync(d) }
          frappe.model.init_doctype(doctype)
          callback && callback(r)
        })
    },
    init_doctype(doctype: string) {
      const meta = locals.DocType[doctype]
      if (!meta || meta.__petal_inited) return
      meta.__petal_inited = true
      for (const key of ["__list_js", "__custom_list_js", "__calendar_js", "__map_js", "__tree_js"]) {
        if (!meta[key]) continue
        try { new Function(meta[key])() } catch (e) { console.warn(`[Petal compat] ${doctype} ${key}`, e) }
      }
      if (meta.__templates) Object.assign(frappe.templates, meta.__templates)
    },
    with_doc(doctype: string, name?: string, callback?: Any) {
      return new Promise((resolve) => {
        if (!name) name = doctype
        if (locals[doctype] && locals[doctype][name] && frappe.model.get_docinfo(doctype, name)) {
          callback && callback(name)
          resolve(frappe.get_doc(doctype, name))
          return
        }
        frappe.call({
          method: "frappe.desk.form.load.getdoc",
          args: { doctype, name },
          callback(r: Any) {
            callback && callback(name, r)
            resolve(frappe.get_doc(doctype, name))
          },
        })
      })
    },
    get_docinfo: (doctype: string, name: string) => (frappe.model.docinfo[doctype] && frappe.model.docinfo[doctype][name]) || null,
    set_docinfo(doctype: string, name: string, key: string, value: Any) {
      if (frappe.model.docinfo[doctype]?.[name]) frappe.model.docinfo[doctype][name][key] = value
    },
    get_shared: (doctype: string, name: string) => frappe.model.get_docinfo(doctype, name)?.shared ?? [],
    get_server_module_name(doctype: string) {
      const dt = frappe.model.scrub(doctype)
      const module = frappe.model.scrub(locals.DocType[doctype].module)
      const app = frappe.boot.module_app?.[module]
      return app + "." + module + ".doctype." + dt + "." + dt
    },

    can_create: (dt: string) => (frappe.boot.user.can_create ?? []).indexOf(dt) !== -1,
    can_select: (dt: string) => (frappe.boot.user.can_select ?? []).indexOf(dt) !== -1,
    can_read: (dt: string) => (frappe.boot.user.can_read ?? []).indexOf(dt) !== -1,
    can_write: (dt: string) => (frappe.boot.user.can_write ?? []).indexOf(dt) !== -1,
    can_get_report: (dt: string) => (frappe.boot.user.can_get_report ?? []).indexOf(dt) !== -1,
    can_delete: (dt: string) => !!dt && (frappe.boot.user.can_delete ?? []).indexOf(dt) !== -1,
    can_submit: (dt: string) => !!dt && (frappe.boot.user.can_submit ?? []).indexOf(dt) !== -1,
    can_cancel: (dt: string) => !!dt && (frappe.boot.user.can_cancel ?? []).indexOf(dt) !== -1,
    can_import: (dt: string) => (frappe.user_roles ?? []).includes("System Manager") || (frappe.boot.user.can_import ?? []).indexOf(dt) !== -1,
    can_export: (dt: string) => (frappe.user_roles ?? []).includes("System Manager") || (frappe.boot.user.can_export ?? []).indexOf(dt) !== -1,
    can_print: (dt: string, frm?: Any) => (frm ? frm.perm?.[0]?.print === 1 : (frappe.boot.user.can_print ?? []).indexOf(dt) !== -1),
    can_email: (dt: string, frm?: Any) => (frm ? frm.perm?.[0]?.email === 1 : (frappe.boot.user.can_email ?? []).indexOf(dt) !== -1),
    can_share: (dt: string, frm?: Any) => (frm ? frm.perm?.[0]?.share === 1 : (frappe.boot.user.can_share ?? []).indexOf(dt) !== -1),
    has_workflow: (dt: string) => frappe.model.get_list("Workflow", { document_type: dt, is_active: 1 }).length,
    is_submittable: (dt: string) => !!dt && locals.DocType[dt] && locals.DocType[dt].is_submittable,
    is_table: (dt: string) => !!dt && locals.DocType[dt] && locals.DocType[dt].istable,
    is_single: (dt: string) => !!dt && ((frappe.boot.single_types ?? []).indexOf(dt) != -1 || !!locals.DocType[dt]?.issingle),
    is_tree: (dt: string) => !!dt && locals.DocType[dt] && locals.DocType[dt].is_tree,
    is_fresh: (doc: Any) => doc && doc.__last_sync_on && Date.now() - doc.__last_sync_on < 5000,

    has_value(dt: string, dn: string, fn: string) {
      const val = locals[dt] && locals[dt][dn] && locals[dt][dn][fn]
      const df = frappe.meta.get_docfield(dt, fn, dn)
      if (df && TABLE_FIELDS.includes(df.fieldtype)) {
        return Object.values(locals[df.options] || {}).some(
          (d: Any) => d.parent == dn && d.parenttype == dt && d.parentfield == df.fieldname)
      }
      return !g.is_null(val)
    },
    get_list(doctype: string, filters?: Any) {
      const docsdict = locals[doctype] || locals[":" + doctype] || {}
      if (!Object.keys(docsdict).length) return []
      return frappe.utils.filter_dict(docsdict, filters)
    },
    get_value(doctype: string, filters: Any, fieldname: string, callback?: Any) {
      if (callback) {
        return frappe.call({
          method: "frappe.client.get_value",
          args: { doctype, fieldname, filters },
          callback: (r: Any) => { if (!r.exc) callback(r.message) },
        })
      }
      if (["number", "string"].includes(typeof filters) && locals[doctype] && locals[doctype][filters]) {
        return locals[doctype][filters][fieldname]
      }
      const l = frappe.model.get_list(doctype, filters)
      return l.length && l[0] ? l[0][fieldname] : null
    },

    set_value(doctype: Any, docname: Any, fieldname: Any, value?: Any, fieldtype?: string, skip_dirty_trigger = false) {
      let doc: Any
      if (doctype && typeof doctype === "object") {
        // set_value(doc, fieldname, value)
        doc = doctype
        value = fieldname
        fieldname = docname
      } else {
        doc = locals[doctype] && locals[doctype][docname]
      }
      let to_update = fieldname
      const tasks: Any[] = []
      if (!to_update || typeof to_update !== "object") to_update = { [fieldname]: value }
      for (const [key, v] of Object.entries(to_update)) {
        if (doc && doc[key] !== v) {
          if (doc.__unedited && !(!doc[key] && !v)) doc.__unedited = false
          doc[key] = v
          tasks.push(() => frappe.model.trigger(key, v, doc, skip_dirty_trigger))
        } else if (["Link", "Dynamic Link"].includes(fieldtype ?? "") && doc) {
          tasks.push(() => frappe.model.trigger(key, v, doc, skip_dirty_trigger))
        }
      }
      return run_serially(tasks)
    },
    on(doctype: string, fieldname: string, fn: Any) {
      provide("frappe.model.events." + doctype)
      if (!frappe.model.events[doctype][fieldname]) frappe.model.events[doctype][fieldname] = []
      frappe.model.events[doctype][fieldname].push(fn)
    },
    trigger(fieldname: string, value: Any, doc: Any, skip_dirty_trigger = false) {
      const tasks: Any[] = []
      const enqueue = (events: Any[] | undefined) => {
        for (const fn of events ?? []) {
          if (!fn) continue
          tasks.push(() => {
            const rv = fn(fieldname, value, doc, skip_dirty_trigger)
            return rv && rv.then ? rv : frappe.after_server_call()
          })
        }
      }
      const ev = frappe.model.events[doc.doctype]
      if (ev) { enqueue(ev[fieldname]); enqueue(ev["*"]) }
      return run_serially(tasks)
    },

    get_doc(doctype: string, name?: Any) {
      if (!name) name = doctype
      if (name && typeof name === "object") {
        const docs = frappe.model.get_list(doctype, name)
        return docs && docs.length ? docs[0] : null
      }
      return locals[doctype] ? locals[doctype][name] : null
    },
    get_children(doctype: Any, parent: Any, parentfield?: Any, filters?: Any) {
      let doc: Any
      if (doctype && typeof doctype === "object") {
        doc = doctype
        filters = parentfield
        parentfield = parent
      } else {
        doc = frappe.get_doc(doctype, parent)
      }
      const children = doc?.[parentfield] || []
      return filters ? frappe.utils.filter_dict(children, filters) : children
    },
    clear_table(doc: Any, parentfield: string) {
      for (const d of doc[parentfield] || []) if (locals[d.doctype]) delete locals[d.doctype][d.name]
      doc[parentfield] = []
    },
    remove_from_locals(doctype: string, name: string) { frappe.model.clear_doc(doctype, name) },
    clear_doc(doctype: Any, name?: string) {
      if (doctype && typeof doctype === "object") { name = doctype.name; doctype = doctype.doctype }
      const doc = locals[doctype] && locals[doctype][name!]
      if (!doc) return
      delete locals[doctype][name!]
      if (doc.parenttype && doc.parent) {
        const parent_doc = locals[doc.parenttype]?.[doc.parent]
        if (parent_doc && Array.isArray(parent_doc[doc.parentfield])) {
          const newlist: Any[] = []
          let idx = 1
          for (const d of parent_doc[doc.parentfield]) {
            if (d.name != name) { newlist.push(d); d.idx = idx++ }
          }
          parent_doc[doc.parentfield] = newlist
        }
      }
    },
    get_no_copy_list(doctype: string) {
      const list = ["name", "amended_from", "amendment_date", "cancel_reason"]
      for (const df of frappe.get_meta(doctype)?.fields ?? []) if (cint(df.no_copy)) list.push(df.fieldname)
      return list
    },
    round_floats_in(doc: Any, fieldnames?: string[]) {
      if (!doc) return
      if (!fieldnames) {
        fieldnames = frappe.meta.get_fieldnames(doc.doctype, doc.parent, { fieldtype: ["in", ["Currency", "Float"]] })
      }
      for (const fn of fieldnames!) doc[fn] = flt(doc[fn], g.precision(fn, doc))
    },
    validate_missing(doc: Any, fieldname: string) {
      if (!doc[fieldname]) {
        frappe.throw(__("Please specify") + ": " + __(frappe.meta.get_label(doc.doctype, fieldname, doc.parent || doc.name)))
      }
    },
    get_all_docs(doc: Any) {
      const all = [doc]
      for (const key in doc) {
        if (Array.isArray(doc[key]) && !key.startsWith("_")) for (const d of doc[key]) if (d && typeof d === "object") all.push(d)
      }
      return all
    },
    get_full_column_name: (fieldname: string, doctype: string) =>
      fieldname.includes("`tab") ? fieldname : "`tab" + doctype + "`.`" + fieldname + "`",

    // ── create_new.js ──────────────────────────────────────────────────────
    get_new_name: (doctype: string) =>
      `new-${doctype}-${frappe.utils.get_random(10)}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
    get_new_doc(doctype: string, parent_doc?: Any, parentfield?: string, with_mandatory_children?: boolean) {
      provide("locals." + doctype)
      const doc: Any = {
        docstatus: 0, doctype, name: frappe.model.get_new_name(doctype),
        __islocal: 1, __unsaved: 1, owner: frappe.session.user,
      }
      frappe.model.set_default_values(doc, parent_doc)
      if (parent_doc) {
        Object.assign(doc, { parent: parent_doc.name, parentfield, parenttype: parent_doc.doctype })
        if (!parent_doc[parentfield!]) parent_doc[parentfield!] = []
        doc.idx = parent_doc[parentfield!].length + 1
        parent_doc[parentfield!].push(doc)
      } else {
        provide("frappe.model.docinfo." + doctype + "." + doc.name)
      }
      frappe.model.add_to_locals(doc)
      if (with_mandatory_children) frappe.model.create_mandatory_children(doc)
      if (!parent_doc) doc.__run_link_triggers = 1

      if (frappe.route_options && frappe.route_options.name_field) {
        const meta = frappe.get_meta(doctype)
        if (meta?.autoname && meta.autoname.indexOf("field:") !== -1) doc[meta.autoname.substr(6)] = frappe.route_options.name_field
        else if (meta?.autoname === "prompt") doc.__newname = frappe.route_options.name_field
        else if (meta?.title_field) doc[meta.title_field] = frappe.route_options.name_field
        delete frappe.route_options.name_field
      }
      if (frappe.route_options && !doc.parent) {
        for (const [fieldname, value] of Object.entries(frappe.route_options)) {
          const df = frappe.meta.has_field(doctype, fieldname)
          if (df && !df.no_copy) doc[fieldname] = value
        }
        frappe.route_options = null
      }
      return doc
    },
    make_new_doc_and_get_name: (doctype: string, with_mandatory_children?: boolean) =>
      frappe.model.get_new_doc(doctype, null, null, with_mandatory_children).name,
    set_default_values(doc: Any, parent_doc?: Any) {
      const docfields = frappe.meta.get_docfields(doc.doctype)
      const updated: string[] = []
      const no_default = NO_VALUE_TYPE.filter((ft) => !TABLE_FIELDS.includes(ft))
      for (const f of docfields) {
        if (no_default.includes(f.fieldtype) || doc[f.fieldname] != null || f.no_default) continue
        let v = frappe.model.get_default_value(f, doc, parent_doc)
        if (v) {
          if (["Int", "Check"].includes(f.fieldtype)) v = cint(v)
          else if (["Currency", "Float"].includes(f.fieldtype)) v = flt(v)
          doc[f.fieldname] = v
          updated.push(f.fieldname)
        } else if (f.fieldtype == "Select" && f.options && typeof f.options === "string" && !["[Select]", "Loading..."].includes(f.options)) {
          doc[f.fieldname] = f.options.split("\n")[0]
        }
      }
      return updated
    },
    create_mandatory_children(doc: Any) {
      const meta = frappe.get_meta(doc.doctype)
      if (meta && meta.istable) return
      for (const df of frappe.meta.get_docfields(doc.doctype)) {
        if (df.fieldtype === "Table" && df.reqd) frappe.model.add_child(doc, df.fieldname)
      }
    },
    get_default_value(df: Any, doc: Any, parent_doc?: Any) {
      let user_default: Any = ""
      const user_permissions = frappe.defaults.get_user_permissions()
      let allowed_records: Any[] = []
      let default_doc: Any = null
      let value: Any = null
      if (user_permissions && user_permissions[df.options]) {
        const perms = (user_permissions[df.options] as Any[]).filter(
          (p) => !p.applicable_for || p.applicable_for === doc.doctype)
        allowed_records = perms.map((p) => p.doc)
        default_doc = perms.find((p) => p.is_default)?.doc ?? (perms.length === 1 ? perms[0].doc : null)
      }
      const meta = frappe.get_meta(doc.doctype)
      const has_user_permissions = df.fieldtype === "Link" && Object.keys(user_permissions).length
        && df.ignore_user_permissions != 1 && allowed_records.length

      if (df.fieldtype === "Link" && df.options !== "User") {
        if (has_user_permissions && default_doc) {
          value = default_doc
        } else {
          if (!df.ignore_user_permissions) {
            const uds = frappe.defaults.get_user_defaults(df.options)
            if (uds && uds.length === 1) user_default = uds[0]
          }
          if (!user_default) user_default = frappe.defaults.get_user_default(df.fieldname)
          if (!user_default && df.remember_last_selected_value && frappe.boot.user.last_selected_values) {
            user_default = frappe.boot.user.last_selected_values[df.options]
          }
          if (user_default && (!has_user_permissions || allowed_records.includes(user_default))) value = user_default
        }
      }

      if (!value || df["default"]) {
        const default_val = String(df["default"])
        if (default_val == "__user" || default_val.toLowerCase() == "user") value = frappe.session.user
        else if (default_val == "user_fullname") value = frappe.session.user_fullname
        else if (default_val == "Today") value = frappe.datetime.get_today()
        else if ((default_val || "").toLowerCase() === "now") {
          value = df.fieldtype == "Time" ? frappe.datetime.now_time() : frappe.datetime.system_datetime()
        } else if (default_val[0] === ":") {
          const boot_doc = frappe.model.get_default_from_boot_docs(df, doc, parent_doc)
          if (!has_user_permissions || allowed_records.includes(boot_doc)) value = boot_doc
        } else if (df.fieldname === meta?.title_field) {
          value = ""
        } else if (df["default"] !== undefined && df["default"] !== null) {
          if (df.fieldtype !== "Link" || df.options === "User" || !has_user_permissions || allowed_records.includes(df.default)) {
            value = df["default"]
          }
        }
      } else if (df.fieldtype == "Time") {
        value = frappe.datetime.now_time()
      }
      if (TABLE_FIELDS.includes(df.fieldtype)) value = []
      df.__default_value = value
      return value
    },
    get_default_from_boot_docs(df: Any, _doc: Any, parent_doc?: Any) {
      if (frappe.model.get_list(df["default"]).length > 0) {
        const ref_fieldname = df["default"].slice(1).toLowerCase().replace(" ", "_")
        const ref_value = parent_doc ? parent_doc[ref_fieldname] : frappe.defaults.get_user_default(ref_fieldname)
        const ref_doc = ref_value ? frappe.get_doc(df["default"], ref_value) : null
        if (ref_doc && ref_doc[df.fieldname]) return ref_doc[df.fieldname]
      }
    },
    add_child(parent_doc: Any, doctype: string, parentfield?: string, idx?: number) {
      if (parentfield === undefined) {
        parentfield = doctype
        doctype = frappe.meta.get_field(parent_doc.doctype, parentfield).options
      }
      const newIdx = idx ? idx - 0.1 : (parent_doc[parentfield!] || []).length + 1
      const child = frappe.model.get_new_doc(doctype, parent_doc, parentfield)
      child.idx = newIdx
      if (newIdx !== cint(newIdx)) {
        const sorted = parent_doc[parentfield!].sort((a: Any, b: Any) => a.idx - b.idx)
        sorted.forEach((d: Any, i: number) => { d.idx = i + 1 })
      }
      if (g.cur_frm && g.cur_frm.doc == parent_doc) g.cur_frm.dirty()
      return child
    },
    copy_doc(doc: Any, from_amend?: boolean, parent_doc?: Any, parentfield?: string) {
      const no_copy = ["name", "amended_from", "amendment_date", "cancel_reason"]
      const newdoc = frappe.model.get_new_doc(doc.doctype, parent_doc, parentfield)
      for (const key in doc) {
        const df = frappe.meta.get_docfield(doc.doctype, key)
        if (df && key.substring(0, 2) !== "__" && !no_copy.includes(key) && !(!from_amend && cint(df.no_copy) == 1) && df.fieldtype !== "Password") {
          if (TABLE_FIELDS.includes(df.fieldtype)) {
            for (const d of doc[key] || []) frappe.model.copy_doc(d, from_amend, newdoc, df.fieldname)
          } else {
            newdoc[key] = doc[key]
          }
        }
      }
      Object.assign(newdoc, {
        __islocal: 1, docstatus: 0, owner: frappe.session.user, creation: "",
        modified_by: frappe.session.user, modified: "", lft: null, rgt: null,
      })
      if (from_amend && parent_doc) newdoc._amended_from = doc.name
      return newdoc
    },
    open_mapped_doc(opts: Any) {
      if (opts.frm && opts.frm.doc.__unsaved) {
        frappe.throw(__("You have unsaved changes in this form. Please save before you continue."))
      } else if (!opts.source_name && opts.frm) {
        opts.source_name = opts.frm.doc.name
      } else if (!opts.frm && !opts.source_name) {
        opts.source_name = null
      }
      return frappe.call({
        type: "POST",
        method: "frappe.model.mapper.make_mapped_doc",
        args: {
          method: opts.method, source_name: opts.source_name, args: opts.args || null,
          selected_children: opts.frm ? opts.frm.get_selected() : null,
        },
        freeze: true,
        freeze_message: opts.freeze_message || "",
        callback(r: Any) {
          if (!r.exc) {
            frappe.model.sync(r.message)
            if (opts.run_link_triggers) frappe.get_doc(r.message.doctype, r.message.name).__run_link_triggers = true
            frappe.set_route("Form", r.message.doctype, r.message.name)
          }
        },
      })
    },

    // ── sync.js ────────────────────────────────────────────────────────────
    sync(r: Any) {
      if (!r) return []
      if (!r.docs && !r.docinfo) r = { docs: r }
      if (r.docs && !Array.isArray(r.docs)) r.docs = [r.docs]
      if (r.docs) {
        r.docs.forEach((d: Any, i: number) => {
          if (!d || typeof d !== "object" || !d.doctype) return
          if (locals[d.doctype] && locals[d.doctype][d.name]) frappe.model.update_in_locals(d)
          else frappe.model.add_to_locals(d)
          d.__last_sync_on = Date.now()
          if (d.doctype === "DocType") frappe.meta.sync(d)
          if (d.localname) frappe.model.rename_after_save(d, i)
        })
      }
      frappe.model.sync_docinfo(r)
      return r.docs
    },
    rename_after_save(d: Any, i: number) {
      frappe.model.new_names[d.localname] = d.name
      g.$(document).trigger("rename", [d.doctype, d.localname, d.name])
      delete locals[d.doctype][d.localname]
      if (i === 0 && frappe.model.docinfo[d.doctype]) {
        frappe.model.docinfo[d.doctype][d.name] = frappe.model.docinfo[d.doctype][d.localname]
        frappe.model.docinfo[d.doctype][d.localname] = undefined
      }
    },
    sync_docinfo(r: Any) {
      if (r.docinfo) {
        const { doctype, name } = r.docinfo
        if (!frappe.model.docinfo[doctype]) frappe.model.docinfo[doctype] = {}
        frappe.model.docinfo[doctype][name] = r.docinfo
        Object.assign(frappe.boot.user_info, r.docinfo.user_info ?? {})
      }
      return r.docs
    },
    add_to_locals(doc: Any) {
      if (!locals[doc.doctype]) locals[doc.doctype] = {}
      if (!doc.name && doc.__islocal) {
        doc.name = frappe.model.get_new_name(doc.doctype)
        if (!doc.parentfield) provide("frappe.model.docinfo." + doc.doctype + "." + doc.name)
      }
      locals[doc.doctype][doc.name] = doc
      const meta = frappe.get_meta(doc.doctype)
      const is_table = meta ? meta.istable : doc.parentfield
      if (!is_table) {
        for (const i in doc) {
          if (i.startsWith("__")) continue
          const value = doc[i]
          if (Array.isArray(value)) {
            for (const d of value) {
              if (d && typeof d == "object" && d.doctype) {
                if (!d.parent) d.parent = doc.name
                frappe.model.add_to_locals(d)
              }
            }
          }
        }
      }
    },
    update_in_locals(doc: Any) {
      const local_doc = locals[doc.doctype][doc.name]
      const clear_keys = (source: Any, target: Any) => {
        for (const key of Object.keys(target)) if (source[key] == undefined) delete target[key]
      }
      for (const fieldname in doc) {
        const df = frappe.meta.get_field(doc.doctype, fieldname)
        if (df && TABLE_FIELDS.includes(df.fieldtype)) {
          if (!Array.isArray(doc[fieldname])) doc[fieldname] = []
          if (!Array.isArray(local_doc[fieldname])) local_doc[fieldname] = []
          for (let i = 0; i < doc[fieldname].length; i++) {
            const d = doc[fieldname][i]
            const local_d = local_doc[fieldname][i]
            if (local_d) {
              if (!locals[d.doctype]) locals[d.doctype] = {}
              if (!d.name) d.name = frappe.model.get_new_name(doc.doctype)
              if (!locals[d.doctype][d.name]) {
                const old_name = local_d.name
                delete locals[d.doctype][old_name]
                locals[d.doctype][d.name] = local_d
                const dc = frappe.meta.docfield_copy[d.doctype]
                if (dc?.[old_name]) { dc[d.name] = dc[old_name]; delete dc[old_name] }
              }
              Object.assign(local_d, d)
              clear_keys(d, local_d)
            } else {
              local_doc[fieldname].push(d)
              if (!d.parent) d.parent = doc.name
              frappe.model.add_to_locals(d)
            }
          }
          if (local_doc[fieldname].length > doc[fieldname].length) {
            for (let i = doc[fieldname].length; i < local_doc[fieldname].length; i++) {
              const d = local_doc[fieldname][i]
              if (locals[d.doctype]?.[d.name]) delete locals[d.doctype][d.name]
            }
            local_doc[fieldname].length = doc[fieldname].length
          }
        } else {
          local_doc[fieldname] = doc[fieldname]
        }
      }
      if ((local_doc?.on_paste_event || local_doc?.__islocal) && local_doc?.__newname) doc.__newname = local_doc.__newname
      clear_keys(doc, local_doc)
    },
  })

  // legacy aliases
  frappe.get_doc = frappe.model.get_doc
  frappe.get_children = frappe.model.get_children
  frappe.get_list = frappe.model.get_list
  frappe.new_doc = (doctype: string, opts?: Any) => {
    if (opts && typeof opts === "object") frappe.route_options = opts
    return frappe.model.with_doctype(doctype).then(() => {
      const doc = frappe.model.get_new_doc(doctype, null, null, true)
      return frappe.set_route("Form", doctype, doc.name)
    })
  }
  g.getchildren = (doctype: string, parent: string, parentfield: string) =>
    Object.values(locals[doctype] || {}).filter((d: Any) => d.parent === parent && d.parentfield === parentfield)

  // ── perm (subset of frappe/model/perm.js, using boot permissions) ──────────
  frappe.perm = {
    rights: ["select", "read", "write", "create", "delete", "submit", "cancel", "amend", "report", "import", "export", "print", "email", "share"],
    doctype_perm: {},
    has_perm(doctype: string, permlevel = 0, ptype = "read", doc?: Any) {
      const perms = frappe.perm.get_perm(doctype, doc)
      return !!(perms[permlevel] && perms[permlevel][ptype])
    },
    get_perm(doctype: string, doc?: Any) {
      const meta = frappe.get_meta(doctype)
      const docPerms = doc && frappe.model.get_docinfo(doctype, doc.name)?.permissions
      if (docPerms) return [docPerms]
      const roles = frappe.user_roles ?? []
      const levels: Any[] = [{}]
      if (roles.includes("Administrator")) {
        for (const r of frappe.perm.rights) levels[0][r] = 1
        return levels
      }
      for (const p of meta?.permissions ?? []) {
        if (!roles.includes(p.role)) continue
        const lvl = cint(p.permlevel)
        levels[lvl] = levels[lvl] ?? {}
        for (const r of frappe.perm.rights) if (p[r]) levels[lvl][r] = 1
      }
      return levels
    },
    is_visible: () => true,
    // perm.js get_field_display_status, without per-permlevel rules: hidden →
    // None; read-only fields, or anything but allow_on_submit on a submitted /
    // cancelled doc → Read; otherwise Write.
    get_field_display_status: (df: Any, doc?: Any) => {
      if (g.cint(df?.hidden)) return "None"
      if (g.cint(df?.read_only)) return "Read"
      if (doc && g.cint(doc.docstatus) > 0 && !(g.cint(doc.docstatus) === 1 && g.cint(df?.allow_on_submit))) return "Read"
      return "Write"
    },
    filter_allowed_docs_for_doctype: (perms: Any[] = [], doctype: string) => {
      const allowed = perms.filter((p) => !p.applicable_for || p.applicable_for === doctype)
      return { allowed_records: allowed.map((p) => p.doc), default_doc: allowed.find((p) => p.is_default)?.doc ?? null }
    },
  }
  frappe.user = {
    name: frappe.session.user,
    has_role(rl: string | string[]) {
      const roles = frappe.user_roles ?? []
      return (Array.isArray(rl) ? rl : [rl]).some((r) => roles.includes(r)) || roles.includes("Administrator")
    },
    full_name: (uid?: string) => frappe.user_info(uid).fullname,
    image: (uid?: string) => frappe.user_info(uid).image,
    get_emails: () => [],
    is_report_manager: () => frappe.user.has_role(["Administrator", "System Manager", "Report Manager"]),
  }
  frappe.user_info = (uid?: string) => {
    if (!uid) uid = frappe.session.user
    const info = frappe.boot.user_info?.[uid!] ?? {}
    return { fullname: info.fullname || uid, image: info.image, abbr: frappe.get_abbr(info.fullname || uid), email: info.email || uid, name: uid }
  }
  frappe.workflow = {
    is_read_only: () => false,
    get_state_fieldname(doctype: string) {
      const wf = frappe.model.get_list("Workflow", { document_type: doctype })[0]
        ?? frappe.get_meta(doctype)?.__workflow_docs?.[0]
      return wf ? wf.workflow_state_field || "workflow_state" : null
    },
    get_default_state: () => null,
    get_transitions: (doc: Any) => frappe.xcall("frappe.model.workflow.get_transitions", { doc }),
  }
}
