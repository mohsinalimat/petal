"use client"
import { useCallback, useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useFrappe } from "@/hooks/useFrappe"
import { usePetalStore } from "@/store/petal-store"
import {
  NumberCard, Button,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuSeparator,
  InlineSelect, LinkField,
} from "@petal/ui"
import type { FrappeChartData } from "@petal/ui"
import type { FrappeDocument } from "@petal/sdk"
import Link from "next/link"
import dynamic from "next/dynamic"
import {
  MoreHorizontal, Filter, RefreshCw, Edit2, RotateCcw, ExternalLink,
} from "lucide-react"

// recharts is ~100 kB; most workspaces have no charts, so load it only when one renders.
const FrappeChart = dynamic(() => import("@petal/ui/frappe-chart").then((m) => m.FrappeChart), {
  ssr: false,
  loading: () => <div className="h-[220px] animate-pulse rounded-lg bg-muted/40" />,
})

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ShortcutType = "DocType" | "Report" | "URL" | "Dashboard" | string

type WorkspaceShortcut = {
  name: string
  label: string
  type: ShortcutType
  link_to: string | null
  url: string | null
  color: string | null
  format: string | null
  is_query_report?: number
}

type WorkspaceLink = {
  name: string
  type: "Card Break" | "Link" | string
  label: string
  link_type: string | null
  link_to: string | null
  hidden: 0 | 1
  is_query_report: 0 | 1
  description: string | null
  links?: WorkspaceLink[]
}

type WorkspaceChartItem = {
  chart_name: string
  label: string | null
  width: "Full" | "Half" | string
  name: string
}

type WorkspaceNumberCardItem = {
  number_card_name: string
  label: string | null
  width: "Full" | "Half" | string
  name: string
}

type WorkspacePageData = {
  shortcuts:    { items: WorkspaceShortcut[]       }
  cards:        { items: WorkspaceLink[]           }
  charts:       { items: WorkspaceChartItem[]      }
  number_cards: { items: WorkspaceNumberCardItem[] }
}

type WorkspaceMeta = {
  name: string
  title: string
  label?: string
  module?: string
  icon?: string
  /** JSON string — array of { type, data } blocks describing layout order */
  content?: string
  doctype: string
  owner: string
  creation: string
  modified: string
  docstatus: 0 | 1 | 2
}

type ChartDoc = FrappeDocument & Record<string, unknown>

type ReportChart = {
  data?: { labels?: string[]; datasets?: { name: string; values: number[] }[] }
  labels?: string[]
  datasets?: { name: string; values: number[] }[]
  type?: string
}

type FiscalYearDoc = FrappeDocument & { name: string }
type GLEntryDoc    = FrappeDocument & { company: string }

// ---------------------------------------------------------------------------
// Content-based layout ordering
// ---------------------------------------------------------------------------

const BLOCK_TO_SECTION: Record<string, string> = {
  chart:       "charts",
  number_card: "number_cards",
  shortcut:    "shortcuts",
  card:        "cards",
}

const DEFAULT_SECTION_ORDER = ["shortcuts", "charts", "number_cards", "cards"] as const

