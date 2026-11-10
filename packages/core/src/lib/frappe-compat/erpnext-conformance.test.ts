// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Conformance harness: runs the REAL erpnext.bundle.js and every ERPNext/HRMS
 * doctype form script on Petal's Frappe runtime, then opens each doctype
 * (new draft and submitted) through Desk's full load sequence.
 *
 * Needs a local bench (FRAPPE_BENCH, default ../frappe-bench next to petal);
 * skipped when none is present (e.g. CI).
 */
import fs from "fs"
import path from "path"
import { describe, expect, it, beforeAll } from "vitest"

const BENCH = process.env.FRAPPE_BENCH ?? path.resolve(__dirname, "../../../../../../frappe-bench")
const ASSETS = path.join(BENCH, "sites/assets/assets.json")
const HAS_BENCH = fs.existsSync(ASSETS)
const APPS = (process.env.FRAPPE_APPS ?? "erpnext,hrms").split(",")
const REPORT = process.env.PETAL_COMPAT_REPORT

// Browser APIs jsdom lacks that frappe-charts / frappe-datatable use.
;(globalThis as any).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
;(globalThis as any).DOMMatrixReadOnly ??= class { m41 = 0; m42 = 0; constructor(_t?: string) {} }

type Meta = Record<string, any>

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "public") walk(p, out) }
    else if (e.name.endsWith(".json") && path.basename(path.dirname(p)) === e.name.slice(0, -5) && p.includes(`${path.sep}doctype${path.sep}`)) out.push(p)
  }
  return out
}

/** Frappe expands `{% include "app/path.js" %}` in doctype JS server-side. */
function expandIncludes(code: string): string {
  return code.replace(/\{%\s*include\s+['"]([^'"]+)['"]\s*%\}/g, (_m, rel: string) => {
    const app = rel.split("/")[0]!
    const p = path.join(BENCH, "apps", app, rel)
    return fs.existsSync(p) ? expandIncludes(fs.readFileSync(p, "utf8")) : ""
  })
}

function loadMetas(): Meta[] {
  const metas: Meta[] = []
  for (const app of APPS) {
    const root = path.join(BENCH, "apps", app, app)
    if (!fs.existsSync(root)) continue
    for (const file of walk(root)) {
      let json: Meta
      try { json = JSON.parse(fs.readFileSync(file, "utf8")) } catch { continue }
      if (json.doctype !== "DocType" || !json.name) continue
      const jsFile = file.slice(0, -5) + ".js"
      const meta: Meta = {
        ...json,
        doctype: "DocType",
        fields: (json.fields ?? []).map((f: any, i: number) => ({ ...f, parent: json.name, idx: i + 1 })),
        __js: fs.existsSync(jsFile) ? expandIncludes(fs.readFileSync(jsFile, "utf8")) : "",
        __petal_full: true,
        __app: app,
      }
      metas.push(meta)
    }
  }
  return metas
}

const BOOT = (doctypes: string[]) => ({
  sysdefaults: {
    currency: "INR", float_precision: "3", currency_precision: "2", number_format: "#,##,###.##",
    date_format: "dd-mm-yyyy", time_format: "HH:mm:ss", company: "Test Co", country: "India",
    rounding_method: "Banker's Rounding", time_zone: "Asia/Kolkata",
  },
  user: {
    name: "Administrator", roles: ["Administrator", "System Manager"], defaults: { company: "Test Co", currency: "INR", fiscal_year: "2026-2027" },
    can_read: doctypes, can_create: doctypes, can_write: doctypes, can_delete: doctypes, can_submit: doctypes, can_cancel: doctypes,
    can_select: doctypes, can_get_report: doctypes, can_import: doctypes, can_export: doctypes, can_print: doctypes, can_email: doctypes, can_share: doctypes,
    user_permissions: {},
  },
  user_info: { Administrator: { fullname: "Administrator" } },
  docs: [
    { doctype: ":Currency", name: "INR", symbol: "₹", number_format: "#,##,###.##", smallest_currency_fraction_value: 0.01 },
    { doctype: ":Company", name: "Test Co", default_currency: "INR", cost_center: "Main - TC", default_letter_head: null, country: "India", enable_perpetual_inventory: 1 },
  ],
  time_zone: { system: "Asia/Kolkata", user: "Asia/Kolkata" },
  versions: Object.fromEntries(["frappe", ...APPS].map((a) => [a, "15"])),
  current_fiscal_year: ["2026-2027", "2026-04-01", "2027-03-31"],
  party_account_types: { Customer: "Receivable", Supplier: "Payable" },
  module_app: {},
})

