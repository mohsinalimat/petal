/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Field types Petal has no input for are drawn by Desk's own controls
 * (controls.bundle.js, loaded on demand) inside Petal's form, and edits in
 * them flow through frappe.model.set_value like any other field.
 * Needs a local bench for the bundle (skipped otherwise).
 */
import fs from "fs"
import path from "path"
import { describe, expect, it, vi } from "vitest"
import { act, fireEvent, render, waitFor } from "@testing-library/react"

const BENCH = process.env.FRAPPE_BENCH ?? path.resolve(__dirname, "../../../../../../../../frappe-bench")
const ASSETS = path.join(BENCH, "sites/assets/assets.json")
const HAS_BENCH = fs.existsSync(ASSETS)

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@/hooks/useRealtime", () => ({ useRealtimeDoc: () => {}, useRealtimeList: () => {}, getRealtimeClient: async () => null }))

const SCRIPT = `frappe.ui.form.on("Desk Control Test", { duration(frm) { window.__petal_duration_seen = frm.doc.duration } });`
const META = {
  doctype: "DocType", name: "Desk Control Test", module: "Core", __js: SCRIPT,
  fields: [
    { fieldname: "title", fieldtype: "Data", label: "Title" },
    { fieldname: "duration", fieldtype: "Duration", label: "Time Taken" },
    { fieldname: "party_type", fieldtype: "Select", label: "Party Type", options: "Customer\nSupplier" },
    { fieldname: "party", fieldtype: "Dynamic Link", label: "Party", options: "party_type" },
  ].map((f, i) => ({ ...f, parent: "Desk Control Test", idx: i + 1 })),
}

vi.mock("@/lib/frappe-compat/browser", async () => {
  const compat = await import("@/lib/frappe-compat")
  return {
    setCompatNavigator: () => {},
    startCompat: () => compat.ensureCompat({
      transport: async (method: string) => {
        if (method === "frappe.sessions.get") return { status: 200, data: { message: { sysdefaults: { date_format: "dd-mm-yyyy" }, user: { name: "Administrator", roles: ["Administrator"], defaults: {}, can_create: ["Desk Control Test"] } } } }
        if (method === "frappe.desk.form.load.getdoctype") return { status: 200, data: { docs: [META] } }
        return { status: 200, data: { message: null } }
      },
      navigate: () => {},
      toast: () => {},
      autoBundles: false,
      fetchText: async (url: string) => {
        const p = url === "/assets/assets.json" ? ASSETS : path.join(BENCH, "sites", url)
        return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "{}"
      },
    }),
  }
})

describe.skipIf(!HAS_BENCH)("Desk controls in Petal's form", () => {
  it("draws Duration and Dynamic Link with Desk's controls and writes edits to the model", async () => {
    const { usePetalStore } = await import("@/store/petal-store")
    usePetalStore.setState({
      hooks: { frappe_compat: { enabled: true } } as any,
      hooksReady: true,
      user: { name: "Administrator", email: "a@x.co", full_name: "Administrator", first_name: "A", username: "a", user_type: "System User", roles: ["Administrator"] },
      authStatus: "authenticated",
      settings: {},
    })
    const { GenericForm } = await import("./GenericForm")
    const { container } = render(<GenericForm doctype="Desk Control Test" name="new" />)

    const duration = await waitFor(() => {
      const el = container.querySelector('.petal-desk .frappe-control[data-fieldtype="Duration"]')
      expect(el).not.toBeNull()
      return el as HTMLElement
    }, { timeout: 20_000 })
    // Desk's own label and input, not Petal's
    expect(duration.textContent).toContain("Time Taken")
    expect(container.querySelector('.petal-desk .frappe-control[data-fieldtype="Dynamic Link"] input')).not.toBeNull()

    // Petal's own fields still render with Petal's inputs
    expect(container.querySelector('#field-input-title')).not.toBeNull()

    // An edit in Desk's control goes through frappe.model.set_value → the doctype's handler
    const w = window as any
    const frm = w.cur_frm
    const control = frm.fields_dict.duration.deskControl
    await act(async () => { await control.set_value(5400) })
    await waitFor(() => expect(frm.doc.duration).toBe(5400))
    expect(w.__petal_duration_seen).toBe(5400)

    // A script setting the value refreshes Desk's control
    const party = frm.fields_dict.party.deskControl
    await act(async () => { await frm.set_value("party", "ACME") })
    await waitFor(() => expect(party.get_input_value?.() ?? party.$input?.val()).toBe("ACME"))
    fireEvent.blur(party.$input[0])
  }, 60_000)
})
