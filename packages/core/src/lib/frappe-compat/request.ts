/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * frappe.call / frappe.xcall / frappe.db / frappe.client — ported from
 * frappe/public/js/frappe/request.js and db.js. Returns jQuery Deferreds like
 * Desk ($.ajax), so `.then`, `.done`, `.fail`, `.always` and `await` all work.
 */
import { __, type Any } from "./env"

const g: Any = typeof window !== "undefined" ? window : globalThis

export type Transport = (method: string, args: Record<string, unknown>) => Promise<{ status: number; data: Any }>

let transport: Transport = async () => {
  throw new Error("[Petal compat] No transport configured")
}

export function setTransport(t: Transport) {
  transport = t
}

const pending = new Set<Promise<unknown>>()

/** Resolves once every request in flight now (and any they start) has settled. */
export async function waitForPending(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending])
}

export function installRequest(frappe: Any) {
  frappe.request = frappe.request ?? {}
  frappe.request.url = "/"
  frappe.request.wait_for_pending = waitForPending
  frappe.request.logs = {}

  frappe.xcall = (method: string, params?: Any) =>
    new Promise((resolve, reject) => {
      frappe.call({
        method,
        args: params,
        callback: (r: Any) => resolve(r.message),
        error: (r: Any) => reject(r?.message ?? r),
      })
    })

  frappe.call = function (opts: Any, ...rest: Any[]) {
    if (typeof opts === "string") {
      opts = { method: opts, args: rest[0], callback: rest[1], headers: rest[2] }
    }
    const args: Any = { ...(opts.args ?? {}) }
    if (args.freeze) {
      opts.freeze = opts.freeze || args.freeze
      opts.freeze_message = opts.freeze_message || args.freeze_message
    }
    let method: string
    if (opts.module && opts.page) {
      method = opts.module + ".page." + opts.page + "." + opts.page + "." + opts.method
    } else if (opts.doc) {
      method = "run_doc_method"
      Object.assign(args, { docs: frappe.get_doc(opts.doc.doctype, opts.doc.name) ?? opts.doc, method: opts.method, args: opts.args })
    } else {
      method = opts.method
    }
    if (!method) throw "Incomplete Request"

    // Desk sends nested objects as JSON strings; many whitelisted methods
    // json.loads() their arguments unconditionally, so match that exactly.
    for (const key in args) {
      const v = args[key]
      if (v && typeof v === "object") args[key] = JSON.stringify(v)
      if (v === undefined) delete args[key]
    }

    const d = g.$.Deferred()
    if (opts.freeze) frappe.dom.freeze(opts.freeze_message)
    if (opts.btn) try { g.$(opts.btn).prop("disabled", true) } catch { /* noop */ }

    const run = (async () => {
      let status = 0
      let data: Any = null
      try {
        ;({ status, data } = await transport(method, args))
      } catch (e) {
        console.error("[Petal compat] request failed", method, e)
        status = 0
        data = null
      }
      if (typeof data === "string") { try { data = JSON.parse(data) } catch { data = { message: data } } }
      data = data ?? {}

      try {
        if (status >= 200 && status < 300) {
          if (data.docs || data.docinfo) frappe.model.sync(data)
          if (data.__messages) Object.assign(frappe._messages, data.__messages)
          if (data._link_titles) frappe._link_titles = Object.assign(frappe._link_titles ?? {}, data._link_titles)
          showServerMessages(frappe, data)
          try {
            opts.callback && opts.callback(data, JSON.stringify(data))
          } catch (e) {
            console.error("[Petal compat] callback error", method, e)
          }
          d.resolve(data)
        } else {
          handleError(frappe, status, data)
          try { opts.error && opts.error(data) } catch (e) { console.error(e) }
          d.reject(data)
        }
      } finally {
        if (opts.freeze) frappe.dom.unfreeze()
        if (opts.btn) try { g.$(opts.btn).prop("disabled", false) } catch { /* noop */ }
        try { opts.always && opts.always(data) } catch (e) { console.error(e) }
      }
    })()
    pending.add(run)
    void run.finally(() => pending.delete(run))
    return d.promise()
  }

  // ── frappe.db (db.js) ──────────────────────────────────────────────────────
  frappe.db = {
    get_list(doctype: string, args: Any = {}) {
      args = { ...args, doctype }
      if (!args.fields) args.fields = ["name"]
      if (!("limit" in args)) args.limit = 20
      return new Promise((resolve) => frappe.call({ method: "frappe.desk.reportview.get_list", args, callback: (r: Any) => resolve(r.message) }))
    },
    exists(doctype: string, name: string) {
      return new Promise((resolve) => {
        frappe.db.get_value(doctype, { name }, "name").then((r: Any) => resolve(!!(r.message && r.message.name)))
      })
    },
    get_value(doctype: string, filters: Any, fieldname: Any, callback?: Any, parent_doc?: string) {
      return frappe.call({
        method: "frappe.client.get_value",
        args: { doctype, fieldname, filters, parent: parent_doc },
        callback: (r: Any) => { callback && callback(r.message) },
      })
    },
    get_single_value: (doctype: string, field: string) =>
      new Promise((resolve) => {
        frappe.call({ method: "frappe.client.get_single_value", args: { doctype, field } }).then((r: Any) => resolve(r ? r.message : null))
      }),
    set_value(doctype: string, docname: string, fieldname: Any, value?: Any, callback?: Any) {
      return frappe.call({
        method: "frappe.client.set_value",
        args: { doctype, name: docname, fieldname, value },
        callback: (r: Any) => { callback && callback(r.message) },
      })
    },
    get_doc(doctype: string, name?: string, filters?: Any) {
      return new Promise((resolve, reject) => {
        frappe.call({
          method: "frappe.client.get",
          args: { doctype, name, filters },
          callback: (r: Any) => { frappe.model.sync(r.message); resolve(r.message) },
        }).fail(reject)
      })
    },
    insert: (doc: Any) => frappe.xcall("frappe.client.insert", { doc }),
    delete_doc: (doctype: string, name: string) =>
      new Promise((resolve) => frappe.call("frappe.client.delete", { doctype, name }, (r: Any) => resolve(r.message))),
    count(doctype: string, args: Any = {}) {
      const filters = args.filters || {}
      const distinct = Array.isArray(filters) && filters.some((f: Any) => f[0] !== doctype)
      return frappe.xcall("frappe.desk.reportview.get_count", { doctype, filters, fields: [], distinct, limit: args.limit })
    },
    get_link_options: (doctype: string, txt = "", filters = {}) =>
      new Promise((resolve) => frappe.call({ method: "frappe.desk.search.search_link", args: { doctype, txt, filters }, callback: (r: Any) => resolve(r.message) })),
  }

  frappe.client = {
    get_value: (doctype: string, filters: Any, fieldname: Any) =>
      frappe.xcall("frappe.client.get_value", { doctype, filters, fieldname }),
    get: (doctype: string, name?: string, filters?: Any) => frappe.xcall("frappe.client.get", { doctype, name, filters }),
    get_list: (doctype: string, args: Any = {}) => frappe.xcall("frappe.client.get_list", { doctype, ...args }),
  }
}

