/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Script and query reports with their real `frappe.query_reports[name]`
 * settings, following frappe/public/js/frappe/views/reports/query_report.js:
 * the report's filters are Desk controls in the page's form bar (default,
 * get_query, on_change, depends_on), onload(report) runs before the first
 * refresh, and cells go through the report's formatter. Petal draws the
 * header and the results table; `frappe.query_report` is this object, so
 * scripts' get_filter_value / set_filter_value / refresh calls work.
 */
import { __, type Any } from "./env"
import { loadDeskControls } from "./desk-controls"
import { AppPage } from "./page"

const g: Any = typeof window !== "undefined" ? window : globalThis

export type ReportColumn = { fieldname: string; label: string; fieldtype: string; options?: string; width?: number; [k: string]: Any }

/** "Label:Fieldtype/Options:Width" → column (query_report.js prepare_columns). */
export function parseColumn(c: Any, i: number): ReportColumn {
  if (typeof c !== "string") {
    return { ...c, fieldname: c.fieldname || c.id || g.frappe.scrub(c.label || `col_${i}`), label: c.label ?? c.fieldname ?? "", fieldtype: c.fieldtype || "Data" }
  }
  const [label = "", typeAndOptions = "Data", width] = c.split(":")
  const [fieldtype = "Data", options] = typeAndOptions.split("/")
  return { label, fieldtype: fieldtype || "Data", ...(options ? { options } : {}), ...(width ? { width: parseInt(width) } : {}), fieldname: g.frappe.scrub(label) || `col_${i}` }
}

export class CompatQueryReport {
  [k: string]: Any
  report_name: string
  report_doc: Any = null
  report_settings: Any = {}
  wrapper: HTMLElement
  page: AppPage
  filters: Any[] = []
  columns: ReportColumn[] = []
  data: Any[] = []
  raw_data: Any = null
  message = ""
  loading = false
  error: string | null = null
  _no_refresh = false
  previous_filters: Any = null
  private listeners = new Set<() => void>()
  private runSeq = 0

