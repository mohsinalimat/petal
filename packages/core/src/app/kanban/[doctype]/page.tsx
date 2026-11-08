"use client"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useParams, useRouter, useSearchParams } from "next/navigation"
import { KanbanBoard, groupableFields } from "@petal/ui"
import { useFrappe } from "@/hooks/useFrappe"
import { useDocMeta } from "@/hooks/useDocMeta"
import { useRealtimeList } from "@/hooks/useRealtime"
import { defaultKanbanField } from "@/lib/views/available-views"
import { DoctypeViewHeader } from "@/components/views/DoctypeViewHeader"

/** Boards fetch one page of records; larger doctypes should be filtered first. */
const BOARD_LIMIT = 500

export default function KanbanPage() {
  const params = useParams()
  const doctype = decodeURIComponent(params.doctype as string)
  const router = useRouter()
  const searchParams = useSearchParams()
  const frappe = useFrappe()
  const { meta, error: metaError } = useDocMeta(doctype)

  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [truncated, setTruncated] = useState(false)

  const groupOptions = useMemo(() => (meta ? groupableFields(meta.fields.filter((f) => f.hidden !== 1)) : []), [meta])
  const groupFieldName = searchParams.get("field") ?? (meta ? defaultKanbanField(meta) : null)
  const groupField = groupOptions.find((f) => f.fieldname === groupFieldName) ?? groupOptions[0] ?? null

  const titleField = meta?.title_field || "name"
  const cardFields = useMemo(
    () => (meta?.fields ?? [])
      .filter((f) => f.in_list_view === 1 && f.fieldname !== groupField?.fieldname && f.fieldname !== titleField)
      .slice(0, 3)
      .map((f) => ({ fieldname: f.fieldname, label: f.label })),
    [meta, groupField, titleField],
  )

  const load = useCallback(async () => {
    if (!meta || !groupField) return
    setError(null)
    try {
      const fields = Array.from(new Set(["name", "docstatus", titleField, groupField.fieldname, ...cardFields.map((f) => f.fieldname)]))
      const filters = meta.is_submittable === 1 ? [[doctype, "docstatus", "!=", 2]] : []
      frappe.invalidate(doctype)
      const data = await frappe.getList({
        doctype, fields, filters: filters as never, order_by: "modified desc", limit: BOARD_LIMIT + 1,
      })
      setTruncated(data.length > BOARD_LIMIT)
      setRows((data as Record<string, unknown>[]).slice(0, BOARD_LIMIT))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load records")
    } finally {
      setLoading(false)
    }
  }, [frappe, doctype, meta, groupField, titleField, cardFields])

  useEffect(() => { setLoading(true); void load() }, [load])
  useRealtimeList(doctype, () => void load())

  async function handleMove(name: string, value: string) {
    if (!groupField) return
    const row = rows.find((r) => r.name === name)
    const allowOnSubmit = meta?.fields.find((f) => f.fieldname === groupField.fieldname)?.allow_on_submit === 1
    if (row && Number(row.docstatus ?? 0) === 1 && !allowOnSubmit) {
      throw new Error(`${name} is submitted — ${groupField.label} can't be changed`)
    }
    await frappe.setValue(doctype, name, { [groupField.fieldname]: value })
  }

  function changeField(fieldname: string) {
    const p = new URLSearchParams(searchParams.toString())
    p.set("field", fieldname)
    router.replace(`?${p.toString()}`, { scroll: false })
  }

  return (
    <div className="space-y-5">
      <DoctypeViewHeader
        doctype={doctype}
        meta={meta}
        active="kanban"
        actions={groupOptions.length > 1 && groupField ? (
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Group by
            <select
              value={groupField.fieldname}
              onChange={(e) => changeField(e.target.value)}
              className="h-8 rounded-lg border border-border bg-background px-2 text-sm text-foreground"
            >
              {groupOptions.map((f) => <option key={f.fieldname} value={f.fieldname}>{f.label || f.fieldname}</option>)}
            </select>
          </label>
        ) : null}
      />

      {metaError && <p className="text-sm text-muted-foreground">{metaError}</p>}
      {meta && !groupField && (
        <p className="text-sm text-muted-foreground">{doctype} has no Select or Link field to group a board by.</p>
      )}
      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      {truncated && (
        <p className="text-xs text-amber-700 dark:text-amber-400">Showing the {BOARD_LIMIT} most recently modified records.</p>
      )}
      {loading && !error && meta && groupField && (
        <div className="flex gap-3 overflow-hidden">
          {[0, 1, 2].map((i) => <div key={i} className="w-72 h-64 shrink-0 rounded-xl bg-muted/40 animate-pulse" />)}
        </div>
      )}
      {!loading && groupField && (
        <KanbanBoard
          rows={rows}
          groupField={groupField}
          titleField={titleField}
          cardFields={cardFields}
          onCardClick={(name) => router.push(`/form/${encodeURIComponent(doctype)}/${encodeURIComponent(name)}`)}
          onMove={handleMove}
        />
      )}
    </div>
  )
}
