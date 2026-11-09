/* eslint-disable @typescript-eslint/no-explicit-any, no-new-func */
/**
 * Frappe client environment for running Frappe/ERPNext form scripts unchanged.
 *
 * Installs the globals Desk scripts expect (`frappe`, `$`, `moment`, `locals`,
 * `cur_frm`, `__`, `flt`, `cint`, …). Logic that must match the server
 * (number rounding, defaults, dates) is ported from frappe/public/js so results
 * are identical to Desk. Everything here is deliberately loosely typed: it is a
 * shim for dynamic, untyped third-party code.
 */
import jQuery from "jquery"
import moment from "moment-timezone"

export type Any = any

declare global {
  interface Window {
    frappe: Any
    locals: Any
    cur_frm: Any
    cur_dialog: Any
    $: Any
    jQuery: Any
    moment: Any
    __petal_compat_installed?: boolean
  }
}

const g: Any = typeof window !== "undefined" ? window : globalThis

/** Create nested namespaces: provide("erpnext.selling") → window.erpnext.selling */
export function provide(namespace: string): Any {
  const parts = namespace.split(".")
  let obj: Any = g
  for (const p of parts) {
    if (obj[p] === undefined || obj[p] === null) obj[p] = {}
    obj = obj[p]
  }
  return obj
}

// ── Translation ──────────────────────────────────────────────────────────────
function format(str: string, args?: Any): string {
  if (str === undefined || str === null) return ""
  str = String(str)
  if (!args) return str
  if (!Array.isArray(args)) args = [args]
  return str.replace(/{(\d+)}/g, (m, n) => (args[n] !== undefined ? String(args[n]) : m))
}

export function __(txt: string, replace?: Any, context?: string): string {
  if (!txt || typeof txt !== "string") return txt
  const msgs = g.frappe?._messages ?? {}
  const translated = (context && msgs[`${txt}:${context}`]) || msgs[txt] || txt
  return format(translated, replace)
}

// ── Numbers (frappe/public/js/frappe/utils/number_format.js) ─────────────────
export function cint(v: Any, def?: number): number {
  if (v === true) return 1
  if (v === false) return 0
  v = v + ""
  if (v !== "0") v = lstrip(v, ["0"])
  v = parseInt(v)
  if (isNaN(v)) v = def === undefined ? 0 : def
  return v
}

export function cstr(s: Any): string {
  if (s == null) return ""
  return s + ""
}

function lstrip(s: string, chars: string[]): string {
  if (!chars) chars = ["\n", "\t", " "]
  let first = s.substr(0, 1)
  while (chars.includes(first)) {
    s = s.substr(1)
    first = s.substr(0, 1)
  }
  return s
}

const NUMBER_FORMAT_INFO: Record<string, { decimal_str: string; group_sep: string; precision?: number }> = {
  "#,###.##": { decimal_str: ".", group_sep: "," },
  "#.###,##": { decimal_str: ",", group_sep: "." },
  "# ###.##": { decimal_str: ".", group_sep: " " },
  "# ###,##": { decimal_str: ",", group_sep: " " },
  "#'###.##": { decimal_str: ".", group_sep: "'" },
  "#, ###.##": { decimal_str: ".", group_sep: ", " },
  "#,##,###.##": { decimal_str: ".", group_sep: "," },
  "#,###.###": { decimal_str: ".", group_sep: "," },
  "#.###": { decimal_str: "", group_sep: "." },
  "#,###": { decimal_str: "", group_sep: "," },
}

export function get_number_format(currency?: string): string {
  const sd = g.frappe?.boot?.sysdefaults ?? {}
  return (
    (cint(sd.use_number_format_from_currency) && currency && model_get_value(":Currency", currency, "number_format")) ||
    sd.number_format ||
    "#,###.##"
  )
}

export function get_number_format_info(fmt: string) {
  const info = { ...(NUMBER_FORMAT_INFO[fmt] ?? { decimal_str: ".", group_sep: "," }) } as Any
  info.precision = info.decimal_str == "" ? 0 : (fmt.split(info.decimal_str).slice(1)[0] ?? "").length
  return info
}

function strip_number_groups(v: string, number_format?: string): string {
  if (!number_format) number_format = get_number_format()
  const info = get_number_format_info(number_format)
  const group_regex = new RegExp(info.group_sep === "." ? "\\." : info.group_sep, "g")
  v = v.replace(group_regex, "")
  if (info.decimal_str !== "." && info.decimal_str !== "") {
    v = v.replace(new RegExp(info.decimal_str, "g"), ".")
  }
  return v
}

