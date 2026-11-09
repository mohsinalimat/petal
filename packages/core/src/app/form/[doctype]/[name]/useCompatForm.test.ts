// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"

// One Form object per doctype, as in the runtime: openDoc loads a document into it.
const form: any = { doctype: "Sales Invoice", docname: "", doc: null, buttons: [], menuItems: [], dashboardIndicators: [], dashboardProgress: [], dashboardComments: [], dashboardSections: [], is_new: () => form.docname.startsWith("new-"), is_dirty: () => false, fields_dict: {} }
const gates: Record<string, () => void> = {}
const listeners = new Set<() => void>()
async function open(name: string) {
  await waitFor(() => expect(gates[name]).toBeTypeOf("function"))
  await act(async () => gates[name]!())
}

vi.mock("@/lib/frappe-compat/browser", () => ({ startCompat: async () => {} }))
vi.mock("@/lib/frappe-compat/request", () => ({ waitForPending: async () => {} }))
vi.mock("@/lib/frappe-compat", () => ({
  openDoc: (_dt: string, name: string) => new Promise((resolve) => {
    gates[name] = () => { form.docname = name === "new" ? "new-sales-invoice-1" : name; form.doc = { name: form.docname, docstatus: 0 }; resolve({ frm: form }) }
  }),
  effectiveFields: () => [], effectiveChildFields: () => ({}), snapshotDoc: (d: any) => ({ ...d }),
  subscribeForms: (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn) }, reloadDoc: async () => {}, searchLink: async () => [], setFieldFromUI: async () => {}, triggerButton: () => {},
}))

;(window as any).locals = { DocType: { "Sales Invoice": { name: "Sales Invoice" } } }
;(window as any).frappe = { get_indicator: () => null }

describe("useCompatForm", () => {
  it("does not expose the previous document while the next one loads", async () => {
    const { useCompatForm } = await import("./useCompatForm")
    const { result, rerender } = renderHook(({ name }) => useCompatForm("Sales Invoice", name, { enabled: true }), { initialProps: { name: "SINV-1" } })
    await open("SINV-1")
    await waitFor(() => expect(result.current.derived?.docname).toBe("SINV-1"))

    rerender({ name: "SINV-2" })
    // Form still holds SINV-1: nothing is shown (so GenericForm can't redirect back to it).
    expect(result.current.derived).toBeNull()
    expect(result.current.frm).toBeNull()
    await open("SINV-2")
    await waitFor(() => expect(result.current.derived?.docname).toBe("SINV-2"))
  })

  it("keeps the saved document when the URL moves from /new to its name", async () => {
    const { useCompatForm } = await import("./useCompatForm")
    const { result, rerender } = renderHook(({ name }) => useCompatForm("Sales Invoice", name, { enabled: true }), { initialProps: { name: "new" } })
    await open("new")
    await waitFor(() => expect(result.current.derived?.isNew).toBe(true))
    // Save: the runtime renames the doc in place.
    await act(async () => { form.docname = "SINV-9"; form.doc = { name: "SINV-9", docstatus: 0 }; listeners.forEach((fn) => fn()) })
    rerender({ name: "new" })
    expect(result.current.derived?.docname).toBe("SINV-9")
    delete gates["SINV-9"]
    rerender({ name: "SINV-9" })
    expect(result.current.derived?.docname).toBe("SINV-9")
    expect(gates["SINV-9"]).toBeUndefined() // no reload of a document already in hand
  })
})
