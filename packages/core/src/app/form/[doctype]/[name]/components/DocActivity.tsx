"use client"
import { useCallback, useEffect, useState } from "react"
import { DocSidebar, DocTimeline, buildTimeline, textToCommentHtml } from "@petal/ui"
import type { DocInfo, TimelineItem } from "@petal/ui"
import { useFrappe } from "@/hooks/useFrappe"
import { usePetalStore } from "@/store/petal-store"
import type { MetaField } from "./types"

/**
 * Comments, change history, attachments and assignments for a saved document.
 * One fetch feeds both views: <DocActivityFeed> under the form and
 * <DocActivitySidebar> beside it.
 */
export function useDocActivity({
  doctype, name, doc, enabled = true, reloadSignal = 0,
}: {
  doctype: string
  name: string
  doc: Record<string, unknown>
  enabled?: boolean
  /** Increment to reload (e.g. after save or a realtime update). */
  reloadSignal?: number
}) {
  const frappe = useFrappe()
  const user = usePetalStore((s) => s.user)
  const [info, setInfo] = useState<DocInfo>({})
  const [items, setItems] = useState<TimelineItem[]>([])
  const [loading, setLoading] = useState(true)

  const owner = doc.owner
  const creation = doc.creation

  const load = useCallback(async () => {
    if (!enabled) return
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
  }, [frappe, doctype, name, owner, creation, enabled])

  useEffect(() => { void load() }, [load, reloadSignal])

  async function after<T>(p: Promise<T>) { await p; await load() }

  return {
    info, items, loading, user,
    addComment: (text: string) => after(frappe.addComment(doctype, name, textToCommentHtml(text), {
      email: user?.email ?? user?.name ?? "",
      fullName: user?.full_name ?? user?.name ?? "",
    })),
    deleteComment: (id: string) => after(frappe.deleteComment(id)),
    upload: (file: File) => after(frappe.uploadFile(file, { doctype, docname: name, is_private: 1 })),
    removeAttachment: (id: string) => after(frappe.removeAttachment(doctype, name, id)),
    assign: (u: string) => after(frappe.assign(doctype, name, [u])),
    unassign: (u: string) => after(frappe.unassign(doctype, name, u)),
  }
}

export type DocActivityState = ReturnType<typeof useDocActivity>

/** Comment box + timeline (assignments/attachments live in the sidebar). */
export function DocActivityFeed({ activity, fields }: { activity: DocActivityState; fields: MetaField[] }) {
  const labels = new Map(fields.map((f) => [f.fieldname, f.label || f.fieldname]))
  const { items, loading, user } = activity
  return (
    <div className="mt-8 border-t border-border pt-6">
      <DocTimeline
        items={items}
        loading={loading}
        showSidebar={false}
        {...(user?.name ? { currentUser: user.name } : {})}
        fieldLabel={(f) => labels.get(f) ?? f}
        onAddComment={activity.addComment}
        onDeleteComment={activity.deleteComment}
      />
    </div>
  )
}

export function DocActivitySidebar({
  activity, children, className,
}: { activity: DocActivityState; children?: React.ReactNode; className?: string }) {
  return (
    <DocSidebar
      attachments={activity.info.attachments ?? []}
      assignments={activity.info.assignments ?? []}
      onUpload={activity.upload}
      onRemoveAttachment={activity.removeAttachment}
      onAssign={activity.assign}
      onUnassign={activity.unassign}
      {...(className ? { className } : {})}
    >
      {children}
    </DocSidebar>
  )
}
