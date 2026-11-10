"use client"
import {
  ResponsiveContainer,
  LineChart, Line,
  BarChart, Bar,
  PieChart, Pie,
  XAxis, YAxis, CartesianGrid,
  Tooltip, Legend,
} from "recharts"
import { cn } from "../lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FrappeChartData = {
  labels: string[]
  datasets: { name: string; values: number[] }[]
  /** Accepts Frappe's cased values ("Line", "Bar") or lowercase equivalents */
  type: string
  colors?: string[]
  /** Heatmap only: unix_timestamp (string) → count */
  dataPoints?: Record<string, number>
}

export interface FrappeChartProps {
  data: FrappeChartData
  title?: string
  /** px — defaults to 220 */
  height?: number
  className?: string
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const PALETTE = [
  "#5e64ff", "#7cd6fd", "#28a745", "#ffa00a",
  "#ff5858", "#743ee2", "#98d85b", "#b8c2cc",
]

function color(colors: string[] | undefined, i: number): string {
  return colors?.[i] ?? PALETTE[i % PALETTE.length]!
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortLabel(v: string, maxLen = 10): string {
  return typeof v === "string" && v.length > maxLen ? v.slice(0, maxLen) + "…" : String(v)
}

function abbreviate(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, "") + "B"
  if (abs >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "M"
  if (abs >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "K"
  return String(n)
}

const tooltipStyle: React.CSSProperties = {
  fontSize: 12,
  borderRadius: 8,
  border: "1px solid hsl(var(--border))",
  backgroundColor: "hsl(var(--background))",
  color: "hsl(var(--foreground))",
}

// ---------------------------------------------------------------------------
// Sub-renderers
// ---------------------------------------------------------------------------

function LineOrBar({ data, type, h }: { data: FrappeChartData; type: "line" | "bar"; h: number }) {
  const chartData = data?.labels?.map((label, i) => {
    const entry: Record<string, unknown> = { label }
    data.datasets.forEach((ds) => { entry[ds.name] = ds.values[i] ?? 0 })
    return entry
  })

  const Chart = type === "line" ? LineChart : BarChart

  return (
    <ResponsiveContainer width="100%" height={h}>
      <Chart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={(v: string) => shortLabel(v, 10)}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
          tickFormatter={abbreviate}
          axisLine={false}
          tickLine={false}
          width={44}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={type === "bar" ? false : { stroke: "hsl(var(--border))", strokeWidth: 1 }}
        />
        {data?.datasets?.length > 1 && <Legend wrapperStyle={{ fontSize: 11 }} />}
        {data?.datasets?.map((ds, i) =>
          type === "line" ? (
            <Line
              key={ds.name}
              type="monotone"
              dataKey={ds.name}
              stroke={color(data.colors, i)}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ) : (
            <Bar
              key={ds.name}
              dataKey={ds.name}
              fill={color(data.colors, i)}
              radius={[3, 3, 0, 0]}
              maxBarSize={40}
            />
          )
        )}
      </Chart>
    </ResponsiveContainer>
  )
}

function PieOrDonut({ data, donut, h }: { data: FrappeChartData; donut: boolean; h: number }) {
  const ds = data.datasets[0]
  if (!ds) return null

  const pieData = data.labels.map((name, i) => ({ name, value: ds.values[i] ?? 0, fill: color(data.colors, i) }))
  const outerR = Math.min(h / 2 - 20, 80)
  const innerR = donut ? outerR * 0.55 : 0

  return (
    <ResponsiveContainer width="100%" height={h}>
      <PieChart>
        <Pie
          data={pieData}
          cx="50%"
          cy="50%"
          outerRadius={outerR}
          innerRadius={innerR}
          dataKey="value"
          paddingAngle={donut ? 2 : 0}
          label={({ name, percent }: { name?: string; percent?: number }) =>
            `${shortLabel(name ?? "", 8)} ${((percent ?? 0) * 100).toFixed(0)}%`
          }
          labelLine={false}
        />

        <Tooltip contentStyle={tooltipStyle} />
        {pieData.length <= 8 && <Legend wrapperStyle={{ fontSize: 11 }} />}
      </PieChart>
    </ResponsiveContainer>
  )
}

function PercentageBar({ data }: { data: FrappeChartData }) {
  const ds = data.datasets[0]
  if (!ds) return null

  const total = ds.values.reduce((a, b) => a + b, 0) || 1

  return (
    <div className="flex flex-col gap-2.5 py-2">
      {data.labels.map((label, i) => {
        const val = ds.values[i] ?? 0
        const pct = (val / total) * 100
        return (
          <div key={label} className="flex items-center gap-2 text-xs">
            <span className="w-28 truncate text-right text-muted-foreground shrink-0">
              {label}
            </span>
            <div className="flex-1 h-5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full w-full origin-left transition-transform"
                style={{ transform: `scaleX(${pct / 100})`, backgroundColor: color(data.colors, i) }}
              />
            </div>
            <span className="w-10 text-muted-foreground shrink-0">{pct.toFixed(1)}%</span>
          </div>
        )
      })}
    </div>
  )
}

const HEATMAP_LEVELS = ["hsl(var(--muted))", "#9be9a8", "#40c463", "#30a14e", "#216e39"]

function heatmapColor(val: number, max: number): string {
  if (val === 0 || max === 0) return HEATMAP_LEVELS[0]!
  const level = Math.ceil((val / max) * (HEATMAP_LEVELS.length - 1))
  return HEATMAP_LEVELS[Math.min(level, HEATMAP_LEVELS.length - 1)]!
}

function Heatmap({ data }: { data: FrappeChartData }) {
  const points = data.dataPoints ?? {}
  const entries = Object.entries(points)

  // Derive year from data timestamps, fall back to current year
  const year =
    entries.length > 0
      ? new Date(Number(entries[0]![0]) * 1000).getFullYear()
      : new Date().getFullYear()

  const dateMap = new Map<string, number>()
  for (const [ts, val] of entries) {
    const d = new Date(Number(ts) * 1000)
    if (d.getFullYear() === year) {
      dateMap.set(d.toISOString().slice(0, 10), Number(val))
    }
  }

  const maxVal = Math.max(...Array.from(dateMap.values()), 1)

  // Build weeks array: each week is 7 day slots (null = padding)
  const jan1 = new Date(year, 0, 1)
  const weeks: (string | null)[][] = []
  let week: (string | null)[] = Array<null>(jan1.getDay()).fill(null)

  const cursor = new Date(year, 0, 1)
  while (cursor.getFullYear() === year) {
    week.push(cursor.toISOString().slice(0, 10))
    if (cursor.getDay() === 6) { weeks.push(week); week = [] }
    cursor.setDate(cursor.getDate() + 1)
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null)
    weeks.push(week)
  }

  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]

  return (
    <div className="overflow-x-auto">
      {/* Month labels */}
      <div className="flex gap-0.5 mb-1 pl-6 text-[9px] text-muted-foreground">
        {weeks.map((wk, wi) => {
          const first = wk.find(Boolean)
          if (!first) return <div key={wi} className="w-2.5" />
          const d = new Date(first)
          return (
            <div key={wi} className="w-2.5 shrink-0">
              {d.getDate() <= 7 ? MONTHS[d.getMonth()] : ""}
            </div>
          )
        })}
      </div>

      <div className="flex gap-0.5">
        {/* Day-of-week labels */}
        <div className="flex flex-col gap-0.5 mr-1 text-[9px] text-muted-foreground">
          {["S","M","T","W","T","F","S"].map((d, i) => (
            <div key={i} className="h-2.5 leading-none flex items-center">{i % 2 === 1 ? d : ""}</div>
          ))}
        </div>

        {weeks.map((wk, wi) => (
          <div key={wi} className="flex flex-col gap-0.5">
            {wk.map((day, di) => (
              <div
                key={di}
                title={day ? `${day}: ${dateMap.get(day) ?? 0}` : ""}
                className="w-2.5 h-2.5 rounded-sm"
                style={{ backgroundColor: day ? heatmapColor(dateMap.get(day) ?? 0, maxVal) : "transparent" }}
              />
            ))}
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-1 mt-2 justify-end text-[10px] text-muted-foreground">
        <span>Less</span>
        {HEATMAP_LEVELS.map((c, i) => (
          <div key={i} className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: c }} />
        ))}
        <span>More</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function FrappeChart({ data, title, height = 220, className }: FrappeChartProps) {
  const t = (data.type ?? "bar").toLowerCase()

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {title && (
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {title}
        </p>
      )}
      {t === "line"       && <LineOrBar    data={data} type="line" h={height} />}
      {t === "bar"        && <LineOrBar    data={data} type="bar"  h={height} />}
      {t === "pie"        && <PieOrDonut   data={data} donut={false} h={height} />}
      {t === "donut"      && <PieOrDonut   data={data} donut={true}  h={height} />}
      {t === "percentage" && <PercentageBar data={data} />}
      {t === "heatmap"    && <Heatmap      data={data} />}
      {!["line","bar","pie","donut","percentage","heatmap"].includes(t) && (
        <LineOrBar data={data} type="bar" h={height} />
      )}
    </div>
  )
}
