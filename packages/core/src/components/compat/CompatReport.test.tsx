/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ERPNext's real Stock Balance script report on Petal: its filters (Desk
 * controls, defaults, MultiSelectList), onload button, run arguments and
 * formatter. Needs a local bench (skipped otherwise).
 */
import fs from "fs"
import path from "path"
import { describe, expect, it, vi } from "vitest"
import { act, render, screen, waitFor } from "@testing-library/react"

const BENCH = process.env.FRAPPE_BENCH ?? path.resolve(__dirname, "../../../../../../frappe-bench")
const ASSETS = path.join(BENCH, "sites/assets/assets.json")
const REPORT_JS = path.join(BENCH, "apps/erpnext/erpnext/stock/report/stock_balance/stock_balance.js")
const HAS_BENCH = fs.existsSync(ASSETS) && fs.existsSync(REPORT_JS)

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))

const calls: Array<{ method: string; args: any }> = []

vi.mock("@/lib/frappe-compat/browser", async () => {
  const compat = await import("@/lib/frappe-compat")
  return {
    setCompatNavigator: () => {},
    startCompat: () => compat.ensureCompat({
      transport: async (method: string, args: any) => {
        calls.push({ method, args })
        if (method === "frappe.sessions.get") {
          return { status: 200, data: { message: {
            sysdefaults: { date_format: "yyyy-mm-dd", company: "Test Co", float_precision: "3", number_format: "#,###.##" },
            user: { name: "Administrator", roles: ["Administrator"], defaults: { company: "Test Co" } },
            versions: { frappe: "15", erpnext: "15" },
          } } }
        }
        if (method === "frappe.desk.form.load.getdoc") return { status: 200, data: { docs: [{ doctype: "Report", name: "Stock Balance", report_type: "Script Report", ref_doctype: "Stock Ledger Entry" }] } }
        if (method === "frappe.desk.query_report.get_script") return { status: 200, data: { message: { script: fs.readFileSync(REPORT_JS, "utf8") } } }
        if (method === "frappe.desk.query_report.run") {
          return { status: 200, data: { message: {
            columns: [
              { fieldname: "item_code", label: "Item", fieldtype: "Link", options: "Item", width: 100 },
              { fieldname: "in_qty", label: "In Qty", fieldtype: "Float" },
              { fieldname: "out_qty", label: "Out Qty", fieldtype: "Float" },
            ],
            result: [{ item_code: "ITEM-1", in_qty: 5, out_qty: 2 }, { item_code: "ITEM-2", in_qty: 0, out_qty: 0 }],
          } } }
        }
        return { status: 200, data: { message: null } }
      },
      navigate: () => {},
      toast: () => {},
      autoBundles: false,
      bundles: ["erpnext.bundle.js"],
      fetchText: async (url: string) => {
        const p = url === "/assets/assets.json" ? ASSETS : path.join(BENCH, "sites", url)
        return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "{}"
      },
    }),
  }
})

describe.skipIf(!HAS_BENCH)("Script reports on Petal", () => {
  it("runs ERPNext's Stock Balance with its filters, onload button and formatter", async () => {
    const { CompatReport } = await import("./CompatReport")
    const { container } = render(<CompatReport name="Stock Balance" config={{ enabled: true }} />)

    await waitFor(() => expect(screen.getByRole("heading", { name: "Stock Balance" })).toBeTruthy(), { timeout: 30_000 })
    // onload: report.page.add_inner_button(__("View Stock Ledger"), …)
    await waitFor(() => expect(screen.getByRole("button", { name: "View Stock Ledger" })).toBeTruthy())

    // Filters are Desk controls with the script's defaults
    const form = container.querySelector(".page-form")!
    expect(form.querySelector('[data-fieldname="company"] input')).not.toBeNull()
    expect(form.querySelector('[data-fieldtype="MultiSelectList"]')).not.toBeNull()

    // The run used the defaults (company from user defaults, dates from the script)
    const run = await waitFor(() => {
      const c = calls.find((x) => x.method === "frappe.desk.query_report.run")
      expect(c).toBeTruthy()
      return c!
    })
    const filters = JSON.parse(run.args.filters)
    expect(filters.company).toBe("Test Co")
    expect(filters.to_date).toBe((window as any).frappe.datetime.get_today())

    // Rows through ERPNext's formatter: out_qty > 0 in red, in_qty > 0 in green
    await waitFor(() => expect(screen.getByText("ITEM-1")).toBeTruthy())
    const red = container.querySelector('tbody span[style*="red"]')
    const green = container.querySelector('tbody span[style*="green"]')
    expect(red?.textContent).toContain("2")
    expect(green?.textContent).toContain("5")

    // Scripts' frappe.query_report API reads the live filters
    const w = window as any
    expect(w.frappe.query_report.get_filter_value("company")).toBe("Test Co")
    calls.length = 0
    await act(async () => { await w.frappe.query_report.refresh() })
    expect(calls.some((c) => c.method === "frappe.desk.query_report.run")).toBe(true)
  }, 60_000)
})
