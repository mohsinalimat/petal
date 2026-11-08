"use client"

import { useEffect, useState } from "react"
import { useFrappe } from "@/hooks/useFrappe"
import type { DocTypeMeta, MetaField } from "@/app/form/[doctype]/[name]/components/types"

export type DocMetaState = {
  meta: DocTypeMeta | null
  /** Child-table doctype name → its fields. */
  childMetas: Record<string, MetaField[]>
  error: string | null
  loading: boolean
}

/** Load DocType metadata (with child tables) via frappe.desk.form.load.getdoctype. */
export function useDocMeta(doctype: string): DocMetaState {
  const frappe = useFrappe()
  const [state, setState] = useState<DocMetaState>({ meta: null, childMetas: {}, error: null, loading: true })

  useEffect(() => {
    let cancelled = false
    setState({ meta: null, childMetas: {}, error: null, loading: true })
    frappe.callMethod<{ docs: DocTypeMeta[] }>("frappe.desk.form.load.getdoctype", { doctype })
      .then((res) => {
        if (cancelled) return
        const [meta, ...children] = res?.docs ?? []
        const childMetas: Record<string, MetaField[]> = {}
        for (const c of children) if (c.name && c.fields) childMetas[c.name] = c.fields
        setState({ meta: meta ?? null, childMetas, error: meta ? null : "DocType not found", loading: false })
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ meta: null, childMetas: {}, error: e instanceof Error ? e.message : "Could not load metadata", loading: false })
      })
    return () => { cancelled = true }
  }, [frappe, doctype])

  return state
}
