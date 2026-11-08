// Month-grid calendar helpers. All dates are handled as local "YYYY-MM-DD"
// keys to avoid UTC-midnight shifts.

export type CalendarDay = { key: string; date: Date; inMonth: boolean; isToday: boolean }

export type CalendarEvent = {
  name: string
  title: string
  start: string // YYYY-MM-DD
  end: string   // YYYY-MM-DD, inclusive
  row: Record<string, unknown>
}

export function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

/** Parse "YYYY-MM-DD" or "YYYY-MM-DD HH:MM:SS" into a local date (time dropped). */
export function parseDateKey(value: unknown): Date | null {
  if (typeof value !== "string") return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value)
  if (!m) return null
  const d = new Date(+m[1]!, +m[2]! - 1, +m[3]!)
  return isNaN(d.getTime()) ? null : d
}

/**
 * Six-week grid (42 days) covering `month` of `year` (0-based month).
 * `weekStartsOn` 0 = Sunday, 1 = Monday.
 */
export function buildMonthGrid(year: number, month: number, weekStartsOn: 0 | 1 = 0, today = new Date()): CalendarDay[] {
  const first = new Date(year, month, 1)
  const offset = (first.getDay() - weekStartsOn + 7) % 7
  const start = new Date(year, month, 1 - offset)
  const todayKey = dateKey(today)
  return Array.from({ length: 42 }, (_, i) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
    const key = dateKey(date)
    return { key, date, inMonth: date.getMonth() === month, isToday: key === todayKey }
  })
}

/** First and last day keys of the visible grid — used as list filters. */
export function gridRange(grid: CalendarDay[]): { from: string; to: string } {
  return { from: grid[0]!.key, to: grid[grid.length - 1]!.key }
}

export function toEvents(
  rows: Record<string, unknown>[],
  startField: string,
  endField: string | null,
  titleField: string,
): CalendarEvent[] {
  const out: CalendarEvent[] = []
  for (const row of rows) {
    const s = parseDateKey(row[startField])
    if (!s) continue
    const e = (endField && parseDateKey(row[endField])) || s
    const [lo, hi] = e < s ? [e, s] : [s, e]
    out.push({
      name: String(row.name),
      title: String(row[titleField] || row.name),
      start: dateKey(lo),
      end: dateKey(hi),
      row,
    })
  }
  return out
}

/** Map of day key → events touching that day (multi-day events appear on each day). */
export function eventsByDay(events: CalendarEvent[], grid: CalendarDay[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>(grid.map((d) => [d.key, []]))
  for (const ev of events) {
    for (const day of grid) {
      if (day.key >= ev.start && day.key <= ev.end) map.get(day.key)!.push(ev)
    }
  }
  return map
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month + delta, 1)
  return { year: d.getFullYear(), month: d.getMonth() }
}

/** Fields usable as calendar start/end dates. */
export function dateFields<T extends { fieldtype: string }>(fields: T[]): T[] {
  return fields.filter((f) => f.fieldtype === "Date" || f.fieldtype === "Datetime")
}
