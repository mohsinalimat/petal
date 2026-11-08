"use client"

import * as React from "react"
import { useMemo } from "react"
import { cn } from "../lib/utils"
import { buildMonthGrid, eventsByDay, shiftMonth } from "../lib/calendar"
import type { CalendarEvent } from "../lib/calendar"

export type CalendarViewProps = {
  year: number
  /** 0-based month */
  month: number
  events: CalendarEvent[]
  loading?: boolean
  weekStartsOn?: 0 | 1
  onNavigate: (year: number, month: number) => void
  onEventClick: (name: string) => void
  /** Called with a YYYY-MM-DD key when an empty part of a day is clicked. */
  onDayClick?: (day: string) => void
  className?: string
}

const MAX_PER_DAY = 3

function weekdayLabels(weekStartsOn: 0 | 1): string[] {
  // 2023-01-01 was a Sunday
  return Array.from({ length: 7 }, (_, i) =>
    new Date(2023, 0, 1 + ((i + weekStartsOn) % 7)).toLocaleDateString(undefined, { weekday: "short" }),
  )
}

export function CalendarView({
  year, month, events, loading, weekStartsOn = 0, onNavigate, onEventClick, onDayClick, className,
}: CalendarViewProps) {
  const grid = useMemo(() => buildMonthGrid(year, month, weekStartsOn), [year, month, weekStartsOn])
  const byDay = useMemo(() => eventsByDay(events, grid), [events, grid])
  const title = new Date(year, month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })
  const agenda = grid.filter((d) => d.inMonth && (byDay.get(d.key)?.length ?? 0) > 0)

  function go(delta: number) {
    const n = shiftMonth(year, month, delta)
    onNavigate(n.year, n.month)
  }

  return (
    <div className={cn("rounded-xl border border-border bg-background overflow-hidden", className)}>
      <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-3 border-b border-border">
        <h2 className="text-base font-semibold text-foreground" aria-live="polite">{title}</h2>
        <div className="flex items-center gap-1">
          {loading && <span className="w-3.5 h-3.5 mr-2 border-2 border-primary border-t-transparent rounded-full animate-spin" aria-label="Loading" />}
          <button type="button" onClick={() => go(-1)} aria-label="Previous month" className="h-8 w-8 rounded-lg border border-border hover:bg-accent text-sm">‹</button>
          <button
            type="button"
            onClick={() => { const t = new Date(); onNavigate(t.getFullYear(), t.getMonth()) }}
            className="h-8 px-3 rounded-lg border border-border hover:bg-accent text-xs font-medium"
          >
            Today
          </button>
          <button type="button" onClick={() => go(1)} aria-label="Next month" className="h-8 w-8 rounded-lg border border-border hover:bg-accent text-sm">›</button>
        </div>
      </div>

      {/* Month grid — tablet and up */}
      <div className="hidden md:block">
        <div className="grid grid-cols-7 border-b border-border bg-muted/30">
          {weekdayLabels(weekStartsOn).map((w) => (
            <div key={w} className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{w}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {grid.map((day) => {
            const evs = byDay.get(day.key) ?? []
            return (
              <div
                key={day.key}
                data-day={day.key}
                onClick={(e) => { if (e.target === e.currentTarget) onDayClick?.(day.key) }}
                className={cn(
                  "min-h-[104px] border-b border-r border-border/60 p-1.5 space-y-1",
                  !day.inMonth && "bg-muted/20",
                  onDayClick && "cursor-pointer hover:bg-accent/30",
                )}
              >
                <div className={cn(
                  "text-xs w-6 h-6 flex items-center justify-center rounded-full pointer-events-none",
                  day.isToday ? "bg-primary text-primary-foreground font-semibold" : day.inMonth ? "text-foreground" : "text-muted-foreground/50",
                )}>
                  {day.date.getDate()}
                </div>
                {evs.slice(0, MAX_PER_DAY).map((ev) => (
                  <button
                    key={ev.name}
                    type="button"
                    title={ev.title}
                    onClick={() => onEventClick(ev.name)}
                    className="block w-full truncate text-left text-[11px] leading-5 px-1.5 rounded bg-primary/10 text-primary hover:bg-primary/20"
                  >
                    {ev.title}
                  </button>
                ))}
                {evs.length > MAX_PER_DAY && (
                  <p className="text-[11px] text-muted-foreground px-1.5">+{evs.length - MAX_PER_DAY} more</p>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Agenda — phones */}
      <ul className="md:hidden divide-y divide-border">
        {agenda.length === 0 && (
          <li className="px-4 py-10 text-center text-sm text-muted-foreground">{loading ? "Loading…" : "Nothing scheduled this month"}</li>
        )}
        {agenda.map((day) => (
          <li key={day.key} className="px-4 py-3">
            <p className={cn("text-xs font-semibold mb-1.5", day.isToday ? "text-primary" : "text-muted-foreground")}>
              {day.date.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
            </p>
            <div className="space-y-1">
              {byDay.get(day.key)!.map((ev) => (
                <button
                  key={ev.name}
                  type="button"
                  onClick={() => onEventClick(ev.name)}
                  className="block w-full text-left text-sm px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary truncate"
                >
                  {ev.title}
                </button>
              ))}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
