import { describe, it, expect } from "vitest"
import { buildAmendment, computeDefaults, missingRequired, prefillKey, stripForCopy } from "./doc-utils"

describe("computeDefaults", () => {
  const now = new Date(2026, 10, 8, 9, 5, 7)

  it("resolves literals, Today/now, the session user and numeric types", () => {
    const defs = computeDefaults([
      { fieldname: "status", fieldtype: "Select", default: "Open" },
      { fieldname: "d", fieldtype: "Date", default: "Today" },
      { fieldname: "dt", fieldtype: "Datetime", default: "now" },
      { fieldname: "who", fieldtype: "Link", default: "__user" },
      { fieldname: "who2", fieldtype: "Link", default: "eval:frappe.session.user" },
      { fieldname: "flag", fieldtype: "Check", default: "1" },
      { fieldname: "rate", fieldtype: "Currency", default: "2.5" },
      { fieldname: "n", fieldtype: "Int", default: 3 },
    ], { user: "me@x.com", now })
    expect(defs).toEqual({
      status: "Open", d: "2026-11-08", dt: "2026-11-08 09:05:07", who: "me@x.com", who2: "me@x.com", flag: 1, rate: 2.5, n: 3,
    })
  })

  it("skips empty defaults, eval expressions, __last and user tokens without a user", () => {
    expect(computeDefaults([
      { fieldname: "a", fieldtype: "Data", default: "" },
      { fieldname: "b", fieldtype: "Data", default: "eval:doc.x" },
      { fieldname: "c", fieldtype: "Data", default: "__last" },
      { fieldname: "d", fieldtype: "Link", default: "__user" },
      { fieldname: "e", fieldtype: "Data" },
    ], { now })).toEqual({})
  })
})

describe("missingRequired", () => {
  const fields = [
    { fieldname: "a", fieldtype: "Data", reqd: 1 as const },
    { fieldname: "b", fieldtype: "Table", reqd: 1 as const },
    { fieldname: "c", fieldtype: "Data", reqd: 1 as const, hidden: 1 as const },
    { fieldname: "d", fieldtype: "Data", reqd: 1 as const },
    { fieldname: "e", fieldtype: "Int", reqd: 1 as const },
    { fieldname: "f", fieldtype: "Data" },
  ]

  it("flags empty strings, null and empty tables; ignores hidden and behaviour-hidden fields; accepts 0", () => {
    expect(missingRequired(fields, { a: "", b: [], d: "x", e: 0 })).toEqual(["a", "b"])
    expect(missingRequired(fields, { b: [{}], e: 0 }, { a: { hidden: true } })).toEqual(["d"])
  })
})

describe("stripForCopy / buildAmendment", () => {
  const values = {
    name: "SINV-1", docstatus: 2, owner: "x", creation: "c", modified: "m", amended_from: "SINV-0", idx: 0,
    customer: "Acme", invoice_number: "INV-77",
    items: [{ name: "row1", parent: "SINV-1", idx: 1, item: "Widget", qty: 2, parentfield: "items" }],
  }
  const fields = [{ fieldname: "invoice_number", fieldtype: "Data", no_copy: 1 as const }]

  it("drops system fields, no_copy fields and child row identity for Duplicate", () => {
    expect(stripForCopy(values, fields)).toEqual({
      customer: "Acme",
      items: [{ item: "Widget", qty: 2, parentfield: "items" }],
    })
  })

  it("keeps no_copy fields and links back for Amend", () => {
    const a = buildAmendment(values, "SINV-1", fields)
    expect(a).toMatchObject({ customer: "Acme", invoice_number: "INV-77", amended_from: "SINV-1", docstatus: 0 })
    expect(a).not.toHaveProperty("name")
    expect((a.items as unknown[])[0]).not.toHaveProperty("name")
  })

  it("does not mutate the source", () => {
    stripForCopy(values, fields)
    expect(values.items[0]!.name).toBe("row1")
  })

  it("uses the same prefill key as Quick Entry", () => {
    expect(prefillKey("Sales Invoice")).toBe("petal_quick_entry_Sales Invoice")
  })
})