function parseSectionOrder(content: string | undefined): string[] {
  if (!content) return [...DEFAULT_SECTION_ORDER]
  try {
    const blocks = JSON.parse(content) as Array<{ type?: string }>
    const seen = new Set<string>()
    const order: string[] = []
    for (const b of blocks) {
      const s = b.type ? BLOCK_TO_SECTION[b.type] : undefined
      if (s && !seen.has(s)) { seen.add(s); order.push(s) }
    }
    // Append any section not referenced in content
    for (const s of DEFAULT_SECTION_ORDER) {
      if (!seen.has(s)) order.push(s)
    }
    return order
  } catch {
    return [...DEFAULT_SECTION_ORDER]
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortcutHref(s: WorkspaceShortcut): string {
  if (s.type === "URL" && s.url) return s.url
  if (!s.link_to) return "#"
  if (s.type === "Report")    return `/report/${encodeURIComponent(s.link_to)}`
  if (s.type === "Dashboard") return `/dashboard/${encodeURIComponent(s.link_to)}`
  return `/list/${encodeURIComponent(s.link_to)}`
}

function linkHref(l: WorkspaceLink): string {
  if (!l.link_to) return "#"
  if (l.link_type === "Report") return `/report/${encodeURIComponent(l.link_to)}`
  if (l.link_type === "Page")   return `/${encodeURIComponent(l.link_to)}`
  return `/list/${encodeURIComponent(l.link_to)}`
}

const COLOR_MAP: Record<string, string> = {
  Red:    "bg-red-100    text-red-700    dark:bg-red-900/30    dark:text-red-400",
  Green:  "bg-green-100  text-green-700  dark:bg-green-900/30  dark:text-green-400",
  Blue:   "bg-blue-100   text-blue-700   dark:bg-blue-900/30   dark:text-blue-400",
  Yellow: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  Purple: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  Grey:   "bg-muted      text-muted-foreground",
}
function colorClass(color: string | null) {
  return COLOR_MAP[color ?? ""] ?? "bg-primary/10 text-primary"
}

const TIME_INTERVALS = ["Yearly", "Quarterly", "Monthly", "Weekly", "Daily"] as const
const TIMESPANS = ["Last Year", "Last Quarter", "Last Month", "Last Week", "Select Date Range"] as const

// Infer field type from common Frappe fieldname patterns — used as fallback when the
// Report doc's filters child table is empty (Script Reports define filters in Python).
function inferFilterDef(key: string): { label: string; fieldtype: string; options?: string } {
  const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  if (key === "company")           return { label, fieldtype: "Link", options: "Company" }
  if (key === "cost_center")       return { label, fieldtype: "Link", options: "Cost Center" }
  if (key === "project")           return { label, fieldtype: "Link", options: "Project" }
  if (key === "currency")          return { label, fieldtype: "Link", options: "Currency" }
  if (key === "warehouse")         return { label, fieldtype: "Link", options: "Warehouse" }
  if (key === "supplier")          return { label, fieldtype: "Link", options: "Supplier" }
  if (key === "customer")          return { label, fieldtype: "Link", options: "Customer" }
  if (key === "territory")         return { label, fieldtype: "Link", options: "Territory" }
  if (key === "item_group")        return { label, fieldtype: "Link", options: "Item Group" }
  if (key === "item")              return { label, fieldtype: "Link", options: "Item" }
  if (key === "account")           return { label, fieldtype: "Link", options: "Account" }
  if (key === "payment_account")   return { label, fieldtype: "Link", options: "Account" }
  if (key.includes("fiscal_year")) return { label, fieldtype: "Link", options: "Fiscal Year" }
  if (key === "from_date" || key === "to_date" || key.endsWith("_date")) return { label, fieldtype: "Date" }
  return { label, fieldtype: "Data" }
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ShortcutCard({ s }: { s: WorkspaceShortcut }) {
  const isExternal = s.type === "URL"
  const href = shortcutHref(s)

  return (
    <Link
      href={href}
      target={isExternal ? "_blank" : undefined}
      rel={isExternal ? "noopener noreferrer" : undefined}
      className="flex items-center gap-3 p-4 bg-background border border-border rounded-xl
                 hover:border-primary/40 hover:shadow-md hover:bg-primary/5 transition-all group"
    >
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-sm font-bold shrink-0 ${colorClass(s.color)}`}>
        {s.label[0]}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-foreground group-hover:text-primary transition-colors truncate">
          {s.label}
        </p>
        {s.type === "Report" && (
          <span className="inline-flex items-center mt-1 px-2 py-px rounded-full text-[10px] font-medium bg-violet-50 text-violet-500 border border-violet-100 dark:bg-violet-900/15 dark:text-violet-400 dark:border-violet-800/50">
            Report
          </span>
        )}
      </div>
    </Link>
  )
}

function CardSection({ card }: { card: WorkspaceLink }) {
  const visibleLinks = (card.links ?? []).filter((l) => !l.hidden && l.link_to)

  return (
    <div className="bg-background border border-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-foreground">{card.label}</h3>
      </div>
      {visibleLinks.length === 0 ? (
        <p className="px-4 py-3 text-xs text-muted-foreground">No links</p>
      ) : (
        <div className="divide-y divide-border/50">
          {visibleLinks.map((link) => (
            <Link
              key={link.name}
              href={linkHref(link)}
              className="flex items-center gap-3 px-4 py-2.5 text-sm hover:bg-accent transition-colors group"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-primary/40 shrink-0 group-hover:bg-primary transition-colors" />
              <span className="flex-1 text-foreground/80 group-hover:text-foreground">
                {link.label || link.link_to}
              </span>
              {link.link_type === "Report" && (
                <span className="inline-flex items-center shrink-0 px-2 py-px rounded-full text-[10px] font-medium bg-violet-50 text-violet-500 border border-violet-100 dark:bg-violet-900/15 dark:text-violet-400 dark:border-violet-800/50">
                  Report
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ChartWidget — fully self-contained chart card
// ---------------------------------------------------------------------------

function ChartWidget({
  item,
  onNavigate,
}: {
  item: WorkspaceChartItem
  onNavigate: (path: string) => void
}) {
  const frappe = useFrappe()
  const { defaultCompany, defaultFiscalYear } = usePetalStore((s) => s.settings) as {
    defaultCompany?: string
    defaultFiscalYear?: string
  }
  const label = item.label || item.chart_name
  const isFull = item.width !== "Half"
  const storageKey = `petal:chart-filters:${item.chart_name}`

  // Core data state
  const [chartDoc, setChartDoc] = useState<ChartDoc | null>(null)
  const [data, setData]         = useState<FrappeChartData | null>(null)
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)

  // Timeseries controls (only relevant for non-Report, timeseries charts)
  const [timeInterval, setTimeInterval] = useState<string>("Monthly")
  const [timespan, setTimespan]         = useState<string>("Last Year")

  // Active filters: null means "use defaults"; object means user overrides
  const [activeFilters, setActiveFilters] = useState<Record<string, unknown> | null>(null)
  // The resolved filters from the last successful fetch (shown in dialog)
  const [resolvedFilters, setResolvedFilters] = useState<Record<string, unknown>>({})

  // Filter dialog state
  const [filterOpen, setFilterOpen]   = useState(false)
  const [filterDraft, setFilterDraft] = useState<Record<string, unknown>>({})
  const [filterFieldDefs, setFilterFieldDefs] = useState<Record<string, {
    label: string; fieldtype: string; options?: string
  }>>({})

  // -----------------------------------------------------------------------
  // Core fetch logic
  // -----------------------------------------------------------------------

  useEffect(() => {console.log("filterDraft", filterDraft)}, [filterDraft])

  const fetchChart = useCallback(async (
    doc: ChartDoc,
    opts: {
      timeInterval?: string
      timespan?: string
      useFilters?: Record<string, unknown> | null // null = use defaults; object = use directly
    } = {},
  ) => {
    setLoading(true)
    setError(null)

    try {
      let result: FrappeChartData

      if (doc.chart_type === "Report") {
        let reportFilters: Record<string, unknown>

        if (opts.useFilters !== undefined && opts.useFilters !== null) {
          // User explicitly provided filters — use them directly
          reportFilters = opts.useFilters
        } else {
          // Resolve from doc + inject defaults
          reportFilters = {}
          if (doc.filters_json) {
            try { reportFilters = JSON.parse(doc.filters_json as string) } catch { /* skip */ }
          }

          const needsFy =
            reportFilters.filter_based_on === "Fiscal Year" &&
            !reportFilters.from_fiscal_year &&
            !reportFilters.to_fiscal_year
          const needsCompany = !reportFilters.company

          if (needsFy) {
            const fy = defaultFiscalYear ?? (
              await frappe.getList<FiscalYearDoc>({
                doctype: "Fiscal Year",
                fields: ["name"],
                order_by: "year_start_date desc",
                limit: 1,
              }).then((r) => r[0]?.name).catch(() => undefined)
            )
            if (fy) reportFilters = { ...reportFilters, from_fiscal_year: fy, to_fiscal_year: fy }
          }

          if (needsCompany) {
            const co = defaultCompany ?? (
              await frappe.getList<GLEntryDoc>({
                doctype: "GL Entry",
                fields: ["company"],
                order_by: "posting_date desc",
                limit: 1,
              }).then((r) => r[0]?.company).catch(() => undefined)
            )
            if (co) reportFilters = { ...reportFilters, company: co }
          }
        }

        const reportResult = await frappe.callMethod<{ chart?: ReportChart }>(
          "frappe.desk.query_report.run",
          {
            report_name: doc.report_name as string,
            filters: reportFilters,
            ignore_prepared_report: true,
          },
          { cache: opts.useFilters == null },
        )

        const rc = reportResult?.chart
        const rcLabels   = rc?.data?.labels   ?? rc?.labels   ?? []
        const rcDatasets = rc?.data?.datasets ?? rc?.datasets ?? []
        const rcType     = rc?.type ?? "bar"

        if (!rcLabels.length && !rcDatasets.length) throw new Error("No chart data in report")

        result = { labels: rcLabels, datasets: rcDatasets, type: rcType }
        setResolvedFilters(reportFilters)

      } else {
        // Doctype-based chart
        const ti = (opts.timeInterval ?? (doc.time_interval as string)) || "Monthly"
        const ts = (opts.timespan    ?? (doc.timespan     as string)) || "Last Year"

        const callParams: Record<string, unknown> = {
          chart_name: doc.name,
          refresh: 1,
          time_interval: ti,
          timespan: ts,
        }

        const doctype = doc.document_type as string
        const resolvedKV: Record<string, unknown> = {}

        // Build filter list. Dialog always sends key-value; API expects array tuples.
        if (opts.useFilters) {
          const entries = Object.entries(opts.useFilters)
          if (entries.length > 0 && doctype) {
            callParams.filters = entries.map(([field, value]) => [doctype, field, "=", value, false])
          }
          Object.assign(resolvedKV, opts.useFilters)
        } else if (doc.filters_json && typeof doc.filters_json === "string") {
          try {
            const parsed = JSON.parse(doc.filters_json as string)
            if (Array.isArray(parsed) && parsed.length > 0) {
              callParams.filters = parsed
              for (const entry of parsed) {
                if (Array.isArray(entry) && entry.length >= 4) {
                  resolvedKV[entry[1] as string] = entry[3]
                }
              }
            } else if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              const entries = Object.entries(parsed)
              if (entries.length > 0 && doctype) {
                callParams.filters = entries.map(([field, value]) => [doctype, field, "=", value, false])
              }
              Object.assign(resolvedKV, parsed)
            }
          } catch { /* no filters */ }
        }

        setResolvedFilters(resolvedKV)

        result = await frappe.callMethod<FrappeChartData>(
          "frappe.desk.doctype.dashboard_chart.dashboard_chart.get",
          callParams,
          { cache: opts.useFilters == null },
        )
      }

      if (!result?.labels && !result?.datasets) throw new Error("Empty chart response")

      setData(result)
      setError(null)
    } catch (err) {
      console.error(`[ChartWidget] "${item.chart_name}":`, err)
      setData(null)
      setError(err instanceof Error ? err.message : "Could not load chart data.")
    } finally {
      setLoading(false)
    }
  }, [frappe, item.chart_name, defaultCompany, defaultFiscalYear])

  // Pre-load filter field definitions (fieldtype / label / options) so the
  // filter dialog shows the right controls immediately — no loading flash.
  const loadFilterFieldDefs = useCallback(async (doc: ChartDoc) => {
    console.log("[filterFieldDefs] called — chart_type:", doc.chart_type, "document_type:", doc.document_type, "report_name:", doc.report_name, "doc keys:", Object.keys(doc))
    if (doc.chart_type === "Report" && doc.report_name) {
      try {
        const reportDoc = await frappe.getDoc<FrappeDocument & Record<string, unknown>>(
          "Report", doc.report_name as string,
        )
        const filterRows = (reportDoc.filters as Array<Record<string, unknown>>) ?? []
        const defs: Record<string, { label: string; fieldtype: string; options?: string }> = {}
        for (const row of filterRows) {
          const fn = row.fieldname as string | undefined
          if (fn) {
            defs[fn] = {
              label: (row.label as string) || fn.replace(/_/g, " "),
              fieldtype: (row.fieldtype as string) || "Data",
              ...(row.options ? { options: row.options as string } : {}),
            }
          }
        }
        setFilterFieldDefs(defs)
      } catch { setFilterFieldDefs({}) }

    } else if (doc.document_type) {
      const doctype = doc.document_type as string
      const fieldNames = new Set<string>()
      for (const key of ["filters_json", "dynamic_filters_json"] as const) {
        const raw = doc[key]
        if (!raw || typeof raw !== "string") continue
        try {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed)) {
            for (const entry of parsed) {
              if (Array.isArray(entry) && entry.length >= 2) fieldNames.add(entry[1] as string)
            }
          } else if (parsed && typeof parsed === "object") {
            for (const fn of Object.keys(parsed as Record<string, unknown>)) fieldNames.add(fn)
          }
        } catch { /* ignore */ }
      }
      console.log("[filterFieldDefs] doctype:", doctype, "fieldNames:", [...fieldNames])
      if (fieldNames.size > 0) {
        try {
          const dtDoc = await frappe.getDoc<FrappeDocument & { fields: Array<Record<string, unknown>> }>(
            "DocType", doctype,
          )
          console.log("[filterFieldDefs] dtDoc.fields sample:", dtDoc.fields?.slice(0, 5))
          const defs: Record<string, { label: string; fieldtype: string; options?: string }> = {}
          for (const field of dtDoc.fields ?? []) {
            const fn = field.fieldname as string | undefined
            if (fn && fieldNames.has(fn)) {
              defs[fn] = {
                label: (field.label as string) || fn.replace(/_/g, " "),
                fieldtype: (field.fieldtype as string) || "Data",
                ...(field.options ? { options: field.options as string } : {}),
              }
            }
          }
          console.log("[filterFieldDefs] resolved defs:", defs)
          setFilterFieldDefs(defs)
        } catch (e) { console.error("[filterFieldDefs] fetch failed:", e); setFilterFieldDefs({}) }
      }
    }
  }, [frappe])

  // Initial load
  useEffect(() => {
    let restoredFilters: Record<string, unknown> | null = null
    let restoredTi: string | undefined
    let restoredTs: string | undefined
    try {
      const saved = sessionStorage.getItem(storageKey)
      if (saved) {
        const p = JSON.parse(saved) as { activeFilters?: Record<string, unknown> | null; timeInterval?: string; timespan?: string }
        restoredFilters = p.activeFilters ?? null
        restoredTi = p.timeInterval
        restoredTs = p.timespan
      }
    } catch { /* ignore */ }

    frappe
      .getDoc<ChartDoc>("Dashboard Chart", item.chart_name)
      .then((doc) => {
        setChartDoc(doc)
        const ti = restoredTi ?? ((doc.time_interval as string) || "Monthly")
        const ts = restoredTs ?? ((doc.timespan as string) || "Last Year")
        setTimeInterval(ti)
        setTimespan(ts)
        if (restoredFilters !== null) setActiveFilters(restoredFilters)
        void loadFilterFieldDefs(doc)
        return fetchChart(doc, { timeInterval: ti, timespan: ts, useFilters: restoredFilters })
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Could not load chart.")
        setLoading(false)
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.chart_name])

  // -----------------------------------------------------------------------
  // Action handlers
  // -----------------------------------------------------------------------

  const handleRefresh = () => {
    if (!chartDoc) return
    frappe.invalidate("exec:")
    fetchChart(chartDoc, {
      timeInterval,
      timespan,
      useFilters: activeFilters,
    })
  }

  const handleReset = () => {
    if (!chartDoc) return
    setActiveFilters(null)
    const ti = (chartDoc.time_interval as string) || "Monthly"
    const ts = (chartDoc.timespan as string) || "Last Year"
    setTimeInterval(ti)
    setTimespan(ts)
    try { sessionStorage.removeItem(storageKey) } catch { /* ignore */ }
    fetchChart(chartDoc, { timeInterval: ti, timespan: ts, useFilters: null })
  }

  const handleTimeIntervalChange = (v: string) => {
    setTimeInterval(v)
    if (!chartDoc) return
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ activeFilters, timeInterval: v, timespan }))
    } catch { /* ignore */ }
    fetchChart(chartDoc, { timeInterval: v, timespan, useFilters: activeFilters })
  }

  const handleTimespanChange = (v: string) => {
    setTimespan(v)
    if (!chartDoc) return
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ activeFilters, timeInterval, timespan: v }))
    } catch { /* ignore */ }
    if (v !== "Select Date Range") {
      fetchChart(chartDoc, { timeInterval, timespan: v, useFilters: activeFilters })
    }
  }

  const handleOpenFilter = () => {
    setFilterOpen(true)

    if (isReport && reportName) {
      // Seed draft from resolvedFilters or filters_json (object format for reports)
      if (Object.keys(resolvedFilters).length > 0) {
        setFilterDraft({ ...resolvedFilters })
      } else if (chartDoc?.filters_json) {
        try {
          const parsed = JSON.parse(chartDoc.filters_json as string)
          setFilterDraft(parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : {})
        } catch { setFilterDraft({}) }
      } else {
        setFilterDraft({})
      }

    } else if (chartDoc?.document_type) {
      // fieldname → current value (resolvedFilters overlays defaults from filters_json)
      const fieldMap = new Map<string, unknown>()
      for (const key of ["filters_json", "dynamic_filters_json"] as const) {
        const raw = chartDoc[key]
        if (!raw || typeof raw !== "string") continue
        try {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed)) {
            for (const entry of parsed) {
              if (Array.isArray(entry) && entry.length >= 4) {
                const fn = entry[1] as string
                if (!fieldMap.has(fn)) fieldMap.set(fn, entry[3] ?? "")
              }
            }
          } else if (parsed && typeof parsed === "object") {
            for (const [fn, val] of Object.entries(parsed as Record<string, unknown>)) {
              if (!fieldMap.has(fn)) fieldMap.set(fn, val ?? "")
            }
          }
        } catch { /* ignore */ }
      }
      for (const [fn, val] of Object.entries(resolvedFilters)) {
        fieldMap.set(fn, val)
      }
      setFilterDraft(Object.fromEntries(fieldMap))

    } else {
      setFilterDraft({})
    }
    // filterFieldDefs are pre-loaded on chart mount via loadFilterFieldDefs
  }

  const handleApplyFilters = () => {
    setActiveFilters(filterDraft)
    setFilterOpen(false)
    if (!chartDoc) return
    frappe.invalidate("exec:")
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ activeFilters: filterDraft, timeInterval, timespan }))
    } catch { /* ignore */ }
    fetchChart(chartDoc, {
      timeInterval,
      timespan,
      useFilters: filterDraft,
    })
  }

  // -----------------------------------------------------------------------
  // Derived UI state
  // -----------------------------------------------------------------------

  const isReport     = chartDoc?.chart_type === "Report"
  const isTimeseries = !isReport && Boolean(chartDoc?.timeseries)
  const hasCustomFilters = activeFilters !== null
  const reportName   = chartDoc?.report_name as string | undefined
  const documentType = chartDoc?.document_type as string | undefined
  const lastSynced   = chartDoc?.last_synced_on as string | undefined

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div
      className={`flex flex-col bg-background border border-border rounded-xl overflow-hidden
                  shadow-sm ${isFull ? "col-span-2" : ""}`}
    >
      {/* ── Header ── */}
      <div className="px-4 py-2.5 border-b border-border bg-muted/20 flex items-center gap-2 min-h-[44px]">
        {/* Title */}
        <h3 className="text-sm font-semibold text-foreground truncate flex-1 min-w-0">
          {label}
        </h3>

        {/* Timeseries controls (inline dropdowns for non-report timeseries charts) */}
        {isTimeseries && (
          <div className="flex items-center gap-1 shrink-0">
            <InlineSelect
              value={timeInterval}
              options={TIME_INTERVALS}
              onChange={handleTimeIntervalChange}
            />
            <InlineSelect
              value={timespan}
              options={TIMESPANS}
              onChange={handleTimespanChange}
            />
          </div>
        )}

        {/* Filter button */}
        <button
          onClick={handleOpenFilter}
          title="Set Filters"
          className={`relative p-1.5 rounded-md transition-colors shrink-0 ${
            hasCustomFilters
              ? "text-primary hover:bg-primary/10"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <Filter className="w-3.5 h-3.5" />
          {/* Active-filter indicator dot */}
          {hasCustomFilters && (
            <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-primary" />
          )}
        </button>

        {/* 3-dot actions menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              title="More options"
              className="p-1.5 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground
                         transition-colors shrink-0"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={handleRefresh} className="gap-2">
              <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
              Refresh
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() =>
                onNavigate(
                  `/form/Dashboard Chart/${encodeURIComponent(item.chart_name)}?edit=1`,
                )
              }
              className="gap-2"
            >
              <Edit2 className="w-3.5 h-3.5 text-muted-foreground" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={handleReset} className="gap-2">
              <RotateCcw className="w-3.5 h-3.5 text-muted-foreground" />
              Reset Chart
            </DropdownMenuItem>

            {(reportName || documentType) && <DropdownMenuSeparator />}

            {reportName && (
              <DropdownMenuItem
                onClick={() =>
                  onNavigate(`/report/${encodeURIComponent(reportName)}`)
                }
                className="gap-2"
              >
                <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="truncate">{reportName}</span>
              </DropdownMenuItem>
            )}
            {documentType && (
              <DropdownMenuItem
                onClick={() =>
                  onNavigate(`/list/${encodeURIComponent(documentType)}`)
                }
                className="gap-2"
              >
                <ExternalLink className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="truncate">{documentType} List</span>
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Last synced subtitle */}
      {lastSynced && (
        <div className="px-4 pt-1.5 pb-0 text-[10px] text-muted-foreground">
          Last synced {lastSynced}
        </div>
      )}

      {/* ── Body ── */}
      <div className="flex-1 p-4">
        {loading && (
          <div className="flex items-center justify-center gap-2 py-14 text-xs text-muted-foreground">
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            Loading chart…
          </div>
        )}
        {!loading && error && (
          <div className="flex flex-col items-center justify-center py-10 gap-3">
            <p className="text-xs text-muted-foreground text-center max-w-[220px] leading-relaxed">{error}</p>
            <button
              onClick={handleRefresh}
              className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
            >
              <RefreshCw className="w-3 h-3" />
              Retry
            </button>
          </div>
        )}
        {!loading && !error && data && (
          <FrappeChart data={{ ...data, type: (chartDoc?.type as string) || data.type }} height={220} />
        )}
        {!loading && !error && !data && (
          <div className="flex items-center justify-center py-14 text-xs text-muted-foreground">
            No data
          </div>
        )}
      </div>

      {/* ── Filter Dialog ── */}
      <Dialog open={filterOpen} onOpenChange={setFilterOpen}>
        <DialogContent
          className="max-w-md"
          onInteractOutside={(e) => {
            if ((e.target as HTMLElement).closest?.("[data-link-portal],[data-petal-popover]")) e.preventDefault()
          }}
        >
          <DialogHeader>
            <DialogTitle className="text-sm">
              Filters — {label}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-2.5 py-2 max-h-80 overflow-y-auto">
            {Object.keys(filterDraft).length === 0 ? (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No configurable filters for this chart.
              </p>
            ) : (
              Object.entries(filterDraft).map(([key, value]) => {
                const def = filterFieldDefs[key] ?? inferFilterDef(key)
                const fieldtype = def.fieldtype
                const fieldLabel = def.label
                const selectOptions = fieldtype === "Select" && def.options
                  ? def.options.split("\n").map((o) => o.trim()).filter(Boolean)
                  : []
                const inputCls =
                  "flex-1 h-7 text-xs px-2.5 border border-input rounded-md bg-background " +
                  "focus:outline-none focus:ring-1 focus:ring-primary transition"
                return (
                  <div key={key} className="flex items-center gap-3">
                    <label className="w-36 text-xs text-muted-foreground shrink-0 truncate capitalize" title={key}>
                      {fieldLabel}
                    </label>

                    {fieldtype === "Select" && selectOptions.length > 0 ? (
                      <select
                        value={String(value ?? "")}
                        onChange={(e) => setFilterDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                        className={inputCls}
                      >
                        <option value="">All…</option>
                        {selectOptions.map((opt) => (
                          <option key={opt} value={opt}>{opt}</option>
                        ))}
                      </select>
                    ) : fieldtype === "Link" ? (
                      <div className="flex-1">
                        <LinkField
                          value={String(value ?? "")}
                          onChange={(v) => setFilterDraft((prev) => ({ ...prev, [key]: v }))}
                          placeholder={`Search ${def?.options ?? fieldLabel}…`}
                          onSearch={async (q) => {
                            const dt = def?.options ?? ""
                            if (!dt) return []
                            if (q.trim()) {
                              const r = await frappe.callMethod<unknown>(
                                "frappe.desk.search.search_link",
                                { txt: q, doctype: dt, ignore_user_permissions: 0, reference_doctype: "" },
                              )
                              return Array.isArray(r)
                                ? r as { value: string; description?: string }[]
                                : ((r as Record<string, unknown>)?.results ?? []) as { value: string; description?: string }[]
                            }
                            const docs = await frappe.getList({ doctype: dt, fields: ["name"], limit: 10 })
                            return docs.map((d) => ({ value: String(d.name) }))
                          }}
                        />
                      </div>
                    ) : fieldtype === "Check" ? (
                      <div className="flex-1 flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={Boolean(value)}
                          onChange={(e) =>
                            setFilterDraft((prev) => ({ ...prev, [key]: e.target.checked ? 1 : 0 }))
                          }
                          className="h-4 w-4 rounded border-input accent-primary"
                        />
                      </div>
                    ) : fieldtype === "Date" ? (
                      <input
                        type="date"
                        value={String(value ?? "")}
                        onChange={(e) => setFilterDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                        className={inputCls}
                      />
                    ) : (
                      <input
                        type="text"
                        value={String(value ?? "")}
                        onChange={(e) => setFilterDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                        className={inputCls}
                      />
                    )}
                  </div>
                )
              })
            )}
          </div>

          <DialogFooter className="gap-2">
            {hasCustomFilters && (
              <Button
                variant="ghost"
                size="sm"
                className="mr-auto text-xs"
                onClick={() => {
                  handleReset()
                  setFilterOpen(false)
                }}
              >
                <RotateCcw className="w-3 h-3 mr-1" />
                Reset to defaults
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => setFilterOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleApplyFilters}>
              Apply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function WorkspacePage() {
  const params = useParams()
  const router = useRouter()
  const frappe = useFrappe()
  const name   = decodeURIComponent(params.name as string)

  const [meta,     setMeta]     = useState<WorkspaceMeta | null>(null)
  const [pageData, setPageData] = useState<WorkspacePageData | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    Promise.all([
      frappe.getDoc<WorkspaceMeta>("Workspace", name),
      frappe.callMethod<WorkspacePageData>("frappe.desk.desktop.get_desktop_page", {
        page: JSON.stringify({ name }),
      }, { cache: true }),
    ])
      .then(([doc, data]) => { setMeta(doc); setPageData(data) })
      .catch(() => setError("Could not load this workspace."))
      .finally(() => setLoading(false))
  }, [frappe, name])

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 w-48 bg-muted rounded" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-64 bg-muted rounded-xl" />)}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-16 bg-muted rounded-xl" />)}
        </div>
      </div>
    )
  }

  if (error || !pageData) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <p className="text-4xl mb-4">⚠️</p>
        <h2 className="text-lg font-semibold text-foreground mb-1">Workspace unavailable</h2>
        <p className="text-sm text-muted-foreground">{error ?? "Workspace not found."}</p>
      </div>
    )
  }

  const shortcuts   = pageData.shortcuts?.items ?? []
  const cards       = (pageData.cards?.items ?? []).filter((c) => c.type === "Card Break")
  const charts      = pageData.charts?.items ?? []
  const numberCards = pageData.number_cards?.items ?? []

  const handleNavigate = (path: string) => router.push(path)

  const sectionOrder = parseSectionOrder(meta?.content)

  const sectionMap: Record<string, React.ReactNode> = {
    charts: charts.length > 0 ? (
      <section key="charts" className="space-y-3">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Charts
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {charts.map((item) => (
            <ChartWidget key={item.name} item={item} onNavigate={handleNavigate} />
          ))}
        </div>
      </section>
    ) : null,

    number_cards: numberCards.length > 0 ? (
      <section key="number_cards" className="space-y-3">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Summary
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {numberCards.map((item) => (
            <NumberCard
              key={item.name}
              cardName={item.number_card_name}
              frappe={frappe as unknown as import("@petal/ui").NumberCardFrappe}
              onEdit={() =>
                router.push(`/form/Number Card/${encodeURIComponent(item.number_card_name)}?edit=1`)
              }
            />
          ))}
        </div>
      </section>
    ) : null,

    shortcuts: shortcuts.length > 0 ? (
      <section key="shortcuts" className="space-y-3">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Quick Access
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
          {shortcuts.map((s) => <ShortcutCard key={s.name} s={s} />)}
        </div>
      </section>
    ) : null,

    cards: cards.length > 0 ? (
      <section key="cards" className="space-y-3">
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Reports &amp; Masters
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map((card) => <CardSection key={card.name} card={card} />)}
        </div>
      </section>
    ) : null,
  }

  const isEmpty = shortcuts.length === 0 && cards.length === 0 && charts.length === 0 && numberCards.length === 0

  return (
    <div className="space-y-8">
      {/* Page header */}
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-foreground">
          {meta?.label || meta?.title || name}
        </h1>
        {meta?.module && (
          <span className="text-xs font-medium bg-primary/10 text-primary px-2 py-0.5 rounded-full">
            {meta.module}
          </span>
        )}
      </div>

      {sectionOrder.map((s) => sectionMap[s] ?? null)}

      {isEmpty && (
        <p className="text-sm text-muted-foreground">No content found in this workspace.</p>
      )}
    </div>
  )
}
