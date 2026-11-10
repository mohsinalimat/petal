/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Desk's widgets, backed by the same libraries Desk uses: frappe.Chart is
 * frappe-charts, frappe.DataTable is frappe-datatable, frappe.ui.Scanner uses
 * html5-qrcode, and frappe.ui.Tree is Frappe's own tree.js (plain jQuery,
 * loaded from the bench by index.ts).
 *
 * Scripts usually build widgets into elements Petal hasn't put on screen yet
 * (dashboard sections, dialog fields, HTML fields). Charts measure their
 * container when drawn, so they wait until the element is in the document;
 * tables are built at once (scripts read them straight back) and re-measured
 * when it appears.
 */
import { __, type Any } from "./env"

const g: Any = typeof window !== "undefined" ? window : globalThis

type Libs = { Chart: Any; DataTable: Any }
let libs: Libs | null = null
let libsLoading: Promise<Libs | null> | null = null

/** Load frappe-charts and frappe-datatable (once, in the background). */
export function loadWidgetLibs(): Promise<Libs | null> {
  if (libs) return Promise.resolve(libs)
  if (!libsLoading) {
    libsLoading = Promise.all([import("frappe-charts"), import("frappe-datatable")])
      .then(([charts, dt]: Any[]) => {
        libs = { Chart: charts.Chart ?? charts.default?.Chart, DataTable: dt.default ?? dt }
        return libs
      })
      .catch((e) => {
        console.error("[Petal compat] could not load chart/table libraries", e)
        libsLoading = null
        return null
      })
  }
  return libsLoading
}

// ── Wait for an element to be attached ──────────────────────────────────────
const waiting = new Map<Element, Array<() => void>>()
let observer: MutationObserver | null = null

function flushWaiting() {
  for (const [el, cbs] of waiting) {
    if (!el.isConnected) continue
    waiting.delete(el)
    for (const cb of cbs) {
      try { cb() } catch (e) { console.error("[Petal compat]", e) }
    }
  }
  if (!waiting.size && observer) { observer.disconnect(); observer = null }
}

/** Run `cb` once `el` is in the document (now, if it already is). */
export function whenConnected(el: Element, cb: () => void): void {
  if (el.isConnected) { cb(); return }
  if (typeof MutationObserver === "undefined" || typeof document === "undefined") return
  const list = waiting.get(el) ?? []
  list.push(cb)
  waiting.set(el, list)
  if (!observer) {
    observer = new MutationObserver(flushWaiting)
    observer.observe(document.documentElement, { childList: true, subtree: true })
  }
}

function toElement(parent: Any): Element | null {
  if (!parent) return null
  if (typeof parent === "string") return typeof document !== "undefined" ? document.querySelector(parent) : null
  if (parent.jquery) return parent[0] ?? null
  return parent instanceof Element ? parent : null
}

/**
 * A chart that is drawn once its element is on screen and the library is
 * loaded. Until then, method calls (update, addDataPoint, …) are queued and
 * replayed on the real chart.
 */
function deferred(make: () => Any, el: Element | null): Any {
  let real: Any = null
  const queue: Array<[string | symbol, Any[]]> = []
  const start = () => {
    void loadWidgetLibs().then((l) => {
      if (!l) return
      try {
        real = make()
        for (const [k, a] of queue.splice(0)) real?.[k]?.(...a)
      } catch (e) { console.error("[Petal compat] chart", e) }
    })
  }
  if (el) whenConnected(el, start)
  return new Proxy({}, {
    get(_t, k) {
      if (real) { const v = real[k]; return typeof v === "function" ? v.bind(real) : v }
      if (k === "then") return undefined
      if (k === "parent") return el
      return (...a: Any[]) => { queue.push([k, a]) }
    },
    set(_t, k, v) { if (real) real[k] = v; return true },
  })
}

