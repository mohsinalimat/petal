/* eslint-disable @typescript-eslint/no-explicit-any, no-new-func */
/**
 * Frappe-compatible client runtime for Petal.
 *
 * Lets Frappe/ERPNext form scripts (doctype `__js`, Client Scripts and app
 * bundles such as erpnext.bundle.js) run unchanged inside Petal's forms.
 * Everything loads lazily on the first form open and only when an app enables
 * it through the `frappe_compat` hook.
 */
import { deskUrlToPath, installEnv, pathToRoute, routeToPath, type Any } from "./env"
import { installModel } from "./model"
import { installRequest, setTransport, type Transport } from "./request"
import { installUI, setToast } from "./ui"
import { getForm, installForm, installLegacyFormGlobals, notifyForms, type Form } from "./form"
import { installExtras } from "./extras"
import { loadWidgetLibs } from "./widgets"
export { deskControlsReady, loadDeskControls } from "./desk-controls"

export { notifyForms, subscribeForms, getForm, type Form, type CustomButton } from "./form"
export { uiStore, type Entry, type MsgEntry, type DialogEntry, type PickerEntry, CompatDialog, DialogField, MultiSelectPicker } from "./ui"
export { deskUrlToPath, routeToPath } from "./env"

const g: Any = typeof window !== "undefined" ? window : globalThis

export interface CompatOptions {
  transport: Transport
  /** Navigate within Petal. */
  navigate: (path: string, opts?: { replace?: boolean }) => void
  toast: (variant: "success" | "error" | "warning" | "info", title: string, detail?: string) => void
  /** Load a script's source (default: fetch through the Petal proxy). */
  fetchText?: (url: string) => Promise<string>
  /** Realtime subscription (returns an unsubscribe function). */
  realtimeOn?: (event: string, cb: (payload: Any) => void) => Promise<() => void>
  /** Bundles named in Frappe's assets.json, e.g. ["erpnext.bundle.js"]. */
  bundles?: string[]
  /** Upload a file (frappe.ui.FileUploader); resolves to the File doc. */
  upload?: (file: File, meta: Any) => Promise<Any>
  /** Also load `<app>.bundle.js` for every installed app (default true). */
  autoBundles?: boolean
  /** Base path of the Petal proxy. */
  proxyBase?: string
  /**
   * Load Desk's boot data. In the browser this reads it from the desk page
   * (frappe.sessions.get isn't whitelisted); defaults to calling it, for tests.
   */
  boot?: () => Promise<Any>
}

/** Desk source files that only need jQuery and frappe.*, evaluated as-is. */
const DESK_WIDGET_SOURCES = [
  "/assets/frappe/js/frappe/ui/tree.js",
  // frappe.format / frappe.form.formatters (used by reports, list formatters, controls)
  "/assets/frappe/js/frappe/form/formatters.js",
]



let ready: Promise<Any> | null = null
let options: CompatOptions | null = null
let assetsMap: Record<string, string> | null = null
const loadedAssets = new Set<string>()

/** Install the runtime once, load boot info and app bundles. Idempotent. */
export function ensureCompat(opts: CompatOptions): Promise<Any> {
  if (ready) return ready
  options = opts
  ready = (async () => {
    // Install the globals once; a retry after a failed boot only redoes the boot.
    if (g.__petal_compat_runtime) return startRuntime(g.frappe, opts)
    const frappe = installEnv()
    g.__petal_compat_runtime = true
    installModel(frappe)
    installRequest(frappe)
    installUI(frappe)
    installForm(frappe)
    installLegacyFormGlobals()
    setTransport(opts.transport)
    setToast(opts.toast)
    installRouting(frappe)
    installRealtime(frappe)
    installRequire(frappe)
    installExtras(frappe, opts.upload ? { upload: opts.upload } : {})
    return startRuntime(frappe, opts)
  })()
  ready.catch(() => { ready = null })
  return ready
}

