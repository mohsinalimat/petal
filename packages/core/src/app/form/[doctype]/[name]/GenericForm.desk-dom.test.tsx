/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Scripts written for Desk reach into the form's DOM from `refresh`
 * (document.querySelector('[data-fieldname=x] .section-head'),
 * frm.fields_dict.x.$wrapper / $input, $(frm.wrapper).find(...)). Petal draws
 * the form before refresh runs and uses Desk's class names, so they work.
 */
import { describe, expect, it, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@/hooks/useRealtime", () => ({ useRealtimeDoc: () => {}, useRealtimeList: () => {}, getRealtimeClient: async () => null }))

const SCRIPT = `
frappe.ui.form.on("Desk Dom Test", {
  refresh(frm) {
    // hrms shift_assignment_tool.js does exactly this
    document.querySelector('[data-fieldname="details_section"]').querySelector(".section-head").textContent = __("Select Employees");
    frm.fields_dict.title.$wrapper.addClass("from-script");
    frm.fields_dict.title.$input.attr("placeholder", "Set by script");
    window.__petal_found = $(frm.wrapper).find('.frappe-control[data-fieldname="qty"]').length;
    window.__petal_columns = $(frm.wrapper).find('.form-column[data-fieldname="col_2"]').length;
    window.__petal_section = frm.fields_dict.details_section.wrapper.find(".section-head").length;
  }
});`

const META = {
  doctype: "DocType", name: "Desk Dom Test", module: "Core", __js: SCRIPT,
  fields: [
    { fieldname: "details_section", fieldtype: "Section Break", label: "Details" },
    { fieldname: "title", fieldtype: "Data", label: "Title" },
    { fieldname: "col_2", fieldtype: "Column Break" },
    { fieldname: "qty", fieldtype: "Int", label: "Qty" },
  ].map((f, i) => ({ ...f, parent: "Desk Dom Test", idx: i + 1 })),
}

vi.mock("@/lib/frappe-compat/browser", async () => {
  const compat = await import("@/lib/frappe-compat")
  return {
    setCompatNavigator: () => {},
    startCompat: () => compat.ensureCompat({
      transport: async (method: string) => {
        if (method === "frappe.sessions.get") return { status: 200, data: { message: { sysdefaults: {}, user: { name: "Administrator", roles: ["Administrator"], defaults: {}, can_create: ["Desk Dom Test"] } } } }
        if (method === "frappe.desk.form.load.getdoctype") return { status: 200, data: { docs: [META] } }
        return { status: 200, data: { message: null } }
      },
      navigate: () => {},
      toast: () => {},
      autoBundles: false,
      fetchText: async () => "{}",
    }),
  }
})

describe("Desk DOM access from form scripts", () => {
  it("finds Petal's rendered fields, sections and columns from refresh", async () => {
    const { usePetalStore } = await import("@/store/petal-store")
    usePetalStore.setState({
      hooks: { frappe_compat: { enabled: true } } as any,
      hooksReady: true,
      user: { name: "Administrator", email: "admin@example.com", full_name: "Administrator", first_name: "Admin", username: "admin", user_type: "System User", roles: ["Administrator"] },
      authStatus: "authenticated",
      settings: {},
    })
    const { GenericForm } = await import("./GenericForm")
    const { container } = render(<GenericForm doctype="Desk Dom Test" name="new" />)

    await waitFor(() => expect(screen.getByText("Select Employees")).toBeTruthy(), { timeout: 10_000 })
    const w = window as any
    expect(w.__petal_found).toBe(1)
    expect(w.__petal_columns).toBe(1)
    expect(w.__petal_section).toBe(1)
    const control = container.querySelector('.frappe-control[data-fieldname="title"]')!
    expect(control.classList.contains("from-script")).toBe(true)
    expect(control.querySelector("input")?.getAttribute("placeholder")).toBe("Set by script")
  }, 30_000)
})