/** Show `_server_messages` (msgprint from Python) the way Desk does. */
function showServerMessages(frappe: Any, data: Any) {
  if (!data._server_messages) return
  try {
    const msgs = JSON.parse(data._server_messages)
    if (Array.isArray(msgs) && msgs.length) frappe.msgprint(msgs)
  } catch (e) {
    console.warn("[Petal compat] bad _server_messages", e)
  }
}

function handleError(frappe: Any, status: number, data: Any) {
  if (data._server_messages) {
    showServerMessages(frappe, data)
    return
  }
  if (status === 0) {
    frappe.msgprint({ title: __("Connection Lost"), indicator: "red", message: __("Could not reach the server. Check your connection and try again.") })
  } else if (status === 403) {
    frappe.msgprint({ title: __("Not permitted"), indicator: "red", message: data._error_message || __("You do not have enough permissions to access this resource. Please contact your manager to get access.") })
  } else if (status === 404) {
    frappe.msgprint({ title: __("Not found"), indicator: "red", message: __("The resource you are looking for is not available") })
  } else if (status === 508) {
    frappe.msgprint({ title: __("Please try again"), indicator: "red", message: __("Another transaction is blocking this one. Please try again in a few seconds.") })
  } else if (status >= 500 || data.exc) {
    const exc = typeof data.exception === "string" ? data.exception : ""
    const short = exc ? exc.split("\n")[0]!.split(": ").slice(1).join(": ") || exc : ""
    frappe.msgprint({ title: __("Server Error"), indicator: "red", message: short || __("Something went wrong on the server. Check the Error Log for details.") })
  }
}