async function startRuntime(frappe: Any, opts: CompatOptions): Promise<Any> {
  // Chart/table libraries load alongside the session so widgets work as soon
  // as the first script runs.
  await Promise.all([loadBoot(frappe), loadWidgetLibs()])
  // Every installed app's `<app>.bundle.js` (the usual app_include_js), then
  // any bundles apps asked for explicitly.
  const bundles: string[] = []
  if (opts.autoBundles !== false) {
    const assets = await getAssetsMap()
    for (const app of Object.keys(frappe.boot.versions ?? {})) {
      if (app !== "frappe" && assets[`${app}.bundle.js`]) bundles.push(`${app}.bundle.js`)
    }
  }
  for (const b of opts.bundles ?? []) if (!bundles.includes(b)) bundles.push(b)
  // Desk widgets that are plain jQuery over Frappe's own source, loaded from
  // the bench so they match its version.
  for (const src of DESK_WIDGET_SOURCES) {
    try { await frappe.require(src) } catch (e) { console.warn(`[Petal compat] could not load ${src}`, e) }
  }
  for (const bundle of bundles) {
    try {
      await frappe.require(bundle)
    } catch (e) {
      console.error(`[Petal compat] could not load ${bundle}`, e)
    }
  }
  try { g.$(document).trigger("app_ready") } catch { /* noop */ }
  return frappe
}

export function compatReady(): boolean {
  return !!g.__petal_compat_installed && !!g.frappe?.boot?.__petal_loaded
}

async function loadBoot(frappe: Any) {
  // A failed boot must reject: ensureCompat caches `ready`, and a half-empty
  // boot (no user, defaults or app versions) would stick for the whole tab.
  const r = await (options?.boot ? options.boot() : frappe.xcall("frappe.sessions.get")).catch((e: Any) => {
    console.error("[Petal compat] boot failed", e)
    throw e instanceof Error ? e : new Error("Could not load the session (frappe.sessions.get).")
  })
  if (!r || typeof r !== "object") throw new Error("Could not load the session (frappe.sessions.get).")
  const boot = r
  boot.sysdefaults = boot.sysdefaults ?? {}
  boot.user = boot.user ?? {}
  boot.user.defaults = boot.user.defaults ?? {}
  boot.user_info = boot.user_info ?? {}
  boot.desk_settings = boot.desk_settings ?? {}
  boot.docs = boot.docs ?? []
  boot.__petal_loaded = true
  frappe.boot = boot
  frappe.sys_defaults = boot.sysdefaults
  frappe.user_defaults = boot.user.defaults
  frappe.session.user = boot.user.name ?? frappe.session.user
  frappe.session.logged_in_user = frappe.session.user
  frappe.session.user_fullname = boot.user_info?.[frappe.session.user]?.fullname ?? frappe.session.user
  frappe.user_roles = boot.user.roles ?? []
  frappe.user.name = frappe.session.user
  if (boot.__messages) Object.assign(frappe._messages, boot.__messages)
  if (boot.docs) frappe.model.sync(boot.docs)
  frappe.defaults.load_user_permission_from_boot()
}