/** frappe.Chart: `new frappe.Chart(parent, options)` as in frappe-charts. */
function makeChartClass(): Any {
  return class Chart {
    constructor(parent: Any, options: Any) {
      const el = toElement(parent)
      const make = () => new libs!.Chart(el, options)
      // Constructors that return an object replace `this`, which is what
      // frappe-charts itself does (it returns the chart for options.type).
      if (libs && el?.isConnected) return make()
      return deferred(make, el)
    }
  }
}

/** frappe.DataTable: built immediately so scripts can read rows back. */
function makeDataTableClass(): Any {
  const Stub = class {
    [k: string]: Any
    constructor(_wrapper: Any, options: Any = {}) {
      this.options = options
      this.datamanager = { rows: [], getRows: () => [], data: options.data ?? [] }
      this.rowmanager = { checkMap: [], getCheckedRows: () => [], checkAll() {}, checkRow() {} }
      this.columnmanager = { applyDefaultSortOrder() {} }
      this.style = { setStyle() {} }
      console.warn("[Petal compat] DataTable library not loaded yet")
    }
    refresh() {} destroy() {} getColumns() { return [] } getRows() { return [] } setDimensions() {} on() {}
  }
  return class DataTable {
    constructor(wrapper: Any, options: Any) {
      if (!libs) return new Stub(wrapper, options)
      const el = toElement(wrapper)
      if (!el || el.isConnected) return new libs.DataTable(el, options)
      // frappe-datatable keeps column widths in a <style> it inserts next to the
      // table, and browsers only create a stylesheet for an attached <style>.
      // Build it in an off-screen holder, put the element back, and re-apply the
      // styles (setDimensions re-inserts every rule) once it's really shown.
      const table = withTemporaryAttach(el, () => new libs!.DataTable(el, options))
      guardDetachedStyles(table)
      whenConnected(el, () => { try { table.setDimensions?.() } catch (e) { console.warn("[Petal compat] DataTable", e) } })
      return table
    }
  }
}

/**
 * While a table is off screen, scripts keep calling refresh() etc., which read
 * the table's stylesheet. Give the library a scratch sheet instead of null; the
 * real rules are re-inserted by setDimensions() when the table is shown.
 */
function guardDetachedStyles(table: Any) {
  const proto = table?.style && Object.getPrototypeOf(table.style)
  if (!proto || proto.__petal_guarded) return
  const desc = Object.getOwnPropertyDescriptor(proto, "stylesheet")
  if (!desc?.get) return
  const original = desc.get
  Object.defineProperty(proto, "stylesheet", {
    configurable: true,
    get(this: Any) {
      const sheet = original.call(this)
      if (sheet) return sheet
      const rules: Any[] = []
      return (this.__petal_scratch ??= {
        cssRules: rules,
        insertRule: (rule: string, i = rules.length) => { rules.splice(i, 0, { cssText: rule, selectorText: rule.split("{")[0]?.trim() }); return i },
        deleteRule: (i: number) => { rules.splice(i, 1) },
      })
    },
  })
  proto.__petal_guarded = true
}

/** Run `fn` with `el` attached to the document (off screen), then put it back. */
function withTemporaryAttach<T>(el: Element, fn: () => T): T {
  if (typeof document === "undefined" || !document.body) return fn()
  const parent = el.parentNode
  const next = el.nextSibling
  const holder = document.createElement("div")
  holder.setAttribute("aria-hidden", "true")
  holder.style.cssText = "position:absolute;left:-10000px;top:0;width:960px;visibility:hidden;pointer-events:none"
  document.body.appendChild(holder)
  holder.appendChild(el)
  try {
    return fn()
  } finally {
    if (parent) parent.insertBefore(el, next)
    else el.remove()
    holder.remove()
  }
}

// ── Number shortening for chart axes (utils/number_systems.js) ──────────────
const NUMBER_SYSTEMS: Record<string, Array<{ divisor: number; symbol: string }>> = {
  default: [{ divisor: 1.0e12, symbol: "T" }, { divisor: 1.0e9, symbol: "B" }, { divisor: 1.0e6, symbol: "M" }, { divisor: 1.0e3, symbol: "K" }],
  indian: [{ divisor: 1.0e7, symbol: "Cr" }, { divisor: 1.0e5, symbol: "L" }, { divisor: 1.0e3, symbol: "K" }],
  nepalese: [{ divisor: 1.0e11, symbol: "Kh" }, { divisor: 1.0e9, symbol: "Ar" }, { divisor: 1.0e7, symbol: "Cr" }, { divisor: 1.0e5, symbol: "L" }, { divisor: 1.0e3, symbol: "K" }],
}

