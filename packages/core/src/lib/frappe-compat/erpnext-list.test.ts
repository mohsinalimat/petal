// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * ERPNext's real list settings (sales_invoice_list.js + erpnext.bundle.js)
 * on Petal's runtime: indicators, add_fields, onload action items and the
 * bulk action they trigger. Needs a local bench (skipped otherwise).
 */
import fs from "fs"
import path from "path"
import { beforeAll, describe, expect, it } from "vitest"

const BENCH = process.env.FRAPPE_BENCH ?? path.resolve(__dirname, "../../../../../../frappe-bench")
const ASSETS = path.join(BENCH, "sites/assets/assets.json")
const HAS_BENCH = fs.existsSync(ASSETS)

function doctypeJson(name: string): any | null {
  const scrub = name.toLowerCase().replace(/ /g, "_")
  const root = path.join(BENCH, "apps/erpnext/erpnext")
  for (const mod of fs.readdirSync(root)) {
    const p = path.join(root, mod, "doctype", scrub, scrub + ".json")
    if (!fs.existsSync(p)) continue
    const json = JSON.parse(fs.readFileSync(p, "utf8"))
    const list = p.slice(0, -5) + "_list.js"
    return {
      ...json, doctype: "DocType",
      fields: json.fields.map((f: any, i: number) => ({ ...f, parent: json.name, idx: i + 1 })),
      __list_js: fs.existsSync(list) ? fs.readFileSync(list, "utf8") : "",
    }
  }
  return null
}

const calls: Array<{ method: string; args: any }> = []
let compat: typeof import(".")

beforeAll(async () => {
  if (!HAS_BENCH) return
  compat = await import(".")
  await compat.ensureCompat({
    transport: async (method, args) => {
      calls.push({ method, args })
      if (method === "frappe.sessions.get") {
        return { status: 200, data: { message: {
          sysdefaults: { currency: "INR" },
          user: { name: "Administrator", roles: ["Administrator"], defaults: {}, can_create: ["Delivery Note", "Payment Entry"] },
          versions: { frappe: "15", erpnext: "15" },
        } } }
      }
      if (method === "frappe.desk.form.load.getdoctype") return { status: 200, data: { docs: [doctypeJson(String(args.doctype))] } }
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
  })
  await compat.loadDoctype("Sales Invoice")
}, 60_000)

describe.skipIf(!HAS_BENCH)("ERPNext list settings on Petal's runtime", () => {
  it("fetches add_fields and status, and colours rows with ERPNext's get_indicator", () => {
    const s = compat.listSettingsFor("Sales Invoice")
    expect(s.extraFields).toEqual(expect.arrayContaining(["customer", "outstanding_amount", "due_date", "is_return", "status"]))
    expect(s.indicator({ name: "SINV-1", docstatus: 1, status: "Overdue" })).toEqual({ label: "Overdue", color: "red" })
    expect(s.indicator({ name: "SINV-2", docstatus: 1, status: "Partly Paid" })).toEqual({ label: "Partly Paid", color: "yellow" })
    // Frappe's own rule for unsubmitted docs comes before the doctype's indicator
    expect(s.indicator({ name: "SINV-3", docstatus: 0, status: "Draft" })).toEqual({ label: "Draft", color: "red" })
  })

  it("runs onload: ERPNext's bulk actions show up and act on the checked rows", async () => {
    const lv = new compat.CompatListView("Sales Invoice")
    compat.runListOnload(lv)
    expect(lv.actionItems.map((a) => a.label)).toEqual(["Delivery Note", "Payment"])

    const rows = [{ name: "SINV-1", docstatus: 1 }, { name: "SINV-2", docstatus: 1 }]
    compat.runListRefresh(lv, rows)
    lv.checked = ["SINV-1", "SINV-2"]
    calls.length = 0
    lv.actionItems.find((a) => a.label === "Payment")!.fn()
    // ERPNext asks to confirm first; accept it.
    const w = window as any
    expect(w.cur_dialog?.message ?? w.cur_dialog?.title).toBeTruthy()
    await w.cur_dialog.run_primary()
    await new Promise((r) => setTimeout(r, 0))
    const call = calls.find((c) => c.method === "erpnext.utilities.bulk_transaction.transaction_processing")
    expect(call).toBeTruthy()
    expect(JSON.parse(call!.args.data).map((d: any) => d.name)).toEqual(["SINV-1", "SINV-2"])
    expect(call!.args.to_doctype).toBe("Payment Entry")
  })

  it("call_for_selected_items sends the checked names and refreshes", async () => {
    const lv = new compat.CompatListView("Sales Invoice")
    let refreshed = 0
    lv.onRefresh = () => refreshed++
    lv.checked = ["SINV-9"]
    calls.length = 0
    await lv.call_for_selected_items("x.close", { status: "Closed" })
    expect(calls[0]).toMatchObject({ method: "x.close", args: { names: '["SINV-9"]', status: "Closed" } })
    expect(refreshed).toBe(1)
  })
})
