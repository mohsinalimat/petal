"use client"
import { useEffect, useRef, useState } from "react"
import { useFrappe } from "@/hooks/useFrappe"
import type { WorkflowTransition } from "@/lib/frappe/client"

/**
 * Workflow state badge + an "Actions" menu of transitions the current user may
 * take. Transitions come from frappe.model.workflow.get_transitions, which
 * already applies role and condition checks server-side.
 */
export function WorkflowActions({
  doc, stateField, disabled, onApplied, onError,
}: {
  doc: Record<string, unknown>
  stateField: string
  disabled?: boolean
  onApplied: (doc: Record<string, unknown>, action: string) => void
  onError: (message: string) => void
}) {
  const frappe = useFrappe()
  const [transitions, setTransitions] = useState<WorkflowTransition[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const state = doc[stateField] ? String(doc[stateField]) : null
  const modified = String(doc.modified ?? "")

  useEffect(() => {
    if (!doc.name) return
    let cancelled = false
    frappe.getWorkflowTransitions(doc)
      .then((t) => { if (!cancelled) setTransitions(t) })
      .catch(() => { if (!cancelled) setTransitions([]) })
    return () => { cancelled = true }
  // Re-query only when the saved state changes, not on every keystroke
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frappe, doc.name, state, modified])

  useEffect(() => {
    function h(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener("mousedown", h)
    return () => document.removeEventListener("mousedown", h)
  }, [])

  async function apply(action: string) {
    setOpen(false); setBusy(true)
    try {
      const updated = await frappe.applyWorkflow(doc, action) as unknown as Record<string, unknown>
      onApplied(updated, action)
    } catch (e) {
      onError(e instanceof Error ? e.message : `Could not ${action}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={ref} className="relative flex items-center gap-2">
      {state && (
        <span className="text-[11px] font-medium px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary" title="Workflow state">
          {state}
        </span>
      )}
      {transitions.length > 0 && (
        <>
          <button
            type="button"
            disabled={disabled || busy}
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={open}
            className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 flex items-center gap-1.5"
          >
            {busy && <span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            Actions
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/></svg>
          </button>
          {open && (
            <div role="menu" className="absolute right-0 top-full mt-1 min-w-[180px] rounded-xl border border-border bg-background shadow-xl py-1 z-50">
              {transitions.map((t) => (
                <button
                  key={`${t.action}-${t.next_state}`}
                  type="button"
                  role="menuitem"
                  onClick={() => void apply(t.action)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-accent"
                >
                  {t.action}
                  <span className="block text-[11px] text-muted-foreground">→ {t.next_state}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
