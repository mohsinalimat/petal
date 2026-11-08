"use client"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { CalendarView, buildMonthGrid, dateFields, gridRange, toEvents } from "@petal/ui"
import type { CalendarEvent } from "@petal/ui"
import { useFrappe } from "@/hooks/useFrappe"
import { useDocMeta } from "@/hooks/useDocMeta"
import { useRealtimeList } from "@/hooks/useRealtime"
import { defaultDateFields } from "@/lib/views/available-views"
import { prefillKey } from "@/lib/doc/doc-utils"
import { DoctypeViewHeader } from "@/components/views/DoctypeViewHeader"

const EVENT_LIMIT = 1000

export default function CalendarPage() {
  const params = useParams()
  const doctype = decodeURIComponent(params.doctype as string)
  const router = useRouter()
  const searchParams = useSearchParams()
  const frappe = useFrappe()
  const { meta, error: metaError } = useDocMeta(doctype)

  const today = new Date()
  const [ym, setYm] = useState({ year: today.getFullYear(), month: today.getMonth() })
  const [events, setEvents] = useState<CalendarEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const dates = useMemo(() => (meta ? dateFields(meta.fields.filter((f) => f.hidden !== 1)) : []), [meta])
  const defaults = useMemo(() => (meta ? defaultDateFields(meta) : { start: null, end: null }), [meta])
  const startField = searchParams.get("start") ?? defaults.start
  const endParam = searchParams.get("end")
  const endField = endParam === "" ? null : (endParam ?? defaults.end)
  const titleField = meta?.title_field || "name"

  const load = useCallback(async () => {
    if (!meta || !startField) return
    setLoading(true); setError(null)
    const { from, to } = gridRange(buildMonthGrid(ym.year, ym.month))
    const isDt = (f: string | null) => dates.find((d) => d.fieldname === f)?.fieldtype === "Datetime"
    const upper = isDt(startField) ? `${to} 23:59:59` : to
    // Overlap test: starts before the grid ends, and (ends after it starts OR starts inside it)
    const filters: unknown[] = [[doctype, startField, "<=", upper]]
    const orFilters: unknown[] = endField
      ? [[doctype, endField, ">=", from], [doctype, startField, ">=", from]]
      : []
    if (!endField) filters.push([doctype, startField, ">=", from])
    if (meta.is_submittable === 1) filters.push([doctype, "docstatus", "!=", 2])
    try {
      frappe.invalidate(doctype)
      const rows = await frappe.getList({
        doctype,
        fields: Array.from(new Set(["name", titleField, startField, ...(endField ? [endField] : [])])),
        filters: filters as never,
        or_filters: orFilters as never,
        order_by: `${startField} asc`,
        limit: EVENT_LIMIT,
      })
      setEvents(toEvents(rows as Record<string, unknown>[], startField, endField, titleField))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load events")
    } finally {
      setLoading(false)
    }
  }, [frappe, doctype, meta, ym, startField, endField, titleField, dates])

  useEffect(() => { void load() }, [load])
  useRealtimeList(doctype, () => void load())

  function setField(key: "start" | "end", value: string) {
    const p = new URLSearchParams(searchParams.toString())
    p.set(key, value)
    router.replace(`?${p.toString()}`, { scroll: false })
  }

  function newOnDay(day: string) {
    if (!startField) return
    try {
      sessionStorage.setItem(prefillKey(doctype), JSON.stringify({ [startField]: day, ...(endField ? { [endField]: day } : {}) }))
    } catch {}
    router.push(`/form/${encodeURIComponent(doctype)}/new`)
  }

  const selectCls = "h-8 rounded-lg border border-border bg-background px-2 text-sm text-foreground"

  return (
    <div className="space-y-5">
      <DoctypeViewHeader
        doctype={doctype}
        meta={meta}
        active="calendar"
        actions={dates.length > 0 && startField ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            <label className="flex items-center gap-1.5">
              From
              <select aria-label="Start field" value={startField} onChange={(e) => setField("start", e.target.value)} className={selectCls}>
                {dates.map((f) => <option key={f.fieldname} value={f.fieldname}>{f.label || f.fieldname}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              To
              <select aria-label="End field" value={endField ?? ""} onChange={(e) => setField("end", e.target.value)} className={selectCls}>
                <option value="">(same day)</option>
                {dates.filter((f) => f.fieldname !== startField).map((f) => <option key={f.fieldname} value={f.fieldname}>{f.label || f.fieldname}</option>)}
              </select>
            </label>
          </div>
        ) : null}
      />
      {metaError && <p className="text-sm text-muted-foreground">{metaError}</p>}
      {meta && !startField && <p className="text-sm text-muted-foreground">{doctype} has no Date field to plot on a calendar.</p>}
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {meta && startField && (
        <CalendarView
          year={ym.year}
          month={ym.month}
          events={events}
          loading={loading}
          onNavigate={(year, month) => setYm({ year, month })}
          onEventClick={(name) => router.push(`/form/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`)}
          onDayClick={newOnDay}
        />
      )}
    </div>
  )
}