function proxyUrl(url: string): string {
  const base = options?.proxyBase ?? "/api/v1"
  if (/^https?:\/\//.test(url)) return url
  return base + (url.startsWith("/") ? url : "/" + url)
}

async function fetchText(url: string): Promise<string> {
  if (options?.fetchText) return options.fetchText(url)
  const res = await fetch(proxyUrl(url), { credentials: "include" })
  if (!res.ok) throw new Error(`${res.status} ${url}`)
  return res.text()
}

async function getAssetsMap(): Promise<Record<string, string>> {
  if (!assetsMap) {
    try {
      assetsMap = JSON.parse(await fetchText("/assets/assets.json"))
    } catch {
      assetsMap = {}
    }
  }
  return assetsMap!
}

async function resolveAsset(name: string): Promise<string> {
  if (name.startsWith("/")) return name
  const map = await getAssetsMap()
  return map[name] ?? (name.includes("/") ? "/assets/" + name : name)
}

/** Run a script in the global scope, named for devtools. */
export function evalScript(code: string, name: string) {
  new Function(code + `\n//# sourceURL=petal-compat:///${name}`)()
}

function installRequire(frappe: Any) {
  frappe.require = async (items: Any, callback?: Any) => {
    const list: string[] = typeof items === "string" ? [items] : items ?? []
    for (const item of list) {
      const url = await resolveAsset(item)
      if (loadedAssets.has(url)) continue
      loadedAssets.add(url)
      if (url.endsWith(".css")) {
        // Desk CSS assumes Bootstrap and would restyle Petal; skipped on purpose.
        continue
      }
      try {
        evalScript(await fetchText(url), item)
      } catch (e) {
        console.error(`[Petal compat] error in ${item}`, e)
      }
    }
    callback && callback()
  }
}

function installRouting(frappe: Any) {
  frappe.re_route = {}
  frappe.get_route = () => pathToRoute(typeof location !== "undefined" ? location.pathname : "/")
  frappe.get_route_str = () => frappe.get_route().join("/")
  frappe.get_prev_route = () => []
  frappe.router = {
    slug: (name: string) => (name || "").toLowerCase().replace(/ /g, "-"),
    set_route: (...args: Any[]) => frappe.set_route(...args),
    current_route: [],
    on: () => {},
  }
  frappe.set_route = (...args: Any[]) => {
    let route: Any[]
    if (args.length === 1 && Array.isArray(args[0])) route = args[0]
    else if (args.length === 1 && typeof args[0] === "string") {
      const s = args[0] as string
      const desk = s.startsWith("/app") || s.startsWith("#") ? deskUrlToPath(s) : null
      if (desk) { options?.navigate(desk); return Promise.resolve() }
      route = s.replace(/^#/, "").split("/")
    } else route = args
    if (route.length && typeof route[route.length - 1] === "object" && route[route.length - 1] !== null) {
      frappe.route_options = route.pop()
    }
    const view = String(route[0] ?? "").toLowerCase()
    if (view === "print") {
      const url = proxyUrl(`/printview?doctype=${encodeURIComponent(route[1])}&name=${encodeURIComponent(route[2])}&trigger_print=1`)
      if (typeof window !== "undefined") window.open(url, "_blank")
      return Promise.resolve()
    }
    options?.navigate(routeToPath(route))
    return Promise.resolve()
  }
}

function installRealtime(frappe: Any) {
  const subs = new Map<Any, Promise<() => void>>()
  frappe.realtime = {
    on(event: string, cb: Any) {
      if (!options?.realtimeOn) return
      subs.set(cb, options.realtimeOn(event, cb))
    },
    off(_event: string, cb?: Any) {
      if (cb && subs.has(cb)) {
        void subs.get(cb)!.then((un) => un())
        subs.delete(cb)
      }
    },
    publish() {}, emit() {}, doc_subscribe() {}, doc_unsubscribe() {}, doc_open() {}, doc_close() {},
    list_subscribe() {}, list_unsubscribe() {}, subscribe() {},
  }
}

// ── Documents ────────────────────────────────────────────────────────────────

/** Load a doctype's metadata (and its children) into locals, like with_doctype. */
export async function loadDoctype(doctype: string): Promise<Any> {
  const frappe = g.frappe
  if (g.locals.DocType[doctype]?.__petal_full) return g.locals.DocType[doctype]
  const r = await frappe.call({ method: "frappe.desk.form.load.getdoctype", args: { doctype, with_parent: 1 } })
  const docs: Any[] = r?.docs ?? []
  for (const d of docs) if (!d.doctype) d.doctype = "DocType"
  frappe.model.sync(docs)
  const meta = g.locals.DocType[doctype]
  if (meta) {
    meta.__petal_full = true
    frappe.model.init_doctype(doctype)
  }
  return meta
}

export type OpenResult = { frm: Form; docname: string }

/**
 * Open a document in its doctype's Form and run Desk's load sequence
 * (setup → before_load/onload → refresh → onload_post_render).
 * `name === "new"` creates a fresh local doc with defaults.
 */
export type OpenOptions = {
  /** Resolve once the form is drawn; refresh handlers run after it (see Form.refresh). */
  waitForLayout?: (frm: Form) => Promise<void>
}

export async function openDoc(doctype: string, name: string, opts: OpenOptions = {}): Promise<OpenResult> {
  const frappe = g.frappe
  await loadDoctype(doctype)
  let docname = name
  if (name === "new") {
    docname = frappe.model.get_new_doc(doctype, null, null, true).name
  } else {
    const local = g.locals[doctype]?.[name]
    const fresh = local && (local.__islocal || local.__unsaved || frappe.model.get_docinfo(doctype, name))
    if (!fresh) {
      const r = await frappe.call({ method: "frappe.desk.form.load.getdoc", args: { doctype, name } })
      if (!r?.docs?.length) throw new Error(`${doctype} ${name} not found`)
    }
  }
  const frm = getForm(doctype)
  await frm.refresh(docname, opts.waitForLayout ? { waitForLayout: opts.waitForLayout } : undefined)
  return { frm, docname }
}

/** Re-fetch a saved document from the server and re-render. */
export async function reloadDoc(frm: Form) {
  await g.frappe.call({ method: "frappe.desk.form.load.getdoc", args: { doctype: frm.doctype, name: frm.docname } })
  await frm.refresh(frm.docname)
}

/** Plain copy of a document for React (rows copied so identity changes). */
export function snapshotDoc(doc: Any): Record<string, unknown> {
  if (!doc) return {}
  const out: Any = {}
  for (const [k, v] of Object.entries(doc)) {
    out[k] = Array.isArray(v) ? v.map((r: Any) => (r && typeof r === "object" ? { ...r } : r)) : v
  }
  return out
}

const BOOL_PROPS = ["hidden", "read_only", "reqd", "bold", "in_list_view", "collapsible", "allow_on_submit"]

function normalize(df: Any): Any {
  const out = { ...df }
  for (const p of BOOL_PROPS) if (p in out) out[p] = g.cint(out[p]) ? 1 : 0
  return out
}

/** Docfields for the open document, with script overrides applied. */
export function effectiveFields(frm: Form): Any[] {
  return g.frappe.meta.get_docfields(frm.doctype, frm.docname).map(normalize)
}

/** Child-table docfields (grid-level overrides) keyed by child doctype. */
export function effectiveChildFields(frm: Form): Record<string, Any[]> {
  const out: Record<string, Any[]> = {}
  for (const df of g.frappe.meta.get_table_fields(frm.doctype)) {
    out[df.options] = g.frappe.meta.get_docfields(df.options, frm.docname).map(normalize)
  }
  return out
}

/** Link search through frappe.desk.search.search_link with the field's set_query. */
export async function searchLink(frm: Form, fieldname: string, txt: string, table?: string, rowName?: string): Promise<Array<{ value: string; description?: string; label?: string }>> {
  const args = frm.get_link_search_args(fieldname, txt, table, rowName)
  if (!args || !args.doctype) return []
  const r = await g.frappe.call({ method: "frappe.desk.search.search_link", args }).catch(() => null)
  const list = r?.message ?? r?.results ?? []
  return Array.isArray(list) ? list : []
}

/** Value set from Petal's UI: frappe.model.set_value with the field's type (runs triggers). */
export function setFieldFromUI(frm: Form, fieldname: string, value: Any) {
  const df = g.frappe.meta.get_docfield(frm.doctype, fieldname, frm.docname)
  if (df && ["Table", "Table MultiSelect"].includes(df.fieldtype)) {
    return frm.apply_table_rows(fieldname, Array.isArray(value) ? value : [])
  }
  return g.frappe.model.set_value(frm.doctype, frm.docname, fieldname, value, df?.fieldtype)
}

export function triggerButton(frm: Form, fieldname: string, cdt?: string, cdn?: string) {
  return frm.script_manager.trigger(fieldname, cdt, cdn).finally(notifyForms)
}

export { attachFormRoot } from "./form"
export { CompatListView, listSettingsFor, runListOnload, runListRefresh, type ListAction, type ListSettings } from "./list"
export { AppPage, openDeskPage, type DeskPage, type PageAction } from "./page"
export { CompatQueryReport, openQueryReport, parseColumn as parseReportColumn, type ReportColumn } from "./report"
