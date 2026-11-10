/**
 * Dashboard Chart "Custom" sources.
 *
 * A Dashboard Chart with chart_type "Custom" has no document_type: its data
 * comes from a Dashboard Chart Source, whose settings live in a JS file
 * (`<app>/<module>/dashboard_chart_source/<name>/<name>.js`) that registers
 * `frappe.dashboards.chart_sources[name] = { method, filters }`. Desk fetches
 * that file via `dashboard_chart_source.get_config`, evals it, and calls
 * `method`. Sending such a chart to `dashboard_chart.get` instead makes Frappe
 * run `frappe.get_list(None, …)` → "'NoneType' object has no attribute 'name'".
 */

export type ChartSourceFilter = {
  fieldname: string
  label?: string
  fieldtype?: string
  options?: string | string[]
  default?: unknown
  reqd?: 0 | 1
}

export type ChartSourceSettings = {
  method: string
  filters?: ChartSourceFilter[]
}

export const CHART_SOURCE_CONFIG_METHOD =
  "frappe.desk.doctype.dashboard_chart_source.dashboard_chart_source.get_config"

/** `__("Text {0}", [x])` — Desk's translate helper, minus translation. */
function translate(text: string, args?: unknown[]): string {
  if (!args?.length) return String(text)
  return String(text).replace(/\{(\d+)\}/g, (m, i: string) => (args[Number(i)] !== undefined ? String(args[Number(i)]) : m))
}

/**
 * Evaluates a chart source config file against a minimal `frappe` shim and
 * returns what it registered for `sourceName` (null if it registered nothing).
 * `userDefaults` backs `frappe.defaults.get_user_default` (keys are matched
 * case-insensitively, e.g. "Company" → `company`).
 */
export function evalChartSource(
  code: string,
  sourceName: string,
  userDefaults: Record<string, unknown> = {},
): ChartSourceSettings | null {
  const lowered: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(userDefaults)) lowered[k.toLowerCase()] = v

  const shim: Record<string, unknown> = {
    dashboards: { chart_sources: {} as Record<string, ChartSourceSettings> },
    defaults: {
      get_user_default: (key: string) => userDefaults[key] ?? lowered[String(key).toLowerCase()],
      get_default: (key: string) => userDefaults[key] ?? lowered[String(key).toLowerCase()],
    },
    provide(namespace: string) {
      let node = shim
      for (const part of namespace.split(".").slice(namespace.startsWith("frappe.") ? 1 : 0)) {
        if (!node[part] || typeof node[part] !== "object") node[part] = {}
        node = node[part] as Record<string, unknown>
      }
      return node
    },
    _: translate,
  }

  // eslint-disable-next-line no-new-func
  new Function("frappe", "__", code + `\n//# sourceURL=petal-chart-source:///${encodeURIComponent(sourceName)}`)(shim, translate)

  const sources = (shim.dashboards as { chart_sources: Record<string, ChartSourceSettings> }).chart_sources
  const settings = sources[sourceName]
  return settings && typeof settings.method === "string" ? settings : null
}

/** Source filter defaults, overridden by the chart's own filters_json values. */
export function resolveSourceFilters(
  settings: ChartSourceSettings,
  chartFilters: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const f of settings.filters ?? []) {
    if (f.default !== undefined && f.default !== null && f.default !== "") out[f.fieldname] = f.default
  }
  for (const [k, v] of Object.entries(chartFilters)) {
    if (v !== undefined && v !== null && v !== "") out[k] = v
  }
  return out
}

/** Parses a Custom chart's filters_json, which Desk stores as a plain object. */
export function parseCustomChartFilters(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== "string") return {}
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    // Some charts store Desk's list form: [[doctype, field, "=", value, false], …]
    if (Array.isArray(parsed)) {
      const out: Record<string, unknown> = {}
      for (const e of parsed) if (Array.isArray(e) && e.length >= 4) out[String(e[1])] = e[3]
      return out
    }
  } catch { /* fall through */ }
  return {}
}

type MethodCaller = {
  callMethod<T>(method: string, args?: Record<string, unknown>, options?: { cache?: boolean }): Promise<T>
}

const settingsCache = new Map<string, Promise<ChartSourceSettings>>()

/** Loads (once per source per page load) a Custom chart source's settings. */
export function loadChartSource(
  api: MethodCaller,
  sourceName: string,
  userDefaults: Record<string, unknown> = {},
): Promise<ChartSourceSettings> {
  // When the Frappe-compat runtime is up it may already have the source registered.
  const live = (globalThis as { frappe?: { dashboards?: { chart_sources?: Record<string, ChartSourceSettings> } } })
    .frappe?.dashboards?.chart_sources?.[sourceName]
  if (live?.method) return Promise.resolve(live)

  const cached = settingsCache.get(sourceName)
  if (cached) return cached

  const promise = api
    .callMethod<string>(CHART_SOURCE_CONFIG_METHOD, { name: sourceName }, { cache: true })
    .then((code) => {
      const settings = evalChartSource(String(code ?? ""), sourceName, userDefaults)
      if (!settings) throw new Error(`Chart source "${sourceName}" did not register a method`)
      return settings
    })
  settingsCache.set(sourceName, promise)
  promise.catch(() => settingsCache.delete(sourceName))
  return promise
}