export function flt(v: Any, decimals?: Any, number_format?: string, rounding_method?: string): number {
  if (v == null || v == "") return 0
  if (typeof v !== "number") {
    v = v + ""
    if (v.indexOf(" ") != -1) {
      const parts = v.split(" ")
      v = isNaN(parseFloat(parts[0])) ? parts.slice(parts.length - 1).join(" ") : v
    }
    v = strip_number_groups(v, number_format)
    v = parseFloat(v)
    if (isNaN(v)) v = 0
  }
  if (decimals != null) return _round(v, decimals, rounding_method)
  return v
}

export function _round(num: number, precision: Any, rounding_method?: string): number {
  rounding_method = rounding_method || g.frappe?.boot?.sysdefaults?.rounding_method || "Banker's Rounding (legacy)"
  const is_negative = num < 0
  if (rounding_method == "Banker's Rounding (legacy)") {
    const d = cint(precision)
    const m = Math.pow(10, d)
    const n = +(d ? Math.abs(num) * m : Math.abs(num)).toFixed(8)
    const i = Math.floor(n)
    const f = n - i
    let r = !precision && f == 0.5 ? (i % 2 == 0 ? i : i + 1) : Math.round(n)
    r = d ? r / m : r
    return is_negative ? -r : r
  } else if (rounding_method == "Banker's Rounding") {
    if (num == 0) return 0.0
    precision = cint(precision)
    const multiplier = Math.pow(10, precision)
    num = Math.abs(num) * multiplier
    const floor_num = Math.floor(num)
    const decimal_part = num - floor_num
    const epsilon = 2.0 ** (Math.log2(Math.abs(num)) - 52.0)
    if (Math.abs(decimal_part - 0.5) < epsilon) num = floor_num % 2 == 0 ? floor_num : floor_num + 1
    else num = Math.round(num)
    num = num / multiplier
    return is_negative ? -num : num
  } else if (rounding_method == "Commercial Rounding") {
    if (num == 0) return 0.0
    const digits = cint(precision)
    const multiplier = Math.pow(10, digits)
    num = num * multiplier
    let epsilon = 2.0 ** (Math.log2(Math.abs(num)) - 52.0)
    if (is_negative) epsilon = -1 * epsilon
    num = Math.round(num + epsilon)
    return num / multiplier
  }
  throw new Error(`Unknown rounding method ${rounding_method}`)
}

function replace_all(s: string, t1: string, t2: string): string {
  return s.split(t1).join(t2)
}

export function format_number(v: Any, fmt?: string, decimals?: Any): string {
  if (!fmt) {
    fmt = get_number_format()
    if (decimals == null) decimals = cint(g.frappe?.defaults?.get_default("float_precision")) || 3
  }
  const info = get_number_format_info(fmt)
  if (decimals == null) decimals = info.precision
  v = flt(v, decimals, fmt)
  const is_negative = v < 0
  v = Math.abs(v).toFixed(decimals)
  const part = v.split(".")
  let group_position = info.group_sep ? 3 : 0
  if (group_position) {
    const integer = part[0]
    let str = ""
    for (let i = integer.length; i >= 0; i--) {
      let l = replace_all(str, info.group_sep, "").length
      if (fmt == "#,##,###.##" && str.indexOf(",") != -1) {
        group_position = 2
        l += 1
      }
      str += integer.charAt(i)
      if (l && !((l + 1) % group_position) && i != 0) str += info.group_sep
    }
    part[0] = str.split("").reverse().join("")
  }
  if (part[0] + "" == "") part[0] = "0"
  part[1] = part[1] && info.decimal_str ? info.decimal_str + part[1] : ""
  return (is_negative ? "-" : "") + part[0] + part[1]
}

export function get_currency_symbol(currency?: string): string | null {
  const sd = g.frappe?.boot?.sysdefaults ?? {}
  if (sd.hide_currency_symbol == "Yes") return null
  if (!currency) currency = sd.currency
  return model_get_value(":Currency", currency, "symbol") || currency || null
}

