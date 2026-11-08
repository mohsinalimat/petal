"use client"

import * as React from "react"
import { useMemo, useState } from "react"
import { cn } from "../lib/utils"
import { buildBars, buildTicks } from "../lib/gantt"

export type GanttViewProps = {
  rows: Record<string, unknown>[]
  startField: string
  endField: string
  titleField: string
  progressField?: string | null
  onBarClick: (name: string) => void
  /** Width of one day in px. */
  dayWidth?: number
  className?: string
}

const ROW_H = 36
const LABEL_W = 200

export function GanttView({
  rows, startField, endField, titleField, progressField, onBarClick, dayWidth: initialDayWidth = 28, className,
}: GanttViewProps) {
  const [dayWidth, setDayWidth] = useState(initialDayWidth)
  const { bars, range } = useMemo(
    () => buildBars(rows, startField, endField, titleField, progressField),
    [rows, startField, endField, titleField, progressField],
  )
  const ticks = useMemo(() => (range ? buildTicks(range) : []), [range])

  if (!range) {
    return (
      <div className={cn("rounded-xl border border-border bg-background px-4 py-12 text-center text-sm text-muted-foreground", className)}>
        No records have a start date to plot.
      </div>
    )
  }

  const width = range.days * dayWidth
  const todayOffset = Math.floor((Date.now() - range.start.getTime()) / 86_400_000)

  return (
    <div className={cn("rounded-xl border border-border bg-background overflow-hidden", className)}>
      <div className="flex items-center justify-end gap-1 px-3 py-2 border-b border-border">
        <span className="text-xs text-muted-foreground mr-1">Zoom</span>
        <button type="button" aria-label="Zoom out" onClick={() => setDayWidth((w) => Math.max(6, Math.round(w / 1.5)))} className="h-7 w-7 rounded border border-border hover:bg-accent text-sm">−</button>
        <button type="button" aria-label="Zoom in" onClick={() => setDayWidth((w) => Math.min(80, Math.round(w * 1.5)))} className="h-7 w-7 rounded border border-border hover:bg-accent text-sm">+</button>
      </div>
      <div className="flex overflow-x-auto">
        {/* Labels — sticky on wide screens, hidden on phones where bars carry their own titles */}
        <div className="hidden sm:block shrink-0 sticky left-0 z-10 bg-background border-r border-border" style={{ width: LABEL_W }}>
          <div className="h-8 border-b border-border" />
          {bars.map((b) => (
            <button
              key={b.name}
              type="button"
              onClick={() => onBarClick(b.name)}
              className="block w-full text-left px-3 text-sm truncate hover:bg-accent border-b border-border/40"
              style={{ height: ROW_H, lineHeight: `${ROW_H}px` }}
              title={b.title}
            >
              {b.title}
            </button>
          ))}
        </div>
        <div className="relative" style={{ width, minWidth: width }}>
          <div className="relative h-8 border-b border-border">
            {ticks.map((t) => (
              <span
                key={t.offsetDays}
                className="absolute top-0 h-full border-l border-border/60 pl-1 text-[10px] leading-8 text-muted-foreground whitespace-nowrap"
                style={{ left: t.offsetDays * dayWidth }}
              >
                {t.label}
              </span>
            ))}
          </div>
          {todayOffset >= 0 && todayOffset < range.days && (
            <div aria-hidden className="absolute top-8 bottom-0 w-px bg-red-400/70 z-[1]" style={{ left: (todayOffset + 0.5) * dayWidth }} />
          )}
          {bars.map((b) => (
            <div key={b.name} className="relative border-b border-border/40" style={{ height: ROW_H }}>
              <button
                type="button"
                data-testid={`bar-${b.name}`}
                onClick={() => onBarClick(b.name)}
                title={`${b.title}: ${b.start} → ${b.end}`}
                className="absolute top-1.5 rounded-md bg-primary/20 border border-primary/40 overflow-hidden text-left hover:bg-primary/30"
                style={{ left: b.offsetDays * dayWidth, width: Math.max(b.durationDays * dayWidth - 2, 6), height: ROW_H - 12 }}
              >
                {b.progress != null && (
                  <span aria-hidden className="absolute inset-y-0 left-0 bg-primary/50" style={{ width: `${b.progress}%` }} />
                )}
                <span className="relative px-1.5 text-[11px] leading-6 text-foreground whitespace-nowrap">{b.title}</span>
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
