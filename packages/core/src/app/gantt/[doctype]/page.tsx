"use client"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { GanttView, dateFields } from "@petal/ui"
import { useFrappe } from "@/hooks/useFrappe"
import { useDocMeta } from "@/hooks/useDocMeta"
import { useRealtimeList } from "@/hooks/useRealtime"
import { defaultDateFields, defaultProgressField } from "@/lib/views/available-views"
import { DoctypeViewHeader } from "@/components/views/DoctypeViewHeader"

const GANTT_LIMIT = 300

export default function GanttPage() {
  const params = useParams()
  const doctype = decodeURIComponent(params.doctype as string)
  const router = useRouter()
  const searchParams = useSearchParams()
  const frappe = useFrappe()
  const { meta, error: metaError } = useDocMeta(doctype)

  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const dates = useMemo(() => (meta ? dateFields(meta.fields.filter((f) => f.hidden !== 1)) : []), [meta])
  const defaults = useMemo(() => (meta ? defaultDateFields(meta) : { start: null, end: null }), [meta])
  const startField = searchParams.get("start") ?? defaults.start
  const endField = searchParams.get("end") ?? defaults.end
  const progressField = meta ? defaultProgressField(meta) : null
  const titleField = meta?.title_field || "name"

  const load = useCallback(async () => {
    if (!meta || !startField || !endField) { setLoading(false); return }
    setError(null)
    const filters: unknown[] = [[doctype, startField, "is", "set"]]
    if (meta.is_submittable === 1) filters.push([doctype, "docstatus", "!=", 2])
    try {
      frappe.invalidate(doctype)
      const data = await frappe.getList({
        doctype,
        fields: Array.from(new Set(["name", titleField, startField, endField, ...(progressField ? [progressField] : [])])),
        filters: filters as never,
        order_by: `${startField} asc`,
        limit: GANTT_LIMIT,
      })
      setRows(data as Record<string, unknown>[])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load records")
    } finally {
      setLoading(false)
    }
  }, [frappe, doctype, meta, startField, endField, progressField, titleField])

  useEffect(() => { setLoading(true); void load() }, [load])
  useRealtimeList(doctype, () => void load())

  function setField(key: "start" | "end", value: string) {
    const p = new URLSearchParams(searchParams.toString())
    p.set(key, value)
    router.replace(`?${p.toString()}`, { scroll: false })
  }

  const selectCls = "h-8 rounded-lg border border-border bg-background px-2 text-sm text-foreground"

  return (
    <div className="space-y-5">
      <DoctypeViewHeader
        doctype={doctype}
        meta={meta}
        active="gantt"
        actions={dates.length > 1 && startField && endField ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            <label className="flex items-center gap-1.5">
              Start
              <select aria-label="Start field" value={startField} onChange={(e) => setField("start", e.target.value)} className={selectCls}>
                {dates.map((f) => <option key={f.fieldname} value={f.fieldname}>{f.label || f.fieldname}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-1.5">
              End
              <select aria-label="End field" value={endField} onChange={(e) => setField("end", e.target.value)} className={selectCls}>
                {dates.map((f) => <option key={f.fieldname} value={f.fieldname}>{f.label || f.fieldname}</option>)}
              </select>
            </label>
          </div>
        ) : null}
      />
      {metaError && <p className="text-sm text-muted-foreground">{metaError}</p>}
      {meta && (!startField || !endField) && (
        <p className="text-sm text-muted-foreground">A Gantt chart needs two Date fields (start and end) — {doctype} doesn&apos;t have them.</p>
      )}
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {loading && meta && startField && endField && <div className="h-64 rounded-xl bg-muted/40 animate-pulse" />}
      {!loading && !error && startField && endField && (
        <GanttView
          rows={rows}
          startField={startField}
          endField={endField}
          titleField={titleField}
          progressField={progressField}
          onBarClick={(name) => router.push(`/form/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`)}
        />
      )}
    </div>
  )
}