export function format_currency(v: Any, currency?: string, decimals?: Any): string {
  const fmt = get_number_format(currency)
  const symbol = get_currency_symbol(currency)
  const right = model_get_value(":Currency", currency, "symbol_on_right") ?? false
  if (decimals === undefined) decimals = g.frappe?.boot?.sysdefaults?.currency_precision || null
  if (symbol) {
    return right ? format_number(v, fmt, decimals) + " " + __(symbol) : __(symbol) + " " + format_number(v, fmt, decimals)
  }
  return format_number(v, fmt, decimals)
}

export function precision(fieldname: string, doc?: Any): number {
  const frappe = g.frappe
  if (g.cur_frm) {
    if (!doc) doc = g.cur_frm.doc
    const df = frappe.meta.get_docfield(doc.doctype, fieldname, doc.parent || doc.name)
    return frappe.meta.get_field_precision(df, doc)
  }
  return frappe.boot.sysdefaults.float_precision
}

function remainder(numerator: number, denominator: number, prec: Any): number {
  prec = cint(prec)
  const multiplier = Math.pow(10, prec)
  const r = prec ? ((numerator * multiplier) % (denominator * multiplier)) / multiplier : numerator % denominator
  return flt(r, prec)
}

function round_based_on_smallest_currency_fraction(value: number, currency: string, prec: Any): number {
  const smallest = flt(model_get_value(":Currency", currency, "smallest_currency_fraction_value"))
  if (smallest) {
    const rem = remainder(value, smallest, prec)
    if (rem > smallest / 2) value += smallest - rem
    else value -= rem
  } else {
    value = _round(value, 0)
  }
  return value
}

/** Reads locals without requiring frappe.model to be installed yet. */
function model_get_value(doctype: string, name: Any, field: string): Any {
  const l = g.locals
  return l && l[doctype] && l[doctype][name] ? l[doctype][name][field] : undefined
}

// ── Misc legacy globals (frappe/public/js/frappe/utils/utils.js, misc) ────────
function is_null(v: Any): boolean {
  if (v === null || v === undefined) return true
  if (typeof v === "string" && v === "") return true
  return false
}

function copy_dict(d: Any): Any {
  const n: Any = {}
  for (const k in d) n[k] = d[k]
  return n
}

function repl(s: string, dict: Any): string {
  if (s == null) return ""
  for (const key in dict) s = s.split("%(" + key + ")s").join(dict[key])
  return s
}

function strip(s: Any, chars?: string[]): string {
  if (typeof s !== "string") return s
  s = lstrip(s, chars as string[])
  return s.split("").reverse().join("").replace(/^[\s\n\t]+/, "").split("").reverse().join("")
}

function toTitle(s: string): string {
  return (s || "").replace(/\w\S*/g, (t) => t.charAt(0).toUpperCase() + t.substr(1).toLowerCase())
}

function validate_email(txt: string): boolean {
  return /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/.test(txt)
}

function has_common(a: Any[], b: Any[]): boolean {
  return (a || []).some((x) => (b || []).includes(x))
}

function filter_dict(dict: Any, filters: Any): Any[] {
  const ret: Any[] = []
  const list = Array.isArray(dict) ? dict : Object.values(dict || {})
  for (const d of list) {
    let ok = true
    for (const key in filters) {
      let value = filters[key]
      if (Array.isArray(value)) {
        const [op, v] = value
        if (op === "in") { if (!(v as Any[]).includes(d[key])) ok = false }
        else if (op === "not in") { if ((v as Any[]).includes(d[key])) ok = false }
        else if (op === "=") { if (d[key] !== v) ok = false }
        else if (op === "!=") { if (d[key] === v) ok = false }
        else if (op === ">") { if (!(d[key] > v)) ok = false }
        else if (op === "<") { if (!(d[key] < v)) ok = false }
      } else {
        if (value === undefined) value = null
        if (d[key] !== value && !(value === null && d[key] == null)) ok = false
      }
      if (!ok) break
    }
    if (ok) ret.push(d)
  }
  return ret
}

function get_random(len: number): string {
  let text = ""
  const possible = "abcdefghijklmnopqrstuvwxyz0123456789"
  for (let i = 0; i < len; i++) text += possible.charAt(Math.floor(Math.random() * possible.length))
  return text
}

