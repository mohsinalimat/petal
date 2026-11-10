/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ERPNext's real Desk page (selling/page/sales_funnel) on Petal's /page
 * route: make_app_page, Desk header fields (page.add_field / add_date /
 * add_select), the primary action, and the script drawing into page.main.
 * Needs a local bench (skipped otherwise).
 */
import fs from "fs"
import path from "path"
import { describe, expect, it, vi } from "vitest"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"

const BENCH = process.env.FRAPPE_BENCH ?? path.resolve(__dirname, "../../../../../../../frappe-bench")
const ASSETS = path.join(BENCH, "sites/assets/assets.json")
const PAGE_JS = path.join(BENCH, "apps/erpnext/erpnext/selling/page/sales_funnel/sales_funnel.js")
const HAS_BENCH = fs.existsSync(ASSETS) && fs.existsSync(PAGE_JS)

vi.mock("next/navigation", () => ({
  useParams: () => ({ route: ["sales-funnel"] }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

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
            sysdefaults: { date_format: "dd-mm-yyyy", company: "Test Co" },
            user: { name: "Administrator", roles: ["Administrator"], defaults: { company: "Test Co" } },
            page_info: { "sales-funnel": { title: "Sales Funnel" } },
            versions: { frappe: "15", erpnext: "15" },
          } } }
        }
        if (method === "frappe.desk.desk_page.getpage") {
          return { status: 200, data: { docs: [{ doctype: "Page", name: "sales-funnel", title: "Sales Funnel", module: "Selling", script: fs.readFileSync(PAGE_JS, "utf8") }] } }
        }
        if (method.endsWith("get_funnel_data")) return { status: 200, data: { message: "empty" } }
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

describe.skipIf(!HAS_BENCH)("Desk pages on Petal", () => {
  it("runs ERPNext's Sales Funnel page: header, Desk fields, primary action, body", async () => {
    const { usePetalStore } = await import("@/store/petal-store")
    usePetalStore.setState({ hooks: { frappe_compat: { enabled: true } } as any, hooksReady: true })
    const { default: DeskPageRoute } = await import("./page")
    const { container } = render(<DeskPageRoute />)

    await waitFor(() => expect(screen.getByRole("heading", { name: "Sales Funnel" })).toBeTruthy(), { timeout: 30_000 })
    // setup() runs in a setTimeout(0) in the page script
    await waitFor(() => expect(screen.getByText("No data for this period")).toBeTruthy(), { timeout: 10_000 })

    // Header fields are Desk's own controls in the page form
    const form = container.querySelector(".page-form")!
    expect(form.classList.contains("hide")).toBe(false)
    expect(form.querySelector('[data-fieldtype="Link"] input')).not.toBeNull()
    expect(form.querySelectorAll('[data-fieldtype="Date"] input').length).toBe(2)
    expect(form.querySelector("select")?.querySelectorAll("option").length).toBe(3)

    // The script called the server with the user's default company
    const call = calls.find((c) => c.method.endsWith("get_funnel_data"))!
    expect(call.args.company).toBe("Test Co")

    // Desk's primary action → Petal's header button
    calls.length = 0
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }))
    await waitFor(() => expect(calls.some((c) => c.method.endsWith("get_funnel_data"))).toBe(true))
  }, 60_000)

  it("Desk page URLs map to /page", async () => {
    const w = window as any
    expect(w.frappe.boot.page_info["sales-funnel"]).toBeTruthy()
    const { routeToPath, deskUrlToPath, pathToRoute } = await import("@/lib/frappe-compat/env")
    expect(routeToPath(["sales-funnel"])).toBe("/page/sales-funnel")
    expect(deskUrlToPath("/app/sales-funnel")).toBe("/page/sales-funnel")
    expect(pathToRoute("/page/sales-funnel")).toEqual(["sales-funnel"])
  })
})