describe.skipIf(!HAS_BENCH)("ERPNext scripts on Petal's Frappe runtime", () => {
  const metas = HAS_BENCH ? loadMetas() : []
  const errors: Array<{ phase: string; doctype: string; message: string }> = []
  let phase = "boot"
  let current = ""
  let compat: typeof import("./index")
  const calls: Array<{ method: string; args: any }> = []
  const responders: Record<string, (args: any) => any> = {}

  beforeAll(async () => {
    const origError = console.error
    console.error = (...args: any[]) => {
      const msg = args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === "string" ? a : (() => { try { return JSON.stringify(a)?.slice(0, 200) } catch { return String(a) } })())).join(" ")
      errors.push({ phase, doctype: current, message: msg })
    }
    console.warn = () => {}
    process.on("unhandledRejection", (r: any) => errors.push({ phase, doctype: current, message: "unhandled: " + (r?.message ?? String(r)) + (process.env.PETAL_COMPAT_STACKS ? "\n" + (r?.stack ?? "") : "") }))
    void origError

    compat = await import("./index")
    const names = metas.map((m) => m.name)
    await compat.ensureCompat({
      transport: async (method, args) => {
        calls.push({ method, args })
        if (calls.length > 4000) {
          const counts: Record<string, number> = {}
          for (const c of calls.slice(-500)) counts[c.method] = (counts[c.method] ?? 0) + 1
          throw new Error("runaway requests: " + JSON.stringify(counts))
        }
        if (method === "frappe.sessions.get") return { status: 200, data: { message: BOOT(names) } }
        const r = responders[method]
        if (r) return { status: 200, data: { message: r(args) } }
        return { status: 200, data: { message: undefined } }
      },
      navigate: () => {},
      toast: () => {},
      bundles: [],
      fetchText: async (url) => {
        const p = url === "/assets/assets.json" ? ASSETS : path.join(BENCH, "sites", url)
        return fs.readFileSync(p, "utf8")
      },
    })
    const w: any = window
    w.frappe.model.sync(metas)
    for (const m of metas) w.locals.DocType[m.name].__petal_full = true
  }, 60_000)

  it("loads erpnext.bundle.js without errors", () => {
    const bootErrors = errors.filter((e) => e.phase === "boot")
    expect(bootErrors.map((e) => e.message)).toEqual([])
    const w: any = window
    expect(typeof w.erpnext?.TransactionController).toBe("function")
    expect(typeof w.erpnext?.taxes_and_totals).toBe("function")
  })

  it("opens every doctype (new and submitted) through setup → onload → refresh", async () => {
    const w: any = window
    const parents = metas.filter((m) => !m.istable)
    for (const meta of parents) {
      current = meta.name
      phase = "new"
      try {
        await withTimeout(compat.openDoc(meta.name, "new"), 3000)
      } catch (e: any) {
        errors.push({ phase, doctype: meta.name, message: "open: " + (e?.message ?? String(e)) })
      }
      if (meta.is_submittable) {
        phase = "submitted"
        try {
          const doc = w.frappe.model.get_new_doc(meta.name, null, null, true)
          const name = "TEST-" + meta.name.replace(/\W/g, "").slice(0, 8) + "-0001"
          delete w.locals[meta.name][doc.name]
          Object.assign(doc, { name, docstatus: 1, __islocal: 0, __unsaved: 0, status: "Submitted", __onload: {} })
          w.locals[meta.name][name] = doc
          for (const t of Object.values(doc)) if (Array.isArray(t)) for (const r of t as any[]) if (r && typeof r === "object") r.parent = name
          w.frappe.model.docinfo[meta.name] = w.frappe.model.docinfo[meta.name] ?? {}
          w.frappe.model.docinfo[meta.name][name] = { permissions: { read: 1, write: 1, submit: 1, cancel: 1, amend: 1 } }
          await withTimeout(compat.openDoc(meta.name, name), 3000)
        } catch (e: any) {
          errors.push({ phase, doctype: meta.name, message: "open: " + (e?.message ?? String(e)) })
        }
      }
    }
    phase = "done"

    // Errors inside request callbacks depend on real server data (the mock
    // returns empty messages); everything else is a gap in the runtime.
    const runtime = errors.filter((e) => e.phase !== "boot" && !e.message.includes("callback error"))
    const byMessage = new Map<string, string[]>()
    for (const e of runtime) {
      const key = e.message.replace(/\s+/g, " ").slice(0, 160)
      byMessage.set(key, [...(byMessage.get(key) ?? []), `${e.doctype} (${e.phase})`])
    }
    const summary = [...byMessage.entries()].sort((a, b) => b[1].length - a[1].length).map(([m, where]) => ({ count: where.length, message: m, where: [...new Set(where)].slice(0, 6) }))
    if (REPORT) fs.writeFileSync(REPORT, JSON.stringify({ doctypes: parents.length, submittable: parents.filter((m) => m.is_submittable).length, distinct: summary.length, total: runtime.length, summary }, null, 2))
    const failingDoctypes = new Set(runtime.map((e) => e.doctype))
    console.info(`[conformance] ${parents.length} doctypes, ${failingDoctypes.size} with runtime errors`)
    // Known: these read server data the mock doesn't return (__onload values,
    // get_value results, synced docs) or drive Desk-only widgets (Leaflet map,
    // raw Desk page markup). Anything else failing is a runtime regression.
    const KNOWN = new Set([
      "Monthly Distribution", "Opening Invoice Creation Tool", "Share Transfer", "Expense Claim", // mock data
      "Location", "Shift Assignment Tool", "Employee Checkin", // Desk-only widgets / markup
    ])
    const unexpected = [...failingDoctypes].filter((d) => !KNOWN.has(d))
    expect(unexpected).toEqual([])
  }, 600_000)

  it("Sales Invoice: ERPNext's own controllers compute rates, amounts, taxes and totals", async () => {
    await settle()
    await new Promise((r) => setTimeout(r, 50))
    phase = "behaviour"
    current = "Sales Invoice"
    const before = errors.length
    responders["erpnext.stock.get_item_details.get_item_details"] = (args) => {
      const a = JSON.parse(args.args)
      return {
        item_code: a.item_code, item_name: "Widget", description: "Widget", uom: "Nos", stock_uom: "Nos",
        conversion_factor: 1, qty: a.qty, price_list_rate: 100, base_price_list_rate: 100, rate: 100,
        discount_percentage: 0, income_account: "Sales - TC", cost_center: "Main - TC", warehouse: "Stores - TC",
        item_tax_rate: "{}", margin_type: "", margin_rate_or_amount: 0,
      }
    }
    // No pricing rule matches: get_pricing_rule_for_item returns just the row identity.
    responders["erpnext.accounts.doctype.pricing_rule.pricing_rule.apply_pricing_rule"] = (args) => {
      const a = JSON.parse(args.args)
      return (a.items ?? []).map((i: any) => ({
        doctype: i.doctype, has_margin: false, name: i.name, free_item_data: [], parent: i.parent, parenttype: i.parenttype, child_docname: i.child_docname,
      }))
    }
    responders["erpnext.stock.get_item_details.apply_price_list"] = () => ({ parent: { price_list_currency: "INR", plc_conversion_rate: 1 }, children: [] })
    responders["erpnext.stock.get_item_details.get_item_tax_template"] = () => null
    if (process.env.PETAL_COMPAT_TRACE) {
      const w: any = window
      const orig = w.frappe.model.trigger
      const counts: Record<string, number> = {}
      let n = 0
      w.frappe.model.trigger = (f: string, v: any, d: any, s: any) => {
        const k = d.doctype + "." + f + "=" + JSON.stringify(v)
        counts[k] = (counts[k] ?? 0) + 1
        if (++n === 3000) { process.stdout.write("TRACE " + JSON.stringify(Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 12)) + "\n"); process.exit(1) }
        return orig(f, v, d, s)
      }
    }
    const { frm } = await compat.openDoc("Sales Invoice", "new")
    Object.assign(frm.doc, { company: "Test Co", currency: "INR", conversion_rate: 1, price_list_currency: "INR", plc_conversion_rate: 1, customer: "ACME", selling_price_list: "Standard Selling" })

    // As Petal's ChildTable reports it: a new row with item_code and qty typed in.
    await compat.setFieldFromUI(frm, "items", [{ item_code: "WIDGET", qty: 3 }])
    await settle()
    const row = frm.doc.items[0]
    expect(calls.some((c) => c.method === "erpnext.stock.get_item_details.get_item_details")).toBe(true)
    expect(row.item_name).toBe("Widget")
    expect(row.rate).toBe(100)
    expect(row.amount).toBe(300)
    expect(frm.doc.total_qty).toBe(3)
    expect(frm.doc.net_total).toBe(300)
    expect(frm.doc.grand_total).toBe(300)

    // 18% tax on net total, added as a taxes row.
    await compat.setFieldFromUI(frm, "taxes", [{ charge_type: "On Net Total", account_head: "GST - TC", description: "GST", rate: 18 }])
    await settle()
    expect(frm.doc.taxes[0].tax_amount).toBe(54)
    expect(frm.doc.total_taxes_and_charges).toBe(54)
    expect(frm.doc.grand_total).toBe(354)

    // Edit qty in the grid: line amount, tax and totals all follow.
    await compat.setFieldFromUI(frm, "items", [{ ...(compat.snapshotDoc(frm.doc).items as any[])[0], qty: 5 }])
    await settle()
    expect(frm.doc.items[0].amount).toBe(500)
    expect(frm.doc.total_taxes_and_charges).toBe(90)
    expect(frm.doc.grand_total).toBe(590)

    // A 10% discount on the line.
    await compat.setFieldFromUI(frm, "items", [{ ...(compat.snapshotDoc(frm.doc).items as any[])[0], discount_percentage: 10 }])
    await settle()
    expect(frm.doc.items[0].rate).toBe(90)
    expect(frm.doc.net_total).toBe(450)
    expect(frm.doc.grand_total).toBe(531)

    // Removing the row zeroes the document.
    await compat.setFieldFromUI(frm, "items", [])
    await settle()
    expect(frm.doc.items.length).toBe(0)
    expect(frm.doc.net_total).toBe(0)

    const scriptErrors = errors.slice(before).filter((e) => !e.message.includes("callback error"))
    if (process.env.PETAL_COMPAT_STACKS) fs.writeFileSync(process.env.PETAL_COMPAT_STACKS, scriptErrors.map((e) => e.message).join("\n\n"))
    expect(scriptErrors.map((e) => e.message)).toEqual([])
  }, 60_000)
})

async function settle() {
  const { waitForPending } = await import("./request")
  for (let i = 0; i < 5; i++) {
    await waitForPending()
    await new Promise((r) => setTimeout(r, 0))
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))])
}
