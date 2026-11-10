/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * GenericForm + the Frappe-compatible runtime with ERPNext's real scripts:
 * buttons, intro and indicator added by ERPNext's `refresh` handlers must show
 * up in Petal's header. Needs a local bench (skipped otherwise).
 */
import fs from "fs"
import path from "path"
import { describe, expect, it, vi } from "vitest"
import { render, screen, waitFor, fireEvent } from "@testing-library/react"

const BENCH = process.env.FRAPPE_BENCH ?? path.resolve(__dirname, "../../../../../../../../frappe-bench")
const ASSETS = path.join(BENCH, "sites/assets/assets.json")
const HAS_BENCH = fs.existsSync(ASSETS)

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@/hooks/useRealtime", () => ({ useRealtimeDoc: () => {}, useRealtimeList: () => {}, getRealtimeClient: async () => null }))

function findDoctypeJson(name: string): any | null {
  const scrub = name.toLowerCase().replace(/ /g, "_")
  for (const app of ["erpnext", "hrms"]) {
    const root = path.join(BENCH, "apps", app, app)
    if (!fs.existsSync(root)) continue
    for (const mod of fs.readdirSync(root)) {
      const p = path.join(root, mod, "doctype", scrub, scrub + ".json")
      if (fs.existsSync(p)) {
        const json = JSON.parse(fs.readFileSync(p, "utf8"))
        const js = p.slice(0, -5) + ".js"
        const expand = (code: string): string => code.replace(/\{%\s*include\s+['"]([^'"]+)['"]\s*%\}/g, (_m, rel: string) => {
          const f = path.join(BENCH, "apps", rel.split("/")[0]!, rel)
          return fs.existsSync(f) ? expand(fs.readFileSync(f, "utf8")) : ""
        })
        return {
          ...json, doctype: "DocType",
          fields: json.fields.map((f: any, i: number) => ({ ...f, parent: json.name, idx: i + 1 })),
          __js: fs.existsSync(js) ? expand(fs.readFileSync(js, "utf8")) : "",
        }
      }
    }
  }
  return null
}

function getdoctype(name: string) {
  const parent = findDoctypeJson(name)
  const docs = [parent]
  for (const f of parent.fields) if (f.fieldtype === "Table" && f.options) { const c = findDoctypeJson(f.options); if (c) docs.push(c) }
  return docs
}

vi.mock("@/lib/frappe-compat/browser", async () => {
  const compat = await import("@/lib/frappe-compat")
  return {
    setCompatNavigator: () => {},
    startCompat: () => compat.ensureCompat({
      transport: async (method: string, args: any) => {
        if (method === "frappe.sessions.get") {
          return { status: 200, data: { message: {
            sysdefaults: { currency: "INR", float_precision: "3", currency_precision: "2", number_format: "#,##,###.##", company: "Test Co" },
            user: { name: "Administrator", roles: ["Administrator", "System Manager"], defaults: { company: "Test Co" }, can_create: ["Sales Invoice", "Delivery Note", "Sales Order", "Quotation", "Payment Entry"], can_read: ["Sales Invoice"] },
            docs: [{ doctype: ":Company", name: "Test Co", default_currency: "INR" }],
            versions: { frappe: "15", erpnext: "15" },
          } } }
        }
        if (method === "frappe.desk.form.load.getdoctype") return { status: 200, data: { docs: getdoctype(args.doctype) } }
        return { status: 200, data: { message: undefined } }
      },
      navigate: () => {},
      toast: () => {},
      bundles: [],
      fetchText: async (url: string) => fs.readFileSync(url === "/assets/assets.json" ? ASSETS : path.join(BENCH, "sites", url), "utf8"),
    }),
  }
})

describe.skipIf(!HAS_BENCH)("GenericForm with ERPNext scripts", () => {
  it("renders a new Sales Invoice with ERPNext's own buttons and Desk-style Save", async () => {
    const { usePetalStore } = await import("@/store/petal-store")
    usePetalStore.setState({
      hooks: { frappe_compat: { enabled: true, bundles: [] } } as any,
      hooksReady: true,
      user: { name: "Administrator", email: "admin@example.com", full_name: "Administrator", first_name: "Admin", username: "admin", user_type: "System User", roles: ["Administrator"] },
      authStatus: "authenticated",
      settings: { currency: "INR" },
    })
    const { GenericForm } = await import("./GenericForm")
    render(<GenericForm doctype="Sales Invoice" name="new" />)

    await waitFor(() => expect(screen.getByRole("heading", { name: "New Sales Invoice" })).toBeTruthy(), { timeout: 15000 })
    // Added by ERPNext's sales_invoice.js refresh handler via frm.add_custom_button(..., "Get Items From")
    await waitFor(() => expect(screen.getByRole("button", { name: "Get Items From" })).toBeTruthy(), { timeout: 15000 })
    fireEvent.click(screen.getByRole("button", { name: "Get Items From" }))
    expect(screen.getByRole("menuitem", { name: "Sales Order" })).toBeTruthy()
    expect(screen.getByRole("menuitem", { name: "Delivery Note" })).toBeTruthy()
    // New drafts are editable straight away with Save as the primary action (Desk behaviour)
    expect(screen.getByRole("button", { name: /Save/ })).toBeTruthy()
    // ERPNext's indicator for a new unsaved doc
    expect(screen.getByText("Not Saved")).toBeTruthy()
    // Fields come from the runtime's docfield copies
    expect(screen.getAllByText("Customer").length).toBeGreaterThan(0)
  }, 60_000)
})
