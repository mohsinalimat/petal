// Gantt chart geometry: turn rows with start/end dates into positioned bars.

import { dateKey, parseDateKey } from "./calendar"

export type GanttBar = {
  name: string
  title: string
  start: string
  end: string
  /** Offset of the bar's left edge from the range start, in days. */
  offsetDays: number
  /** Inclusive duration in days (>= 1). */
  durationDays: number
  progress: number | null
  row: Record<string, unknown>
}

export type GanttRange = { start: Date; days: number }

const DAY_MS = 86_400_000

/** Whole days between two local dates (DST-safe via UTC). */
export function daysBetween(a: Date, b: Date): number {
  return Math.round(
    (Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY_MS,
  )
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

/**
 * Build bars sorted by start date. Rows without a parsable start are dropped;
 * a missing/earlier end collapses to a one-day bar.
 */
export function buildBars(
  rows: Record<string, unknown>[],
  startField: string,
  endField: string,
  titleField: string,
  progressField?: string | null,
): { bars: GanttBar[]; range: GanttRange | null } {
  const parsed = rows
    .map((row) => {
      const s = parseDateKey(row[startField])
      if (!s) return null
      let e = parseDateKey(row[endField]) ?? s
      if (e < s) e = s
      return { row, s, e }
    })
    .filter((x): x is { row: Record<string, unknown>; s: Date; e: Date } => x !== null)
    .sort((a, b) => a.s.getTime() - b.s.getTime())

  if (parsed.length === 0) return { bars: [], range: null }

  const min = parsed[0]!.s
  const max = parsed.reduce((m, p) => (p.e > m ? p.e : m), parsed[0]!.e)
  // One day of padding on either side keeps edge bars off the border.
  const rangeStart = addDays(min, -1)
  const range: GanttRange = { start: rangeStart, days: daysBetween(rangeStart, max) + 2 }

  const bars = parsed.map(({ row, s, e }) => {
    const p = progressField ? Number(row[progressField]) : NaN
    return {
      name: String(row.name),
      title: String(row[titleField] || row.name),
      start: dateKey(s),
      end: dateKey(e),
      offsetDays: daysBetween(rangeStart, s),
      durationDays: daysBetween(s, e) + 1,
      progress: Number.isFinite(p) ? Math.max(0, Math.min(100, p)) : null,
      row,
    }
  })
  return { bars, range }
}

/** Date ticks for the header: every day for short ranges, weekly/monthly for long ones. */
export function buildTicks(range: GanttRange): { offsetDays: number; label: string }[] {
  const step = range.days <= 31 ? 1 : range.days <= 120 ? 7 : 30
  const ticks: { offsetDays: number; label: string }[] = []
  for (let i = 0; i < range.days; i += step) {
    const d = addDays(range.start, i)
    ticks.push({
      offsetDays: i,
      label: step === 30
        ? d.toLocaleDateString(undefined, { month: "short", year: "2-digit" })
        : d.toLocaleDateString(undefined, { day: "numeric", month: "short" }),
    })
  }
  return ticks
}

/** Shift both dates of a bar by `days`, returning new YYYY-MM-DD strings. */
export function shiftDates(start: string, end: string, days: number): { start: string; end: string } {
  return {
    start: dateKey(addDays(parseDateKey(start)!, days)),
    end: dateKey(addDays(parseDateKey(end)!, days)),
  }
}
