"use client"
import { useCallback, useEffect, useState } from "react"
import { DocTimeline, buildTimeline, textToCommentHtml } from "@petal/ui"
import type { DocInfo, TimelineItem } from "@petal/ui"
import { useFrappe } from "@/hooks/useFrappe"
import { usePetalStore } from "@/store/petal-store"
import type { MetaField } from "./types"

/** Comments, change history, attachments and assignments for a saved document. */
export function DocActivity({
  doctype, name, doc, fields, reloadSignal = 0,
}: {
  doctype: string
  name: string
  doc: Record<string, unknown>
  fields: MetaField[]
  /** Increment to reload (e.g. after save or a realtime update). */
  reloadSignal?: number
}) {
  const frappe = useFrappe()
  const user = usePetalStore((s) => s.user)
  const [info, setInfo] = useState<DocInfo>({})
  const [items, setItems] = useState<TimelineItem[]>([])
  const [loading, setLoading] = useState(true)

  const labels = new Map(fields.map((f) => [f.fieldname, f.label || f.fieldname]))
  const owner = doc.owner
  const creation = doc.creation

  const load = useCallback(async () => {
    try {
      const di = (await frappe.getDocInfo(doctype, name)) as DocInfo
      setInfo(di)
      setItems(buildTimeline(di, { owner, creation }))
    } catch {
      // Activity is supplementary — a failure here shouldn't break the form
      setItems(buildTimeline({}, { owner, creation }))
    } finally {
      setLoading(false)
    }
  }, [frappe, doctype, name, owner, creation])

  useEffect(() => { void load() }, [load, reloadSignal])

  async function after<T>(p: Promise<T>) { await p; await load() }

  return (
    <div className="mt-8 border-t border-border pt-6">
      <DocTimeline
        items={items}
        attachments={info.attachments ?? []}
        assignments={info.assignments ?? []}
        loading={loading}
        {...(user?.name ? { currentUser: user.name } : {})}
        fieldLabel={(f) => labels.get(f) ?? f}
        onAddComment={(text) => after(frappe.addComment(doctype, name, textToCommentHtml(text), {
          email: user?.email ?? user?.name ?? "",
          fullName: user?.full_name ?? user?.name ?? "",
        }))}
        onDeleteComment={(id) => after(frappe.deleteComment(id))}
        onUpload={(file) => after(frappe.uploadFile(file, { doctype, docname: name, is_private: 1 }))}
        onRemoveAttachment={(id) => after(frappe.removeAttachment(doctype, name, id))}
        onAssign={(u) => after(frappe.assign(doctype, name, [u]))}
        onUnassign={(u) => after(frappe.unassign(doctype, name, u))}
      />
    </div>
  )
}
