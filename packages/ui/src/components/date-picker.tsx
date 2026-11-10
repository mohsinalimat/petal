"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { cn } from "../lib/utils"
import { AnchoredPopover } from "./anchored-popover"

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]
const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]

export interface DatePickerProps {
  /** ISO date string in YYYY-MM-DD format */
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  id?: string
  className?: string
}

/**
 * Custom calendar popover for Frappe Date fields.
 * Stores and emits dates as YYYY-MM-DD strings.
 *
 * @example
 * <DatePicker value={doc.date} onChange={(v) => setField("date", v)} />
 */
export function DatePicker({
  value,
  onChange,
  disabled,
  placeholder = "Pick a date",
  id,
  className,
}: DatePickerProps) {
  const parsed = value ? new Date(value + "T00:00:00") : null
  const today  = new Date()

  const [open, setOpen]   = useState(false)
  const [month, setMonth] = useState(parsed?.getMonth() ?? today.getMonth())
  const [year, setYear]   = useState(parsed?.getFullYear() ?? today.getFullYear())
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  // The calendar is portalled to <body>, so it isn't inside wrapRef
  const panelRef = useRef<HTMLDivElement>(null)

  // Sync calendar view when value changes externally
  useEffect(() => {
    if (value) {
      const d = new Date(value + "T00:00:00")
      setMonth(d.getMonth())
      setYear(d.getFullYear())
    }
  }, [value])

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      const t = e.target as Node
      if (!wrapRef.current?.contains(t) && !panelRef.current?.contains(t)) {
        setOpen(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", handleMouseDown)
    document.addEventListener("keydown", handleKeyDown)
    return () => {
      document.removeEventListener("mousedown", handleMouseDown)
      document.removeEventListener("keydown", handleKeyDown)
    }
  }, [])

  const firstDay    = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const prevMonth = useCallback(() => {
    if (month === 0) { setMonth(11); setYear((y) => y - 1) }
    else setMonth((m) => m - 1)
  }, [month])

  const nextMonth = useCallback(() => {
    if (month === 11) { setMonth(0); setYear((y) => y + 1) }
    else setMonth((m) => m + 1)
  }, [month])

  function select(day: number) {
    const m  = String(month + 1).padStart(2, "0")
    const dd = String(day).padStart(2, "0")
    onChange(`${year}-${m}-${dd}`)
    setOpen(false)
  }

  function selectToday() {
    const t = new Date()
    setMonth(t.getMonth())
    setYear(t.getFullYear())
    select(t.getDate())
  }

  const isToday    = (d: number) => d === today.getDate() && month === today.getMonth() && year === today.getFullYear()
  const isSelected = (d: number) => parsed !== null && d === parsed.getDate() && month === parsed.getMonth() && year === parsed.getFullYear()

  const displayVal = parsed
    ? parsed.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
    : ""

  return (
    <div ref={wrapRef} className={cn("relative inline-block", className)}>
      <button
        ref={buttonRef}
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "relative h-9 min-w-[160px] rounded-lg border border-border bg-background pl-3 pr-9",
          "text-left text-sm transition-colors focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50",
          disabled
            ? "cursor-not-allowed opacity-60 text-muted-foreground"
            : "cursor-pointer text-foreground hover:border-primary/40",
        )}
      >
        {displayVal || <span className="text-muted-foreground/50">{placeholder}</span>}
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" aria-hidden="true">
          <svg className="h-4 w-4 text-muted-foreground/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <rect x="3" y="4" width="18" height="18" rx="2" strokeLinecap="round" strokeLinejoin="round" />
            <path strokeLinecap="round" d="M16 2v4M8 2v4M3 10h18" />
          </svg>
        </span>
      </button>

      {open && (
        <AnchoredPopover
          anchorRef={buttonRef}
          panelRef={panelRef}
          role="dialog"
          aria-label="Date picker"
          className="w-72 overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
        >
          {/* Month navigation */}
          <div className="flex items-center justify-between border-b border-border/60 bg-muted/20 px-4 py-3">
            <button
              type="button"
              onClick={prevMonth}
              aria-label="Previous month"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <span className="text-sm font-semibold text-foreground">
              {MONTHS[month]} {year}
            </span>
            <button
              type="button"
              onClick={nextMonth}
              aria-label="Next month"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Day-of-week labels */}
          <div className="grid grid-cols-7 px-3 pb-1 pt-3">
            {DAYS.map((d) => (
              <div key={d} className="py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/50">
                {d}
              </div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-y-0.5 px-3 pb-3">
            {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => select(d)}
                aria-label={`${d} ${MONTHS[month]} ${year}`}
                aria-pressed={isSelected(d)}
                className={cn(
                  "h-8 w-full rounded-lg text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  isSelected(d)
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : isToday(d)
                    ? "bg-primary/10 font-semibold text-primary"
                    : "text-foreground hover:bg-accent",
                )}
              >
                {d}
              </button>
            ))}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border/40 px-3 pb-3 pt-2.5">
            <button
              type="button"
              onClick={selectToday}
              className="text-xs font-medium text-primary hover:underline focus:outline-none focus-visible:underline"
            >
              Today
            </button>
            {value && (
              <button
                type="button"
                onClick={() => { onChange(""); setOpen(false) }}
                className="text-xs text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:underline"
              >
                Clear
              </button>
            )}
          </div>
        </AnchoredPopover>
      )}
    </div>
  )
}