function escape_html(txt: Any): string {
  if (typeof txt !== "string") return txt
  const map: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "/": "&#x2F;", "`": "&#x60;", "=": "&#x3D;" }
  return txt.replace(/[&<>"'`=/]/g, (c) => map[c] ?? c)
}

function deep_equal(a: Any, b: Any): boolean {
  try { return JSON.stringify(a) === JSON.stringify(b) } catch { return a === b }
}

function comma_sep(list: Any[], sep: string): string {
  if (!list.length) return ""
  if (list.length === 1) return String(list[0])
  return list.slice(0, -1).join(", ") + " " + sep + " " + list[list.length - 1]
}

/** Petal path for a Frappe route array or `/app/...` URL. */
export function routeToPath(route: Any[]): string {
  const [view, ...rest] = route.map((r) => (r == null ? "" : String(r)))
  const enc = encodeURIComponent
  switch ((view ?? "").toLowerCase()) {
    case "form": return rest[1] ? `/form/${enc(rest[0]!)}/${enc(rest[1])}` : `/form/${enc(rest[0]!)}/new`
    case "list": case "report": return rest[0] ? `/list/${enc(rest[0])}` : "/"
    case "tree": return `/tree/${enc(rest[0] ?? "")}`
    case "kanban": return `/kanban/${enc(rest[0] ?? "")}`
    case "calendar": return `/calendar/${enc(rest[0] ?? "")}`
    case "gantt": return `/gantt/${enc(rest[0] ?? "")}`
    case "query-report": return `/report/${enc(rest[0] ?? "")}`
    case "workspace": case "workspaces": return `/workspace/${enc(rest[0] ?? "")}`
    case "": return "/"
    default: {
      // A doctype slug or name, as Desk accepts: set_route("sales-invoice", "SINV-0001")
      const doctype = slugToDoctype(view!)
      if (doctype) return rest[0] ? `/form/${enc(doctype)}/${enc(rest[0])}` : `/list/${enc(doctype)}`
      return "/" + route.map((r) => enc(String(r))).join("/")
    }
  }
}

function slugToDoctype(slug: string): string | null {
  const types = g.frappe?.boot?.user?.can_read as string[] | undefined
  const unslug = slug.replace(/-/g, " ")
  if (!types) return unslug.replace(/\b\w/g, (c) => c.toUpperCase())
  return types.find((t) => t.toLowerCase() === unslug.toLowerCase()) ?? null
}

/** Convert a Desk URL ("/app/sales-invoice/SINV-1", "#Form/..") to a Petal path. */
export function deskUrlToPath(href: string): string | null {
  try {
    const u = new URL(href, typeof location !== "undefined" ? location.origin : "http://x")
    let p = u.pathname
    if (u.hash.startsWith("#Form/") || u.hash.startsWith("#List/")) p = "/app/" + u.hash.slice(1)
    if (!p.startsWith("/app/") && p !== "/app") return null
    const parts = p.replace(/^\/app\/?/, "").split("/").filter(Boolean).map(decodeURIComponent)
    if (!parts.length) return "/"
    if (["Form", "List", "Tree", "query-report", "Report"].includes(parts[0]!)) return routeToPath(parts)
    if (parts[0] === "query-report") return routeToPath(parts)
    const doctype = slugToDoctype(parts[0]!)
    if (!doctype) return null
    if (parts[1] === "view") return routeToPath(["List", doctype])
    if (parts[1] === "new" || (parts[1] ?? "").startsWith("new-")) return routeToPath(["Form", doctype, parts[1]])
    return routeToPath(parts[1] ? ["Form", doctype, parts[1]] : ["List", doctype])
  } catch {
    return null
  }
}

export function pathToRoute(pathname: string): string[] {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent)
  switch (parts[0]) {
    case "form": return ["Form", parts[1] ?? "", parts[2] ?? ""]
    case "list": return ["List", parts[1] ?? "", "List"]
    case "tree": return ["Tree", parts[1] ?? ""]
    case "report": return ["query-report", parts[1] ?? ""]
    case "workspace": return ["Workspaces", parts[1] ?? ""]
    default: return parts
  }
}