  constructor(report_name: string) {
    this.report_name = report_name
    this.wrapper = document.createElement("div")
    this.wrapper.className = "petal-desk petal-desk-report"
    this.page = new AppPage({ parent: this.wrapper, title: __(report_name), single_column: true })
    this.$page = this.page.wrapper
    this.datatable = null
    this.chart = null
  }

  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn) } }
  emit() { for (const fn of this.listeners) fn() }

  /** Load the report and its script, set up filters, run onload, then refresh. */
  async load() {
    const frappe = g.frappe
    frappe.query_report = this
    await loadDeskControls()
    const r = await frappe.call({ method: "frappe.desk.form.load.getdoc", args: { doctype: "Report", name: this.report_name } })
    this.report_doc = g.locals.Report?.[this.report_name] ?? r?.docs?.[0] ?? {}
    if (this.report_doc.ref_doctype) await frappe.model.with_doctype(this.report_doc.ref_doctype).catch(() => {})
    if (!frappe.query_reports[this.report_name]) {
      const settings = await frappe.xcall("frappe.desk.query_report.get_script", { report_name: this.report_name })
      try { frappe.dom.eval(settings?.script || "") } catch (e) { console.error(`[Petal compat] report ${this.report_name} script`, e) }
      await frappe.after_ajax()
      const scriptName = this.report_doc.report_type === "Custom Report"
        ? settings?.custom_report_name || this.report_doc.reference_report
        : this.report_name
      const rs = frappe.query_reports[scriptName] || {}
      rs.html_format = settings?.html_format
      rs.execution_time = settings?.execution_time || 0
      frappe.query_reports[this.report_name] = rs
    }
    this.report_settings = frappe.query_reports[this.report_name]
    if (!this.report_settings.filters && this.report_doc.filters?.length) this.report_settings.filters = this.report_doc.filters
    this.page.set_title(__(this.report_name))
    this.setup_filters()
    this._no_refresh = true
    this.set_route_filters()
    try { await this.report_settings.onload?.(this) } catch (e) { console.error(`[Petal compat] report ${this.report_name} onload`, e) }
    this._no_refresh = false
    await this.refresh()
  }

  // ── filters (query_report.js setup_filters) ─────────────────────────────
  setup_filters() {
    this.page.clear_fields()
    const filters: Any[] = this.report_settings.filters ?? []
    this.filters = filters
      .map((df) => {
        if (df.fieldtype === "Break") return null
        if (df.mandatory) df.reqd = 1
        let f = this.page.add_field(df, this.page.page_form)
        if (!f) return null
        if (df.default) f.set_input(df.default)
        if (df.get_query) f.get_query = df.get_query
        if (df.on_change) f.on_change = df.on_change
        df.onchange = () => {
          this.refresh_filters_dependency()
          const current = this.get_filter_values()
          if (this.previous_filters && JSON.stringify(this.previous_filters) === JSON.stringify(current)) return
          this.previous_filters = current
          setTimeout(() => (this.previous_filters = null), 10000)
          if (f.on_change) f.on_change(this)
          else if (!this._no_refresh) void this.refresh(true)
        }
        f = Object.assign(f, df)
        return f
      })
      .filter(Boolean)
    this.refresh_filters_dependency()
    if (this.filters.length === 0) this.page.hide_form()
    else this.page.show_form()
  }

  set_route_filters(route_options?: Any) {
    const opts = route_options ?? g.frappe.route_options
    if (!opts) return
    for (const f of this.filters) if (f.df.fieldname in opts) f.set_input(opts[f.df.fieldname])
    g.frappe.route_options = null
  }

  refresh_filters_dependency() {
    for (const filter of this.filters) {
      filter.guardian_has_value = true
      if (!filter.df.depends_on) continue
      filter.guardian_has_value = this.evaluate_depends_on_value(filter.df.depends_on, filter.df.label)
      if (filter.guardian_has_value) {
        if (filter.df.hidden_due_to_dependency) {
          filter.df.hidden_due_to_dependency = false
          this.toggle_filter_display(filter.df.fieldname, false)
        }
      } else if (!filter.df.hidden_due_to_dependency) {
        filter.df.hidden_due_to_dependency = true
        this.toggle_filter_display(filter.df.fieldname, true)
        filter.set_value(filter.df.default || null)
      }
    }
  }

  evaluate_depends_on_value(expression: Any, label: string) {
    const doc = this.get_filter_values()
    if (typeof expression === "boolean") return expression
    if (String(expression).startsWith("eval:")) {
      try { return !!g.frappe.utils.eval(String(expression).slice(5), { doc }) } catch {
        console.warn(`[Petal compat] invalid depends_on in filter ${label}`)
        return true
      }
    }
    const v = doc[expression]
    return Array.isArray(v) ? !!v.length : !!v
  }

  toggle_filter_display(fieldname: string, flag: boolean) {
    this.page.wrapper.find(`div[data-fieldname="${fieldname}"]`).toggleClass("hide-control hidden", flag)
  }

  get_filter_values(raise?: boolean) {
    const mandatory = this.filters.filter((f) => f.df.reqd || f.df.mandatory)
    const missing = mandatory.filter((f) => !f.get_value())
    if (raise && missing.length) {
      this.message = __("Please set filters")
      this.data = []
      this.emit()
      throw new Error("Filter missing")
    }
    if (raise) this.message = ""
    const out: Any = {}
    for (const f of this.filters) {
      let v = f.get_value?.()
      if (!v) continue
      if (f.df.hidden) v = f.value
      if (v === "%") v = null
      if (f.df.wildcard_filter) v = `%${v}%`
      out[f.df.fieldname] = v
    }
    return out
  }
  get_values() { return this.get_filter_values() }
  get_filter(fieldname: string) { return this.filters.find((f) => f.df.fieldname === fieldname) }
  get_filter_value(fieldname: string) { return this.get_filter(fieldname)?.get_value() ?? null }
  set_filter_value(fieldname: string | Record<string, Any>, value?: Any) {
    const map = typeof fieldname === "string" ? { [fieldname]: value } : fieldname
    const keys = Object.keys(map)
    this._no_refresh = true
    keys.forEach((k, i) => {
      if (i === keys.length - 1) this._no_refresh = false
      this.get_filter(k)?.set_value(map[k])
    })
  }

  // ── running (query_report.js refresh) ───────────────────────────────────
  async refresh(_have_filters_changed?: boolean) {
    let filters: Any
    try { filters = this.get_filter_values(true) } catch { return }
    const seq = ++this.runSeq
    this.loading = true
    this.error = null
    this.emit()
    try {
      const r = await g.frappe.call({
        method: "frappe.desk.query_report.run",
        type: "GET",
        args: {
          report_name: this.report_name,
          filters,
          ignore_prepared_report: 1,
          is_tree: this.report_settings.tree,
          parent_field: this.report_settings.parent_field,
        },
      })
      if (seq !== this.runSeq) return
      const data = r?.message ?? {}
      this.raw_data = data
      this.columns = (data.columns ?? []).map(parseColumn)
      this.data = this.prepare_data(data.result ?? [])
      if (data.message) this.message = String(data.message)
      this.total_row = data.add_total_row && !data.skip_total_row ? data.result?.[data.result.length - 1] : null
    } catch (e: Any) {
      if (seq === this.runSeq) this.error = e?.message ?? String(e)
    } finally {
      if (seq === this.runSeq) {
        this.loading = false
        this.emit()
      }
    }
  }

  /** Rows as objects keyed by fieldname, as Desk's prepare_data does. */
  prepare_data(rows: Any[]) {
    return rows.map((row) => {
      if (!Array.isArray(row)) return row
      const out: Any = {}
      this.columns.forEach((c, i) => { out[c.fieldname] = row[i] })
      return out
    })
  }

  /** The cell's HTML: the report's formatter, or Frappe's default formatting. */
  format_cell(value: Any, rowIndex: number, column: ReportColumn, data: Any): string {
    const frappe = g.frappe
    const default_formatter = (v: Any, _row: Any, col: Any, d: Any) => frappe.format(v, col, { for_print: false, always_show_decimals: true }, d)
    const row = this.columns.map((c) => ({ content: data?.[c.fieldname] }))
    ;(row as Any).meta = { rowIndex }
    try {
      if (this.report_settings.formatter) return String(this.report_settings.formatter(value, row, column, data, default_formatter) ?? "")
      return String(default_formatter(value, row, column, data) ?? "")
    } catch (e) {
      console.warn(`[Petal compat] ${this.report_name} formatter`, e)
      return frappe.utils.escape_html(String(value ?? ""))
    }
  }

  // Desk APIs scripts call that Petal's table doesn't need
  get_checked_items() { return [] }
  toggle_message(flag: boolean, message?: string) { this.message = flag && message ? message : ""; this.emit() }
  show_loading_screen() {}
  hide_loading_screen() {}
  set_breadcrumbs() {}
  render_chart() {}
  make_chart() {}
}

/** Open a report, register it as frappe.query_report, and start loading it. */
export function openQueryReport(name: string): CompatQueryReport {
  const report = new CompatQueryReport(name)
  g.frappe.query_report = report
  return report
}
