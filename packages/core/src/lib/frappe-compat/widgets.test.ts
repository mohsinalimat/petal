// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from "fs"
import path from "path"
import { beforeAll, describe, expect, it } from "vitest"
import { ensureCompat, openDoc } from "."

// jsdom has no layout: give frappe-charts the ResizeObserver it expects.
;(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }

const GRAPH_JS = `frappe.ui.form.on("Widget Test", { refresh(frm) {
  frm.dashboard.render_graph({ data: { labels: ["Q1", "Q2"], datasets: [{ name: "Sales", values: [5, 9] }] }, type: "bar" })
} })`

const BENCH = process.env.FRAPPE_BENCH ?? path.resolve(__dirname, "../../../../../../frappe-bench")
const TREE = path.join(BENCH, "apps/frappe/frappe/public/js/frappe/ui/tree.js")

let frappe: any
const calls: Array<{ method: string; args: any }> = []

beforeAll(async () => {
  frappe = await ensureCompat({
    transport: async (method, args) => {
      calls.push({ method, args })
      if (method === "frappe.sessions.get") return { status: 200, data: { message: { sysdefaults: { country: "India" }, user: { name: "Administrator", roles: [], defaults: {} } } } }
      if (method === "frappe.desk.form.load.getdoctype") return { status: 200, data: { docs: [{ doctype: "DocType", name: "Widget Test", module: "Core", fields: [{ fieldname: "title", fieldtype: "Data", label: "Title", parent: "Widget Test", idx: 1 }], __js: GRAPH_JS }] } }
      if (method === "x.get_children") return { status: 200, data: { message: args.is_root ? [{ value: "Assets", expandable: 1 }, { value: "Liabilities", expandable: 0 }] : [] } }
      return { status: 200, data: { message: null } }
    },
    navigate: () => {},
    toast: () => {},
    autoBundles: false,
    fetchText: async (url: string) => (url.endsWith("/ui/tree.js") && fs.existsSync(TREE) ? fs.readFileSync(TREE, "utf8") : "{}"),
  })
})

const tick = () => new Promise((r) => setTimeout(r, 0))

describe("Desk widgets", () => {
  it("frappe.Chart draws with frappe-charts once its element is on screen", async () => {
    const el = document.createElement("div")
    const chart = new frappe.Chart(el, { type: "bar", data: { labels: ["Jan", "Feb"], datasets: [{ values: [10, 20] }] } })
    chart.update({ labels: ["Jan", "Feb", "Mar"], datasets: [{ values: [10, 20, 30] }] }) // queued until drawn
    expect(el.querySelector("svg")).toBeNull()
    document.body.appendChild(el)
    await tick(); await tick()
    expect(el.querySelector("svg")).not.toBeNull()
    expect(el.textContent).toContain("Mar")
    el.remove()
  })

  it("frm.dashboard.render_graph adds a chart section that draws when shown", async () => {
    const { frm } = await openDoc("Widget Test", "new")
    const section = frm.dashboardSections.find((el: HTMLElement) => el.classList.contains("form-graph")) as HTMLElement
    expect(section).toBeTruthy()
    document.body.appendChild(section) // GenericForm adopts dashboard sections like this
    await tick(); await tick()
    expect(section.querySelector("svg")).not.toBeNull()
    // A second refresh redraws into the same section instead of adding another.
    await frm.refresh()
    expect(frm.dashboardSections.filter((el: HTMLElement) => el.classList.contains("form-graph")).length).toBe(1)
    section.remove()
  })

  it("frappe.DataTable is the real frappe-datatable", () => {
    const el = document.createElement("div")
    document.body.appendChild(el)
    const dt = new frappe.DataTable(el, { columns: ["Item", "Qty"], data: [["A", 1], ["B", 2]], checkboxColumn: true })
    expect(dt.getRows().length).toBe(2)
    expect(el.querySelector(".dt-header")?.textContent).toContain("Qty") // body rows need real layout (virtual scroll)
    expect(dt.rowmanager.getCheckedRows()).toEqual([])
    el.remove()
  })

  it("DataTable can be built into an element that isn't on screen yet (dialog/HTML field)", async () => {
    const field = document.createElement("div")
    const dt = new frappe.DataTable(field, { columns: ["Employee"], data: [["EMP-1"]] })
    expect(field.isConnected).toBe(false) // put back where it was
    expect(dt.getRows().length).toBe(1)
    const style = field.querySelector("style")!
    document.body.appendChild(field)
    await tick()
    expect(style.sheet?.cssRules.length ?? 0).toBeGreaterThan(0) // column styles re-applied once shown
    field.remove()
  })

  it("shortens chart axis numbers the Desk way", () => {
    expect(frappe.utils.format_chart_axis_number(2500000, "India")).toBe("25 L")
    expect(frappe.utils.format_chart_axis_number(2500000, "United States")).toBe("2.5 M")
  })

  it.skipIf(!fs.existsSync(TREE))("frappe.ui.Tree is Frappe's own tree.js", async () => {
    const parent = document.createElement("div")
    document.body.appendChild(parent)
    const tree = new frappe.ui.Tree({ parent: frappe.utils ? (window as any).$(parent) : parent, label: "All Accounts", method: "x.get_children", args: {} })
    await tick(); await tick(); await tick()
    expect(tree.wrapper[0].classList.contains("tree")).toBe(true)
    expect(parent.textContent).toContain("All Accounts")
    expect(calls.some((c) => c.method === "x.get_children")).toBe(true)
    parent.remove()
  })

  it("dialogs fire on_page_show once on screen, and on_hide", async () => {
    let shown = 0
    let hidden = 0
    const d = new frappe.ui.Dialog({ title: "T", fields: [{ fieldtype: "HTML", fieldname: "x" }], on_page_show: () => shown++, on_hide: () => hidden++ })
    d.show()
    await tick()
    expect(shown).toBe(0) // not rendered (no CompatHost in this test)
    document.body.appendChild(d.$body[0])
    await tick()
    expect(shown).toBe(1)
    d.hide()
    expect(hidden).toBe(1)
  })
})