// ── Microtemplate (frappe/public/js/frappe/microtemplate.js) ─────────────────
function compileTemplate(str: string, name?: string): Any {
  const frappe = g.frappe
  const key = name || str
  if (!frappe.template.compiled[key]) {
    str = str.replace(/{{/g, "{%=").replace(/}}/g, "%}")
    str = str.replace(/{%\s?if\s?\s?not\s?([^\(][^%{]+)\s?%}/g, "{% if (! $1) { %}")
    str = str.replace(/{%\s?if\s?([^\(][^%{]+)\s?%}/g, "{% if ($1) { %}")
    str = str.replace(/{%\s?for\s([a-z._]+)\sin\s([a-z._]+)\s?%}/g, (_m, p1, p2) => {
      const i = "i" + get_random(3)
      const len = "l" + get_random(3)
      return `{% for (var ${i}=0, ${len}=${p2}.length; ${i}<${len}; ${i}++) { var ${p1} = ${p2}[${i}]; ${p1}._index = ${i}; %}`
    })
    str = str.replace(/{%\s?endif\s?%}/g, "{% }; %}")
    str = str.replace(/{%\s?else\s?%}/g, "{% } else { %}")
    str = str.replace(/{%\s?endfor\s?%}/g, "{% }; %}")
    const fn_str =
      "var _p=[],print=function(){_p.push.apply(_p,arguments)};with(obj){\n_p.push('" +
      str.replace(/[\r\t\n]/g, " ").split("{%").join("\t").replace(/((^|%})[^\t]*)'/g, "$1\r")
        .replace(/\t=(.*?)%}/g, "',$1,'").split("\t").join("');\n").split("%}").join("\n_p.push('")
        .split("\r").join("\\'") +
      "');}return _p.join('');"
    try {
      frappe.template.compiled[key] = new Function("obj", fn_str)
    } catch (e) {
      console.error("[Petal compat] Error in template", name, e)
      frappe.template.compiled[key] = () => ""
    }
  }
  return frappe.template.compiled[key]
}

// ── Icons: Frappe's sprite isn't loaded, so icons render as nothing ───────────
function icon(name: string, size = "sm"): string {
  const px: Record<string, number> = { xs: 12, sm: 16, md: 20, base: 20, lg: 24, xl: 32 }
  const s = px[size] ?? 16
  return `<svg class="icon icon-${size}" style="width:${s}px;height:${s}px" data-icon="${escape_html(name)}" aria-hidden="true"></svg>`
}

/** Install globals once. Safe to call repeatedly. */
export function installEnv(): Any {
  if (g.__petal_compat_installed) return g.frappe
  g.__petal_compat_installed = true

  g.jQuery = g.$ = jQuery
  g.moment = moment
  if (!g.locals) g.locals = { DocType: {} }
  if (!g.locals.DocType) g.locals.DocType = {}
  g.cur_frm = null
  g.cur_dialog = null

  const frappe: Any = (g.frappe = g.frappe ?? {})
  frappe.provide = provide
  frappe._messages = frappe._messages ?? {}
  frappe.boot = frappe.boot ?? { sysdefaults: {}, user: { defaults: {}, can_read: [], can_create: [], can_write: [], can_delete: [], can_submit: [], can_cancel: [], can_select: [], can_get_report: [], can_import: [], can_export: [], can_print: [], can_email: [], can_share: [] }, user_info: {}, versions: {}, docs: [] }
  frappe.sys_defaults = frappe.boot.sysdefaults
  frappe.session = frappe.session ?? { user: "Guest", user_fullname: "Guest", logged_in_user: "Guest" }
  frappe.flags = frappe.flags ?? {}
  frappe.route_options = null
  frappe.route_hooks = {}
  frappe.route_history = []
  frappe.templates = frappe.templates ?? {}
  frappe.template = { compiled: {}, debug: {} }
  frappe.template.compile = compileTemplate
  frappe.render = (str: string, data: Any, name?: string) => compileTemplate(str, name)(data ?? {})
  frappe.render_template = (name: string, data?: Any) => {
    const tpl = name.indexOf(" ") !== -1 ? name : frappe.templates[name]
    if (!tpl) frappe.throw(`Template <b>${name}</b> not found.`)
    return frappe.render(tpl, data ?? {}, name)
  }
  frappe.help = { help_links: {} }
  frappe.form = { link_formatters: {}, formatters: {}, get_formatter: () => (v: Any) => cstr(v) }
  frappe.views = { formview: {}, trees: {}, list_view: {}, ListView: class {}, TreeView: class {}, InteractionComposer: class { constructor() { frappe.msgprint(__("Email composer is not available in Petal yet.")) } } }
  frappe.listview_settings = frappe.listview_settings ?? {}
  frappe.treeview_settings = frappe.treeview_settings ?? {}
  frappe.query_reports = frappe.query_reports ?? {}
  frappe.dynamic_link = null
  frappe.tour = {}
  frappe.breadcrumbs = { add() {}, preferred: {}, module_map: {} }
  frappe.is_online = () => (typeof navigator === "undefined" ? true : navigator.onLine)
  frappe.scrub = (txt: string) => (txt || "").replace(/ /g, "_").toLowerCase()
  frappe.unscrub = (txt: string) =>
    (txt || "").replace(/-|_/g, " ").replace(/\w*/g, (k) => k.charAt(0).toUpperCase() + k.substr(1).toLowerCase())
  frappe.get_abbr = (txt: string, max_length = 2) => {
    if (!txt) return ""
    const abbr = txt.trim().split(/\s+/).map((w) => w[0]).join("")
    return abbr.substr(0, max_length).toUpperCase()
  }
  frappe.get_palette = () => ["--gray-100", "--gray-600"]
  frappe.get_cookie = (name: string) =>
    typeof document === "undefined" ? null
      : decodeURIComponent((document.cookie.split("; ").find((c) => c.startsWith(name + "="))?.split("=")[1]) ?? "") || null
  frappe.urllib = {
    get_full_url: (url: string) => (url.startsWith("http") ? url : (typeof location !== "undefined" ? location.origin : "") + url),
    get_base_url: () => (typeof location !== "undefined" ? location.origin : ""),
    get_arg: (name: string) => (typeof location !== "undefined" ? new URLSearchParams(location.search).get(name) : null),
  }
  frappe.number_format_info = NUMBER_FORMAT_INFO
  frappe.defaultDateFormat = "YYYY-MM-DD"
  frappe.defaultTimeFormat = "HH:mm:ss"
  frappe.defaultDatetimeFormat = "YYYY-MM-DD HH:mm:ss"
  moment.defaultFormat = frappe.defaultDateFormat

  frappe.utils = {
    filter_dict, get_random, escape_html, deep_equal, icon,
    unescape_html: (t: string) => { const d = document.createElement("textarea"); d.innerHTML = t; return d.value },
    sum: (list: Any[]) => list.reduce((p, c) => p + flt(c), 0),
    comma_and: (list: Any[]) => comma_sep(list, __("and")),
    comma_or: (list: Any[]) => comma_sep(list, __("or")),
    get_form_link: (doctype: string, name: string, html = false, display_text: string | null = null) => {
      const route = routeToPath(["Form", doctype, name])
      return html ? `<a href="${route}">${escape_html(display_text || name)}</a>` : route
    },
    get_url_to_form: (doctype: string, name: string) => routeToPath(["Form", doctype, name]),
    get_url_to_list: (doctype: string) => routeToPath(["List", doctype]),
    get_url_to_report: (name: string) => routeToPath(["query-report", name]),
    play_sound: () => {},
    scroll_to: () => {},
    is_html: (txt: Any) => typeof txt === "string" && /<[a-z][\s\S]*>/i.test(txt),
    strip_html: (txt: string) => cstr(txt).replace(/<[^>]*>/g, ""),
    html2text: (html: string) => { const d = document.createElement("div"); d.innerHTML = html; return d.textContent ?? "" },
    unique: (list: Any[]) => [...new Set(list)],
    is_url: (txt: string) => /^(https?:)?\/\//.test(txt || ""),
    get_link_title: (doctype: string, name: string) => frappe._link_titles?.[doctype + "::" + name],
    add_link_title: (doctype: string, name: string, value: string) => {
      frappe._link_titles = frappe._link_titles ?? {}
      frappe._link_titles[doctype + "::" + name] = value
    },
    eval: (code: string, context: Any = {}) => {
      const keys = Object.keys(context)
      return new Function(...keys, `return (${code})`)(...keys.map((k) => context[k]))
    },
    sort: (list: Any[], key: string, compare_type?: string, reverse?: boolean) => {
      const out = [...list].sort((a, b) =>
        compare_type === "number" ? flt(a[key]) - flt(b[key]) : cstr(a[key]).localeCompare(cstr(b[key])))
      return reverse ? out.reverse() : out
    },
    get_filter_from_json: (v: Any) => { try { return typeof v === "string" ? JSON.parse(v) : v } catch { return v } },
    guess_style: () => "default",
    guess_colour: () => "blue",
    get_indicator: () => null,
    bind_actions_with_object: ($el: Any, object: Any) => {
      $el.on("click", "[data-action]", function (this: Any, e: Any) {
        const fn = object[jQuery(this).attr("data-action") ?? ""]
        if (typeof fn === "function") fn.call(object, e, jQuery(this))
      })
    },
    warn_page_name_change: () => {},
    set_meta_tag: () => {},
    build_summary_item: (s: Any) => `<div class="summary-item"><span class="summary-label">${escape_html(s.label)}</span><div class="summary-value">${s.datatype === "Currency" ? format_currency(s.value, s.currency) : cstr(s.value)}</div></div>`,
    get_number_system: () => [{ divisor: 1.0e12, symbol: "T" }, { divisor: 1.0e9, symbol: "B" }, { divisor: 1.0e6, symbol: "M" }, { divisor: 1.0e3, symbol: "K" }],
    shorten_number: (n: number) => format_number(n),
    debounce: (fn: Any, wait: number) => {
      let t: Any
      return function (this: Any, ...args: Any[]) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), wait) }
    },
    throttle: (fn: Any, wait: number) => {
      let last = 0
      return function (this: Any, ...args: Any[]) { const now = Date.now(); if (now - last >= wait) { last = now; fn.apply(this, args) } }
    },
    copy_to_clipboard: (s: string) => { void navigator.clipboard?.writeText(s) },
    format: (v: Any) => cstr(v),
    flatten: (arr: Any[]) => arr.flat(Infinity),
    get_query_string: (url: string) => url.split("?")[1] ?? "",
    get_query_params: () => Object.fromEntries(new URLSearchParams(typeof location !== "undefined" ? location.search : "")),
    new_auto_repeat_prompt: () => frappe.msgprint(__("Auto Repeat is not available in Petal yet.")),
  }

  frappe.datetime = makeDatetime(frappe)

  // Legacy globals
  Object.assign(g, {
    __, flt, cint, cstr, format_number, format_currency, fmt_money: format_currency, get_currency_symbol,
    get_number_format, get_number_format_info, _round, roundNumber: _round, precision, remainder,
    round_based_on_smallest_currency_fraction, strip_number_groups,
    in_list: (list: Any[], item: Any) => (list || []).includes(item),
    is_null, copy_dict, repl, strip, lstrip, toTitle, validate_email, has_common, replace_all,
    nth: (n: number) => n + (["st", "nd", "rd"][((((n + 90) % 100) - 10) % 10) - 1] || "th"),
    keys: (obj: Any) => Object.keys(obj),
    values: (obj: Any) => Object.values(obj),
    validate_name: (n: string) => !/[%'"#*?`]/.test(n || ""),
    validate_phone: (n: string) => /^[0-9 ()+\-]+$/.test(n || ""),
    get_url_arg: (name: string) => (typeof location !== "undefined" ? new URLSearchParams(location.search).get(name) ?? "" : ""),
    prettyDate: (d: Any) => moment(d).fromNow(),
    comment_when: (d: Any) => `<span class="frappe-timestamp" title="${escape_html(String(d))}">${moment(d).fromNow()}</span>`,
  })
  ;(String.prototype as Any).bold ??= function (this: string) { return "<b>" + this + "</b>" }

  return frappe
}

function makeDatetime(frappe: Any): Any {
  const tz = () => frappe.boot.time_zone ?? {}
  const userDateFmt = () => (frappe.sys_defaults?.date_format) || "yyyy-mm-dd"
  const userTimeFmt = () => (frappe.sys_defaults?.time_format) || "HH:mm:ss"
  const _date = (fmt: string, as_obj = false, system_time = false) => {
    let time_zone = tz().system || frappe.sys_defaults?.time_zone
    if (!system_time) time_zone = tz().user || time_zone
    const date = time_zone ? moment.tz(time_zone) : moment()
    return as_obj ? date.toDate() : date.format(fmt)
  }
  return {
    convert_to_user_tz: (date: Any, fmt?: boolean) => {
      const z = tz()
      const o = z.system && z.user ? moment.tz(date, z.system).clone().tz(z.user) : moment(date)
      return fmt === false ? o : o.format(frappe.defaultDatetimeFormat)
    },
    convert_to_system_tz: (date: Any, fmt?: boolean) => {
      const z = tz()
      const o = z.system && z.user ? moment.tz(date, z.user).clone().tz(z.system) : moment(date)
      return fmt === false ? o : o.format(frappe.defaultDatetimeFormat)
    },
    is_system_time_zone: () => {
      const z = tz()
      return z.system && z.user ? moment().tz(z.system).utcOffset() === moment().tz(z.user).utcOffset() : true
    },
    is_timezone_same() { return this.is_system_time_zone() },
    str_to_obj: (d: Any) => moment(d, frappe.defaultDatetimeFormat).toDate(),
    obj_to_str: (d: Any) => moment(d).locale("en").format(),
    obj_to_user: (d: Any) => moment(d).format(userDateFmt().toUpperCase()),
    get_diff: (d1: Any, d2: Any) => moment(d1).diff(d2, "days"),
    get_hour_diff: (d1: Any, d2: Any) => moment(d1).diff(d2, "hours"),
    get_minute_diff: (d1: Any, d2: Any) => moment(d1).diff(d2, "minutes"),
    get_day_diff: (d1: Any, d2: Any) => moment(d1).diff(d2, "days"),
    add_days: (d: Any, days: number) => moment(d).add(days, "days").format(),
    add_months: (d: Any, months: number) => moment(d).add(months, "months").format(),
    week_start: () => moment().startOf("week").format(),
    week_end: () => moment().endOf("week").format(),
    month_start: () => moment().startOf("month").format(),
    month_end: () => moment().endOf("month").format(),
    quarter_start: () => moment().startOf("quarter").format(),
    quarter_end: () => moment().endOf("quarter").format(),
    year_start: () => moment().startOf("year").format(),
    year_end: () => moment().endOf("year").format(),
    get_user_time_fmt: userTimeFmt,
    get_user_date_fmt: userDateFmt,
    get_user_fmt: userDateFmt,
    str_to_user: (val: Any, only_time = false, only_date = false) => {
      if (!val) return ""
      if (only_time) return moment(val, frappe.defaultTimeFormat).format(userTimeFmt())
      if (only_date || (typeof val === "string" && val.indexOf(" ") === -1)) {
        return moment(val, frappe.defaultDateFormat).format(userDateFmt().toUpperCase())
      }
      const z = tz()
      const sys = z.system ? moment.tz(val, frappe.defaultDatetimeFormat, z.system) : moment(val, frappe.defaultDatetimeFormat)
      const user = z.user ? sys.clone().tz(z.user) : sys
      return user.format(userDateFmt().toUpperCase() + " " + userTimeFmt())
    },
    get_datetime_as_string: (d: Any) => moment(d).format("YYYY-MM-DD HH:mm:ss"),
    user_to_str: (val: string, only_time = false) => {
      if (only_time) return moment(val, userTimeFmt()).format(frappe.defaultTimeFormat)
      let user_fmt = userDateFmt().toUpperCase()
      let system_fmt = "YYYY-MM-DD"
      if (val.indexOf(" ") !== -1) { user_fmt += " " + userTimeFmt(); system_fmt += " HH:mm:ss" }
      return moment(val, [user_fmt.replace("YYYY", "YY"), user_fmt]).locale("en").format(system_fmt)
    },
    user_to_obj(d: string) { return this.str_to_obj(this.user_to_str(d)) },
    global_date_format: (d: Any) => moment(d).format("Do MMMM YYYY"),
    now_date: (as_obj = false) => _date(frappe.defaultDateFormat, as_obj),
    now_time: (as_obj = false) => _date(frappe.defaultTimeFormat, as_obj),
    now_datetime: (as_obj = false) => _date(frappe.defaultDatetimeFormat, as_obj),
    system_datetime: (as_obj = false) => _date(frappe.defaultDatetimeFormat, as_obj, true),
    nowdate: () => _date(frappe.defaultDateFormat),
    get_today: () => _date(frappe.defaultDateFormat),
    get_time: (ts: Any) => moment(ts).format("hh:mm A"),
    validate: (d: Any) => moment(d, [frappe.defaultDateFormat, frappe.defaultDatetimeFormat, frappe.defaultTimeFormat], true).isValid(),
    get_first_day_of_the_week_index: () => moment.weekdays().indexOf(frappe.sys_defaults?.first_day_of_the_week || "Sunday"),
    prettyDate: (d: Any) => moment(d).fromNow(),
    comment_when: (d: Any) => moment(d).fromNow(),
  }
}