function numberSystem(country?: string) {
  if (["Bangladesh", "India", "Myanmar", "Pakistan"].includes(country ?? "")) return NUMBER_SYSTEMS.indian!
  if (country === "Nepal") return NUMBER_SYSTEMS.nepalese!
  return NUMBER_SYSTEMS.default!
}

function decimals(n: number): number {
  return Math.floor(n) === n ? 0 : (n.toString().split(".")[1]?.length ?? 0)
}

export function shortenNumber(number: number, country?: string, min_length = 4, max_no_of_decimals = 2): string {
  const digits = String(number).match(/\d/g)?.length ?? 0
  if (digits < min_length) return String(number)
  const x = Math.abs(Math.round(number))
  if (x.toString().length < min_length) return x.toString()
  for (const map of numberSystem(country)) {
    if (x >= map.divisor) {
      const r = number / map.divisor
      return (decimals(r) > max_no_of_decimals ? r.toFixed(max_no_of_decimals) : r) + " " + __(map.symbol)
    }
  }
  return number.toFixed(max_no_of_decimals)
}

// ── Icons the tree and scanner ask for (Desk's sprite isn't loaded) ─────────
const ICON_PATHS: Record<string, string> = {
  "folder-open": '<path d="M2.5 5.5v8a1 1 0 0 0 1 1h9.6a1 1 0 0 0 .95-.68l1.6-4.8a.5.5 0 0 0-.47-.66H5.2a1 1 0 0 0-.95.68L2.5 13.5M2.5 5.5v-2a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1V8" fill="none" stroke="currentColor"/>',
  "folder-normal": '<path d="M2.5 4a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" fill="none" stroke="currentColor"/>',
  "primitive-dot": '<circle cx="8" cy="8" r="2.5" fill="currentColor"/>',
  "scan": '<path d="M2.5 5V3.5a1 1 0 0 1 1-1H5M11 2.5h1.5a1 1 0 0 1 1 1V5M13.5 11v1.5a1 1 0 0 1-1 1H11M5 13.5H3.5a1 1 0 0 1-1-1V11M2.5 8h11" fill="none" stroke="currentColor"/>',
}

export function iconSvg(name: string, size: Any = "sm", icon_class = "", icon_style = ""): string {
  const px: Record<string, number> = { xs: 12, sm: 16, md: 20, base: 20, lg: 24, xl: 32 }
  const style = typeof size === "object"
    ? `width:${size.width};height:${size.height};${icon_style}`
    : `width:${px[size] ?? 16}px;height:${px[size] ?? 16}px;${icon_style}`
  const sizeClass = typeof size === "object" ? "" : `icon-${size}`
  const inner = ICON_PATHS[name] ?? ""
  return `<svg class="icon ${sizeClass} ${icon_class}" style="${style}" viewBox="0 0 16 16" data-icon="${name.replace(/"/g, "")}" aria-hidden="true">${inner}</svg>`
}

