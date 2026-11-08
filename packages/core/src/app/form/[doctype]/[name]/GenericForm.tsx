"use client"
import React, { useMemo, useEffect, useState, useRef } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { usePetalStore } from "@/store/petal-store"
import { useFrappe, getFrappeClient } from "@/hooks/useFrappe"
import type { FrappeDocument } from "@petal/sdk"
import { parseLayout } from "./components/parseLayout"
import { SectionBlock } from "./components/SectionBlock"
import { MoreActionsDropdown } from "./components/MoreActionsDropdown"
import { PrintModal } from "./components/PrintModal"
import { DeleteConfirmDialog, DocStatusBadge, FieldValue } from "@petal/ui"
import { ToastList, playChime } from "./components/Toast"
import type { Toast } from "./components/Toast"
import type { DocTypeMeta, MetaField } from "./components/types"
import { WorkflowActions } from "./components/WorkflowActions"
import { DocActivity } from "./components/DocActivity"
import { useRealtimeDoc } from "@/hooks/useRealtime"
import { buildAmendment, computeDefaults, missingRequired, prefillKey, stripForCopy } from "@/lib/doc/doc-utils"

export function GenericForm({ doctype, name, onIsSingle, toolbarSlot }: { doctype: string; name: string; onIsSingle?: (v: boolean) => void; toolbarSlot?: React.ReactNode }) {
  const frappe        = useFrappe()
  const { hooks, user, settings } = usePetalStore()
  const currency      = (settings.currency as string | undefined) ?? "USD"
  const router        = useRouter()
  const searchParams  = useSearchParams()
  const returnTo      = searchParams.get("returnTo")
  const returnField   = searchParams.get("returnField")
  const focusField    = searchParams.get("focusField")
  const focusValue    = searchParams.get("focusValue")
  const isNew         = name === "new"
  const startInEdit   = isNew || searchParams.get("edit") === "1"

  const [meta, setMeta]                     = useState<DocTypeMeta | null>(null)
  const [childMetas, setChildMetas]         = useState<Record<string, MetaField[]>>({})
  const [values, setValues]                 = useState<Record<string, unknown>>({})
  const [loading, setLoading]               = useState(true)
  const [saving, setSaving]                 = useState(false)
  const [deleting, setDeleting]             = useState(false)
  const [error, setError]                   = useState<string | null>(null)
  const [isEditing, setIsEditing]           = useState(startInEdit)
  const [activeTab, setActiveTab]           = useState(0)
  const [isDirty, setIsDirty]               = useState(false)
  const [showPrint, setShowPrint]           = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [pasteMsg, setPasteMsg]             = useState<string | null>(null)
  const [missingFields, setMissingFields]   = useState<Set<string>>(new Set())
  const [toasts, setToasts]                 = useState<Toast[]>([])
  const toastIdRef                          = useRef(0)
  const hiddenPasteRef                      = useRef<HTMLTextAreaElement>(null)
  const imageInputRef                       = useRef<HTMLInputElement>(null)
  const [imageUploading, setImageUploading] = useState(false)
  const [activitySignal, setActivitySignal] = useState(0)
  /** Set when another user saves this doc while it has unsaved local edits. */
  const [remoteChange, setRemoteChange]     = useState<string | null>(null)

  function addToast(type: Toast["type"], message: string) {
    const id = ++toastIdRef.current
    setToasts((prev) => [...prev, { id, type, message }])
    playChime(type)
  }

  function dismissToast(id: number) {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }

  async function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !imageFieldname) return
    setImageUploading(true)
    try {
      const url = await getFrappeClient().uploadFile(file)
      handleChange(imageFieldname, url)
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Image upload failed")
    } finally {
      setImageUploading(false)
      if (imageInputRef.current) imageInputRef.current.value = ""
    }
  }

  async function searchLink(
    doctype: string,
    query: string,
  ): Promise<{ value: string; description?: string }[]> {
    try {
      if (query.trim()) {
        const r = await frappe.callMethod<unknown>("frappe.desk.search.search_link", {
          txt: query, doctype, ignore_user_permissions: 0, reference_doctype: "",
        })
        const list = Array.isArray(r) ? r : ((r as Record<string, unknown>)?.results ?? [])
        return list as { value: string; description?: string }[]
      }
      const docs = await frappe.getList({ doctype, fields: ["name"], limit: 10 })
      return docs.map((d) => ({ value: String(d.name) }))
    } catch { return [] }
  }

  useEffect(() => {
    setLoading(true); setError(null); setActiveTab(0); setIsDirty(false); setIsEditing(startInEdit)
    Promise.all([
      frappe.callMethod<{ docs: DocTypeMeta[] }>("frappe.desk.form.load.getdoctype", { doctype }),
      isNew ? Promise.resolve(null) : frappe.getDoc<FrappeDocument>(doctype, name),
    ])
      .then(([metaRes, docRes]) => {
        const allDocs = (metaRes as { docs: DocTypeMeta[] })?.docs ?? []
        const m = allDocs[0]
        if (m) {
          setMeta(m)
          onIsSingle?.(m.issingle === 1)
          const cm: Record<string, MetaField[]> = {}
          for (const child of allDocs.slice(1)) {
            if (child.name && child.fields) cm[child.name] = child.fields
          }
          setChildMetas(cm)
        }
        if (docRes) {
          setValues(docRes as Record<string, unknown>)
        } else if (m) {
          const defs = computeDefaults(m.fields, { user: user?.name ?? null })
          if (focusField && focusValue) defs[focusField] = focusValue

          // Merge values pre-filled by Quick Entry's "Edit Full Form" action
          try {
            const qeKey = prefillKey(doctype)
            const qeStored = sessionStorage.getItem(qeKey)
            if (qeStored) {
              sessionStorage.removeItem(qeKey)
              Object.assign(defs, JSON.parse(qeStored) as Record<string, unknown>)
            }
          } catch {}

          setValues(defs)
        }
        if (focusField && focusValue) {
          setTimeout(() => document.getElementById(`link-field-${focusField}`)?.focus(), 100)
        }
      })
      .catch(() => setError("Could not load this document."))
      .finally(() => setLoading(false))
  }, [frappe, doctype, name, isNew])

  const layout = useMemo(() => (meta ? parseLayout(meta.fields) : []), [meta])
  const imageFieldname = useMemo(
    () => meta?.image_field ?? meta?.fields.find((f) => f.fieldtype === "Image")?.fieldname ?? null,
    [meta]
  )

  const behaviorFn    = hooks.form_field_behaviors?.[doctype]
  const fieldBehaviors = useMemo(
    () => (behaviorFn ? behaviorFn(values) : {}),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [behaviorFn, values]
  )

  const isEditingRef = useRef(isEditing)
  const savingRef    = useRef(saving)
  const docstatusRef = useRef(0)
  useEffect(() => { isEditingRef.current = isEditing }, [isEditing])
  useEffect(() => { savingRef.current    = saving    }, [saving])
  useEffect(() => { docstatusRef.current = Number(values.docstatus ?? 0) }, [values.docstatus])

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey

      if (e.key === "Escape" && isEditingRef.current && !isNew) {
        e.preventDefault()
        setIsEditing(false)
        setIsDirty(false)
        return
      }

      if (!mod) return

      switch (e.key.toLowerCase()) {
        case "s":
          e.preventDefault()
          if (isEditingRef.current && !savingRef.current) handleSave()
          break
        case "e":
          e.preventDefault()
          if (!isEditingRef.current && docstatusRef.current === 0) setIsEditing(true)
          break
      }
    }

    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNew])

  function handleChange(fieldname: string, v: unknown) {
    setValues((prev) => ({ ...prev, [fieldname]: v }))
    setIsDirty(true)

    if (missingFields.has(fieldname) && v !== "" && v !== null && v !== undefined) {
      setMissingFields((prev) => { const next = new Set(prev); next.delete(fieldname); return next })
    }

    if (!meta || !v) return
    const changedField = meta.fields.find((f) => f.fieldname === fieldname)
    if (changedField?.fieldtype !== "Link" || !changedField.options) return
    const fetchTargets = meta.fields.filter((f) => f.fetch_from?.startsWith(`${fieldname}.`))
    if (fetchTargets.length === 0) return
    frappe.getDoc(changedField.options, String(v))
      .then((doc) => {
        const updates: Record<string, unknown> = {}
        for (const f of fetchTargets) {
          const remoteField = f.fetch_from!.split(".")[1]!
          updates[f.fieldname] = (doc as Record<string, unknown>)[remoteField]
        }
        setValues((prev) => ({ ...prev, ...updates }))
      })
      .catch(() => {})
  }

  function findFieldTab(fieldname: string): number {
    for (let i = 0; i < layout.length; i++) {
      for (const section of layout[i]!.sections) {
        for (const col of section.columns) {
          if (col.fields.some((f) => f.fieldname === fieldname)) return i
        }
      }
    }
    return 0
  }

  /** Re-fetch the saved document (after a remote change or workflow action). */
  async function reloadDoc() {
    if (isNew) return
    frappe.invalidate(doctype)
    try {
      const fresh = await frappe.getDoc<FrappeDocument>(doctype, name)
      setValues(fresh as Record<string, unknown>)
      setIsDirty(false)
      setRemoteChange(null)
      setActivitySignal((n) => n + 1)
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Could not reload document")
    }
  }

  const isDirtyRef = useRef(isDirty)
  useEffect(() => { isDirtyRef.current = isDirty }, [isDirty])
  const modifiedRef = useRef<unknown>(null)
  useEffect(() => { modifiedRef.current = values.modified }, [values.modified])

  useRealtimeDoc(doctype, name, (p) => {
    // Ignore our own saves (already applied) and stale/duplicate events
    if (p.modified && p.modified === modifiedRef.current) return
    if (savingRef.current) return
    if (isEditingRef.current && isDirtyRef.current) {
      setRemoteChange(p.user ? `${p.user} saved a newer version of this document.` : "This document was changed by someone else.")
    } else {
      void reloadDoc()
    }
  })

  async function handleSave() {
    if (meta) {
      const missing = missingRequired(meta.fields, values, fieldBehaviors)

      if (missing.length > 0) {
        setMissingFields(new Set(missing))
        const first = missing[0]!
        setActiveTab(findFieldTab(first))
        setError(
          `${missing.length} required field${missing.length > 1 ? "s are" : " is"} missing`
        )
        setTimeout(() => {
          document.getElementById(`field-${first}`)?.scrollIntoView({ behavior: "smooth", block: "center" })
        }, 50)
        return
      }
    }

    setMissingFields(new Set())
    setSaving(true); setError(null)
    try {
      const payload = { doctype, ...(isNew ? {} : { name }), ...values } as Partial<FrappeDocument> & { doctype: string }
      const saved = await frappe.saveDoc(payload)
      setValues(saved as Record<string, unknown>)
      setIsDirty(false); setIsEditing(false); setRemoteChange(null)
      setActivitySignal((n) => n + 1)
      addToast("success", isNew ? `${doctype} created` : "Document saved")
      if (isNew && saved.name) {
        if (returnTo && returnField) {
          router.replace(`${returnTo}?focusField=${returnField}&focusValue=${encodeURIComponent(saved.name)}`)
        } else {
          router.replace(`/form/${encodeURIComponent(doctype)}/${encodeURIComponent(saved.name)}`)
        }
      }
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Save failed. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  async function handleSubmit() {
    setSaving(true); setError(null)
    try {
      const submitted = await frappe.callMethod<Record<string, unknown>>("frappe.client.submit", { doc: { ...values, doctype, name } })
      setValues((p) => ({ ...p, ...(submitted && typeof submitted === "object" ? submitted : {}), docstatus: 1 })); setIsEditing(false)
      frappe.invalidate(doctype); setActivitySignal((n) => n + 1)
      addToast("success", "Document submitted")
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Submit failed.")
    } finally { setSaving(false) }
  }

  async function handleCancel() {
    setSaving(true); setError(null)
    try {
      await frappe.callMethod("frappe.client.cancel", { doctype, name })
      setValues((p) => ({ ...p, docstatus: 2 })); setIsEditing(false)
      frappe.invalidate(doctype); setActivitySignal((n) => n + 1)
      addToast("success", "Document cancelled")
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Cancel failed.")
    } finally { setSaving(false) }
  }

  async function handleDuplicate() {
    setSaving(true); setError(null)
    try {
      const duped = stripForCopy(values, meta?.fields ?? [])
      const saved = await frappe.saveDoc({ doctype, ...duped } as Partial<FrappeDocument> & { doctype: string })
      router.push(`/form/${encodeURIComponent(doctype)}/${encodeURIComponent(String(saved.name))}`)
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Duplicate failed.")
      setSaving(false)
    }
  }

  /** Open a new draft pre-filled from this cancelled doc, linked via amended_from. */
  function handleAmend() {
    try {
      sessionStorage.setItem(prefillKey(doctype), JSON.stringify(buildAmendment(values, name, meta?.fields ?? [])))
    } catch {}
    router.push(`/form/${encodeURIComponent(doctype)}/new`)
  }

  function handleWorkflowApplied(updated: Record<string, unknown>, action: string) {
    setValues((p) => ({ ...p, ...updated }))
    setIsDirty(false); setIsEditing(false)
    frappe.invalidate(doctype)
    setActivitySignal((n) => n + 1)
    addToast("success", `${action} applied`)
  }

  function handleCopyJSON() {
    const json = JSON.stringify({ doctype, ...values }, null, 2)
    navigator.clipboard.writeText(json).catch(() => {})
  }

  function applyPastedJSON(text: string): boolean {
    const STRIP = new Set(["name", "doctype", "docstatus", "creation", "modified", "modified_by", "owner", "amended_from", "__islocal", "idx"])
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      if (typeof parsed !== "object" || Array.isArray(parsed) || parsed === null) return false
      const merged: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(parsed)) {
        if (!STRIP.has(k)) merged[k] = v
      }
      setValues((prev) => ({ ...prev, ...merged }))
      setIsDirty(true)
      return true
    } catch {
      return false
    }
  }

  useEffect(() => {
    if (!isNew) return
    function onGlobalPaste(e: ClipboardEvent) {
      const active = document.activeElement
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) return
      const text = e.clipboardData?.getData("text/plain") ?? ""
      if (!text) return
      if (applyPastedJSON(text)) {
        e.preventDefault()
        setPasteMsg("Fields filled from clipboard")
        setTimeout(() => setPasteMsg(null), 2000)
      }
    }
    window.addEventListener("paste", onGlobalPaste)
    return () => window.removeEventListener("paste", onGlobalPaste)
  }, [isNew])

  function onHiddenPaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const text = e.clipboardData.getData("text/plain")
    e.preventDefault()
    const ok = applyPastedJSON(text)
    setPasteMsg(ok ? "Fields filled!" : "Invalid JSON")
    setTimeout(() => setPasteMsg(null), 2000)
    hiddenPasteRef.current?.blur()
  }

  async function handleDelete() {
    setDeleting(true); setError(null)
    try {
      await frappe.callMethod("frappe.client.delete", { doctype, name })
      router.push(`/list/${encodeURIComponent(doctype)}`)
    } catch (err) {
      addToast("error", err instanceof Error ? err.message : "Delete failed.")
      setDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  // ---- Loading ----
  if (loading) {
    return (
      <div className="space-y-5 animate-pulse">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 pb-5 border-b border-border">
          <div className="space-y-2">
            <div className="h-6 w-52 bg-muted rounded-lg" />
            <div className="h-5 w-16 bg-muted/60 rounded-full" />
          </div>
          <div className="flex gap-2">
            <div className="h-8 w-16 bg-muted rounded-lg" />
            <div className="h-8 w-20 bg-muted rounded-lg" />
          </div>
        </div>
        <div className="flex gap-0 border-b border-border">
          {[72, 88, 64].map((w, i) => <div key={i} className="h-9 bg-muted/50 rounded-t mr-1" style={{ width: w }} />)}
        </div>
        {[2, 2, 1].map((cols, si) => (
          <div key={si} className="border border-border overflow-hidden">
            <div className="h-10 bg-muted/30 border-b border-border" />
            <div className={`p-4 sm:p-5 grid gap-6 ${cols > 1 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-1"}`}>
              {Array.from({ length: cols * 3 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <div className="h-2.5 w-16 bg-muted/70 rounded" />
                  <div className="h-5 w-full bg-muted/40 rounded" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    )
  }

  // ---- Error ----
  if (error && !meta) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center gap-3">
        <div className="w-12 h-12 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
          <svg className="w-6 h-6 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"/>
          </svg>
        </div>
        <p className="font-semibold text-foreground">{error}</p>
      </div>
    )
  }

  const docstatus     = Number(values.docstatus ?? 0)
  const isSubmittable = (meta?.is_submittable ?? 0) === 1
  const workflow      = meta?.__workflow_docs?.find((w) => w.is_active !== 0)
  const workflowField = workflow ? (workflow.workflow_state_field || "workflow_state") : null
  const canDelete     = !isNew && (!isSubmittable || docstatus !== 1)
  const titleField    = meta?.title_field
  const docTitle      = (titleField && values[titleField]) ? String(values[titleField]) : (isNew ? `New ${doctype}` : name)

  const imageUrl   = imageFieldname ? (values[imageFieldname] as string | undefined) ?? "" : ""
  const skipFields = imageFieldname ? new Set([imageFieldname]) : undefined

  return (
    <div className="space-y-0 pb-12">
      {/* ── Form header ─────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 sm:gap-4 pb-5 border-b border-border mb-6">
        <div className="flex items-center gap-3 min-w-0">
          {/* Image avatar */}
          {imageFieldname && (
            <div className="relative group shrink-0">
              {imageUrl ? (
                <img src={imageUrl} alt="" className="w-14 h-14 rounded-xl object-cover border border-border bg-muted/20" />
              ) : (
                <div className="w-14 h-14 rounded-xl border-2 border-dashed border-border/50 bg-muted/10 flex items-center justify-center text-muted-foreground/30">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
              )}
              {isEditing && (
                <>
                  <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                  <button
                    type="button"
                    onClick={() => imageInputRef.current?.click()}
                    disabled={imageUploading}
                    className="absolute inset-0 rounded-xl bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity disabled:cursor-not-allowed"
                  >
                    {imageUploading
                      ? <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                      : <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8} aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                        </svg>
                    }
                  </button>
                  {imageUrl && (
                    <button
                      type="button"
                      onClick={() => handleChange(imageFieldname, "")}
                      className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-background border border-border shadow-sm flex items-center justify-center text-muted-foreground hover:text-destructive hover:border-destructive opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </>
              )}
            </div>
          )}
          <div className="min-w-0 space-y-1.5">
            <h1 className="text-xl font-bold text-foreground truncate leading-tight">{docTitle}</h1>
            <div className="flex items-center gap-2 flex-wrap">
              {isSubmittable && <DocStatusBadge docstatus={docstatus} />}
              {isDirty && (
                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 px-2 py-0.5 rounded-full">
                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <circle cx="12" cy="12" r="9"/><path strokeLinecap="round" d="M12 7v5l3 3"/>
                  </svg>
                  Unsaved
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap sm:justify-end sm:shrink-0">
          {error && (
            <span className="text-xs text-red-500 max-w-[220px] text-right leading-snug">{error}</span>
          )}

          {isEditing ? (
            <>
              {!isNew && (
                <button
                  onClick={() => { setIsEditing(false); setIsDirty(false) }}
                  disabled={saving}
                  title="Discard changes (Esc)"
                  className="h-8 px-3 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40 transition-colors flex items-center gap-1.5"
                >
                  Discard
                  <kbd className="hidden sm:inline text-[10px] font-mono bg-muted/80 text-muted-foreground px-1 py-0.5 rounded border border-border/60 leading-none">Esc</kbd>
                </button>
              )}
              {isNew && (
                <>
                  <textarea
                    ref={hiddenPasteRef}
                    aria-hidden="true"
                    tabIndex={-1}
                    onPaste={onHiddenPaste}
                    className="sr-only"
                    readOnly={false}
                  />
                  {pasteMsg && (
                    <span className="text-xs text-muted-foreground px-2">{pasteMsg}</span>
                  )}
                </>
              )}
              <button
                onClick={handleSave}
                disabled={saving}
                title="Save (Ctrl+S / ⌘S)"
                className="h-8 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 transition-all flex items-center gap-2"
              >
                {saving && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                {isNew ? "Create" : "Save"}
                {!saving && (
                  <kbd className="hidden sm:inline text-[10px] font-mono bg-white/20 px-1 py-0.5 rounded leading-none">⌘S</kbd>
                )}
              </button>
            </>
          ) : (
            <>
              {!isNew && (
                <button
                  onClick={() => setShowPrint(true)}
                  title="Print"
                  className="h-8 px-3 rounded-lg border border-border bg-background text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.056 48.056 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659"/>
                  </svg>
                  Print
                </button>
              )}
              {docstatus === 0 && (
                <button
                  onClick={() => setIsEditing(true)}
                  title="Edit (Ctrl+E / ⌘E)"
                  className="h-8 px-3 rounded-lg border border-border bg-background text-sm text-foreground hover:bg-accent transition-colors flex items-center gap-1.5"
                >
                  <svg className="w-3.5 h-3.5 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125"/>
                  </svg>
                  Edit
                  <kbd className="hidden sm:inline text-[10px] font-mono bg-muted/80 text-muted-foreground px-1 py-0.5 rounded border border-border/60 leading-none">⌘E</kbd>
                </button>
              )}
              {workflowField && !isNew && (
                <WorkflowActions
                  doc={{ ...values, doctype, name }}
                  stateField={workflowField}
                  disabled={saving || isDirty}
                  onApplied={handleWorkflowApplied}
                  onError={(m) => addToast("error", m)}
                />
              )}
              {isSubmittable && !workflowField && docstatus === 0 && !isNew && (
                <button
                  onClick={handleSubmit}
                  disabled={saving}
                  className="h-8 px-3 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60 transition-colors"
                >
                  Submit
                </button>
              )}
              {isSubmittable && docstatus === 2 && (
                <button
                  onClick={handleAmend}
                  disabled={saving}
                  title="Create an amended copy of this cancelled document"
                  className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors"
                >
                  Amend
                </button>
              )}
              {isSubmittable && !workflowField && docstatus === 1 && (
                <button
                  onClick={handleCancel}
                  disabled={saving}
                  className="h-8 px-3 rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-60 transition-colors"
                >
                  Cancel
                </button>
              )}
              {!isNew && (
                <MoreActionsDropdown
                  onDuplicate={handleDuplicate}
                  onCopyJSON={handleCopyJSON}
                  onDelete={() => setShowDeleteConfirm(true)}
                  canDelete={canDelete}
                  disabled={saving}
                />
              )}
              {toolbarSlot}
            </>
          )}
        </div>
      </div>

      {remoteChange && (
        <div role="status" className="mb-4 flex flex-col sm:flex-row sm:items-center gap-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 px-4 py-2.5 text-sm text-amber-800 dark:text-amber-300">
          <span className="flex-1">{remoteChange} Saving now may overwrite their changes.</span>
          <button type="button" onClick={() => void reloadDoc()} className="h-7 px-3 rounded-md border border-amber-300 dark:border-amber-700 text-xs font-medium hover:bg-amber-100 dark:hover:bg-amber-900/40">
            Discard mine &amp; reload
          </button>
        </div>
      )}

      {/* ── Main form area ─────────────────────────── */}
      <div className="space-y-6">
          {/* Tabs */}
          {layout.length > 1 && (
            <div className="flex gap-0 border-b border-border overflow-x-auto">
              {layout.map((tab, i) => (
                <button
                  key={tab.fieldname}
                  onClick={() => setActiveTab(i)}
                  className={`relative px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors ${
                    i === activeTab
                      ? "text-primary"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab.label}
                  {i === activeTab && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t-full" />
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Tab content */}
          {layout.length > 0 && layout[activeTab] && (
            <div className="space-y-6">
              {layout[activeTab].sections.map((section, si) => (
                <SectionBlock
                  key={si}
                  section={section}
                  values={values}
                  isEditing={isEditing}
                  onChange={handleChange}
                  fieldBehaviors={fieldBehaviors}
                  childMetas={childMetas}
                  onLinkSearch={searchLink}
                  missingFields={missingFields}
                  currency={currency}
                  {...(skipFields ? { skipFields } : {})}
                />
              ))}
            </div>
          )}

          {/* Metadata footer */}
          {!isNew && (
            <div className="mt-6 border border-border/60 bg-muted/20 overflow-hidden">
              <div className="px-3 sm:px-5 py-2.5 border-b border-border/40">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Document Info</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-border/40">
                {[
                  { label: "Created",     value: <FieldValue value={values.creation} fieldtype="Datetime" /> },
                  { label: "Owner",       value: String(values.owner ?? "—") },
                  { label: "Modified",    value: <FieldValue value={values.modified} fieldtype="Datetime" /> },
                  { label: "Modified by", value: String((values as Record<string, unknown>).modified_by ?? "—") },
                ].map((m) => (
                  <div key={m.label} className="px-3 sm:px-5 py-3 space-y-0.5">
                    <p className="text-[10px] font-semibold text-muted-foreground/60 uppercase tracking-wider">{m.label}</p>
                    <p className="text-xs text-foreground/70">{m.value}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

      {!isNew && meta && meta.issingle !== 1 && (
        <DocActivity
          doctype={doctype}
          name={name}
          doc={values}
          fields={meta.fields}
          reloadSignal={activitySignal}
        />
      )}

      {/* ── Delete confirm ──────────────────────────── */}
      <DeleteConfirmDialog
        open={showDeleteConfirm}
        doctype={doctype}
        target={name}
        deleting={deleting}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      {/* ── Print modal ─────────────────────────────── */}
      {showPrint && (
        <PrintModal
          doctype={doctype}
          name={name}
          onClose={() => setShowPrint(false)}
        />
      )}

      <ToastList toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
