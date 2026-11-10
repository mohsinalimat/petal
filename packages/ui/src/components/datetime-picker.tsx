"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { cn } from "../lib/utils"
import { AnchoredPopover } from "./anchored-popover"

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]
const DAYS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]

const SPIN_BTN =
  "flex h-5 w-7 items-center justify-center rounded text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground"

export interface DateTimePickerProps {
  /** ISO datetime string in "YYYY-MM-DD HH:mm:ss" format */
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  id?: string
  className?: string
  style?: React.CSSProperties
}

/**
 * Calendar + time-spinner popover for Frappe Datetime fields.
 * Stores and emits values as "YYYY-MM-DD HH:mm:ss" strings.
 *
 * @example
 * <DateTimePicker value={doc.scheduled_at} onChange={(v) => setField("scheduled_at", v)} />
 */
export function DateTimePicker({
  value,
  onChange,
  disabled,
  id,
  className,
  style,
}: DateTimePickerProps) {
  const parts    = (value || "").split(" ")
  const datePart = parts[0] ?? ""
  const rawTime  = parts[1] ?? ""

  const parsed = datePart ? new Date(datePart + "T00:00:00") : null
  const today  = new Date()

  const [open, setOpen]   = useState(false)
  const [month, setMonth] = useState(parsed?.getMonth() ?? today.getMonth())
  const [year, setYear]   = useState(parsed?.getFullYear() ?? today.getFullYear())
  const [hh, setHh]       = useState(rawTime.slice(0, 2) || "00")
  const [mm, setMm]       = useState(rawTime.slice(3, 5) || "00")
  const wrapRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  // The calendar is portalled to <body>, so it isn't inside wrapRef
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const p = (value || "").split(" ")
    const d = p[0] ?? ""
    const t = p[1] ?? ""
    if (d) {
      const dt = new Date(d + "T00:00:00")
      setMonth(dt.getMonth())
      setYear(dt.getFullYear())
    }
    setHh(t.slice(0, 2) || "00")
    setMm(t.slice(3, 5) || "00")
  }, [value])

  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      const t = e.target as Node
      if (!wrapRef.current?.contains(t) && !panelRef.current?.contains(t)) setOpen(false)
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

  function buildValue(day: number, h: string, m: string) {
    const mo = String(month + 1).padStart(2, "0")
    const dd = String(day).padStart(2, "0")
    return `${year}-${mo}-${dd} ${h.padStart(2, "0")}:${m.padStart(2, "0")}:00`
  }

  function selectDay(day: number) {
    onChange(buildValue(day, hh, mm))
  }

  function applyTime(h: string, m: string) {
    setHh(h)
    setMm(m)
    if (parsed) onChange(buildValue(parsed.getDate(), h, m))
  }

  function setNow() {
    const n  = new Date()
    const y  = n.getFullYear()
    const mo = String(n.getMonth() + 1).padStart(2, "0")
    const d  = String(n.getDate()).padStart(2, "0")
    const h  = String(n.getHours()).padStart(2, "0")
    const m  = String(n.getMinutes()).padStart(2, "0")
    setMonth(n.getMonth()); setYear(y); setHh(h); setMm(m)
    onChange(`${y}-${mo}-${d} ${h}:${m}:00`)
  }

  const hour24 = parseInt(hh) || 0
  const isPM   = hour24 >= 12
  const hour12 = hour24 === 0 ? 12 : hour24 > 12 ? hour24 - 12 : hour24

  function spinHour(delta: number) {
    const h = String((hour24 + delta + 24) % 24).padStart(2, "0")
    applyTime(h, mm)
  }
  function spinMinute(delta: number) {
    const m = String((parseInt(mm) + delta + 60) % 60).padStart(2, "0")
    applyTime(hh, m)
  }
  function toggleAmPm() {
    const h = isPM ? hour24 - 12 : hour24 + 12
    applyTime(String(h).padStart(2, "0"), mm)
  }

  const isToday    = (d: number) => d === today.getDate() && month === today.getMonth() && year === today.getFullYear()
  const isSelected = (d: number) => parsed !== null && d === parsed.getDate() && month === parsed.getMonth() && year === parsed.getFullYear()

  const displayVal = parsed
    ? parsed.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) +
      "  " + String(hour12).padStart(2, "0") + ":" + mm + " " + (isPM ? "PM" : "AM")
    : ""

  return (
    <div ref={wrapRef} className={cn("relative inline-block", className)}>
      <button
        ref={buttonRef}
        type="button"
        id={id}
        disabled={disabled}
        onClick={() => !disabled && setOpen((v) => !v)}
        style={style}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cn(
          "relative h-9 min-w-[210px] rounded-lg border border-border bg-background pl-3 pr-9",
          "text-left text-sm transition-colors focus:outline-none focus:ring-1 focus:ring-primary/50 focus:border-primary/50",
          disabled
            ? "cursor-not-allowed opacity-60 text-muted-foreground"
            : "cursor-pointer text-foreground hover:border-primary/40",
        )}
      >
        {displayVal || <span className="text-muted-foreground/50">Pick date &amp; time</span>}
        <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2" aria-hidden="true">
          <svg className="h-4 w-4 text-muted-foreground/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <circle cx="12" cy="12" r="9" />
            <path strokeLinecap="round" d="M12 7v5l3 3" />
          </svg>
        </span>
      </button>

      {open && (
        <AnchoredPopover
          anchorRef={buttonRef}
          panelRef={panelRef}
          role="dialog"
          aria-label="Date and time picker"
          className="w-72 overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
        >
          {/* Month navigation */}
          <div className="flex items-center justify-between border-b border-border/60 bg-muted/20 px-4 py-3">
            <button type="button" onClick={prevMonth} aria-label="Previous month"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M15 19l-7-7 7-7" /></svg>
            </button>
            <span className="text-sm font-semibold text-foreground">{MONTHS[month]} {year}</span>
            <button type="button" onClick={nextMonth} aria-label="Next month"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" d="M9 5l7 7-7 7" /></svg>
            </button>
          </div>

          {/* Day-of-week labels */}
          <div className="grid grid-cols-7 px-3 pb-1 pt-3">
            {DAYS.map((d) => (
              <div key={d} className="py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/50">{d}</div>
            ))}
          </div>

          {/* Day grid */}
          <div className="grid grid-cols-7 gap-y-0.5 px-3 pb-3">
            {Array.from({ length: firstDay }).map((_, i) => <div key={`e${i}`} />)}
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((d) => (
              <button key={d} type="button" onClick={() => selectDay(d)}
                aria-label={`${d} ${MONTHS[month]} ${year}`}
                aria-pressed={isSelected(d)}
                className={cn(
                  "h-8 w-full rounded-lg text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  isSelected(d) ? "bg-primary text-primary-foreground shadow-sm"
                    : isToday(d) ? "bg-primary/10 font-semibold text-primary"
                    : "text-foreground hover:bg-accent",
                )}>
                {d}
              </button>
            ))}
          </div>

          {/* Time picker */}
          <div className="border-t border-border/60 bg-muted/10 px-4 py-3">
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50">Time</p>
            <div className="flex items-center gap-2">
              {/* Hour spinner */}
              <div className="flex flex-col items-center gap-0.5">
                <button type="button" onClick={() => spinHour(+1)} aria-label="Increase hour" className={SPIN_BTN}>
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M5 15l7-7 7 7" /></svg>
                </button>
                <input type="text" value={hh} aria-label="Hour"
                  onChange={(e) => {
                    const n = Math.min(23, parseInt(e.target.value.replace(/\D/g, "") || "0"))
                    applyTime(String(n).padStart(2, "0"), mm)
                  }}
                  className="h-9 w-10 rounded-lg border border-border/60 bg-background text-center font-mono text-sm font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                <button type="button" onClick={() => spinHour(-1)} aria-label="Decrease hour" className={SPIN_BTN}>
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M19 9l-7 7-7-7" /></svg>
                </button>
              </div>

              <span className="mb-px select-none text-xl font-bold text-muted-foreground/40">:</span>

              {/* Minute spinner */}
              <div className="flex flex-col items-center gap-0.5">
                <button type="button" onClick={() => spinMinute(+1)} aria-label="Increase minute" className={SPIN_BTN}>
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M5 15l7-7 7 7" /></svg>
                </button>
                <input type="text" value={mm} aria-label="Minute"
                  onChange={(e) => {
                    const n = Math.min(59, parseInt(e.target.value.replace(/\D/g, "") || "0"))
                    applyTime(hh, String(n).padStart(2, "0"))
                  }}
                  className="h-9 w-10 rounded-lg border border-border/60 bg-background text-center font-mono text-sm font-semibold text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
                />
                <button type="button" onClick={() => spinMinute(-1)} aria-label="Decrease minute" className={SPIN_BTN}>
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" d="M19 9l-7 7-7-7" /></svg>
                </button>
              </div>

              {/* AM/PM toggle */}
              <button type="button" onClick={toggleAmPm}
                className="ml-1 h-9 select-none rounded-lg border border-border/60 px-3 text-sm font-semibold text-foreground transition-colors hover:bg-accent">
                {isPM ? "PM" : "AM"}
              </button>
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-border/40 px-4 pb-3 pt-2">
            <button type="button" onClick={setNow}
              className="text-xs font-medium text-primary hover:underline focus:outline-none focus-visible:underline">
              Now
            </button>
            <div className="flex items-center gap-3">
              {value && (
                <button type="button" onClick={() => { onChange(""); setOpen(false) }}
                  className="text-xs text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus-visible:underline">
                  Clear
                </button>
              )}
              <button type="button" onClick={() => setOpen(false)}
                className="h-7 rounded-lg bg-primary px-3 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90">
                Done
              </button>
            </div>
          </div>
        </AnchoredPopover>
      )}
    </div>
  )
}