export function installWidgets(frappe: Any) {
  frappe.Chart = makeChartClass()
  frappe.DataTable = makeDataTableClass()
  g.DataTable = frappe.DataTable

  // frappe/public/js/frappe/ui/chart.js
  frappe.ui.RealtimeChart = class RealtimeChart {
    constructor(element: Any, socketEvent: string, maxLabelPoints = 8, data: Any) {
      const chart: Any = new frappe.Chart(element, data)
      if (data.data.datasets[0].values.length > maxLabelPoints) {
        frappe.throw(__("Length of passed data array is greater than value of maximum allowed label points!"))
      }
      let currentSize = data.data.datasets[0].values.length
      chart.start_updating = () => frappe.realtime.on(socketEvent, (d: Any) => chart.update_chart(d.label, d.points))
      chart.stop_updating = () => frappe.realtime.off(socketEvent)
      chart.update_chart = (label: string, points: Any) => {
        if (currentSize >= maxLabelPoints) chart.removeDataPoint(0)
        else currentSize++
        chart.addDataPoint(__(label), points)
      }
      return chart
    }
  }

  // frappe/public/js/frappe/utils/utils.js
  Object.assign(frappe.utils, {
    shorten_number: shortenNumber,
    get_number_system: numberSystem,
    get_number_of_decimals: decimals,
    format_chart_axis_number: (label: number, country?: string) => shortenNumber(label, country || frappe.sys_defaults?.country, 3),
    set_space_label_ratio(chart_args: Any) {
      if (chart_args.data?.labels?.length > 10) chart_args.axisOptions = { ...chart_args.axisOptions, seriesLabelSpaceRatio: 0.9 }
    },
    make_chart(wrapper: Any, custom_options: Any = {}) {
      const chart_args: Any = {
        type: "bar",
        colors: ["light-blue"],
        axisOptions: { xIsSeries: 1, shortenYAxisNumbers: 1, xAxisMode: "tick", numberFormatter: frappe.utils.format_chart_axis_number },
      }
      for (const key in custom_options) {
        if (typeof chart_args[key] === "object" && typeof custom_options[key] === "object") chart_args[key] = Object.assign(chart_args[key], custom_options[key])
        else chart_args[key] = custom_options[key]
      }
      frappe.utils.set_space_label_ratio(chart_args)
      return new frappe.Chart(wrapper, chart_args)
    },
    icon: iconSvg,
  })

  // frappe/public/js/frappe/scanner/index.js
  frappe.ui.Scanner = class Scanner {
    [k: string]: Any
    constructor(options: Any) {
      this.dialog = null
      this.handler = null
      this.options = options
      this.is_alive = false
      if (!("multiple" in this.options)) this.options.multiple = false
      if (options.container) {
        this.$scan_area = g.$(options.container)
        this.scan_area_id = frappe.dom.set_unique_id(this.$scan_area)
      }
      if (options.dialog) {
        this.dialog = this.make_dialog()
        this.dialog.show()
      }
    }
    scan() { void this.load_lib().then(() => this.start_scan()) }
    start_scan() {
      if (!this.handler) this.handler = new g.Html5Qrcode(this.scan_area_id)
      this.handler
        .start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 250 },
          (_text: string, result: Any) => {
            if (this.options.on_scan) {
              try { this.options.on_scan(result) } catch (e) { console.error(e) }
            }
            if (!this.options.multiple) { this.stop_scan(); this.hide_dialog() }
          },
          () => { /* frame without a code */ },
        )
        .catch((err: Any) => {
          this.is_alive = false
          this.hide_dialog()
          frappe.msgprint({ title: __("Camera unavailable"), message: frappe.utils.escape_html(String(err?.message ?? err)), indicator: "orange" })
        })
      this.is_alive = true
    }
    stop_scan() {
      if (this.handler && this.is_alive) {
        void this.handler.stop().then(() => {
          this.is_alive = false
          this.$scan_area.empty()
          this.hide_dialog()
        })
      }
    }
    make_dialog() {
      const dialog = new frappe.ui.Dialog({
        title: __("Scan QRCode"),
        fields: [{ fieldtype: "HTML", fieldname: "scan_area" }],
        on_page_show: () => {
          this.$scan_area = dialog.get_field("scan_area").$wrapper
          this.$scan_area.addClass("barcode-scanner")
          this.scan_area_id = frappe.dom.set_unique_id(this.$scan_area)
          this.scan()
        },
        on_hide: () => this.stop_scan(),
      })
      return dialog
    }
    hide_dialog() { this.dialog && this.dialog.hide() }
    async load_lib() {
      if (!g.Html5Qrcode) {
        const mod: Any = await import("html5-qrcode")
        g.Html5Qrcode = mod.Html5Qrcode
      }
    }
  }
}
