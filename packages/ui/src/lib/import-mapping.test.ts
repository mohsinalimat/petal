import { describe, it, expect } from "vitest"
import {
  autoMapColumns, chunk, coerceValue, importableFields, normalizeDate, prepareImport, templateHeaders,
} from "./import-mapping"
import type { ImportField } from "./import-mapping"

const fields: ImportField[] = [
  { fieldname: "customer_name", fieldtype: "Data", label: "Customer Name", reqd: 1 },
  { fieldname: "qty", fieldtype: "Int", label: "Quantity" },
  { fieldname: "rate", fieldtype: "Currency", label: "Rate" },
  { fieldname: "active", fieldtype: "Check", label: "Active" },
  { fieldname: "status", fieldtype: "Select", label: "Status", options: "Open\nClosed" },
  { fieldname: "due", fieldtype: "Date", label: "Due Date" },
  { fieldname: "at", fieldtype: "Datetime", label: "At" },
  { fieldname: "sb", fieldtype: "Section Break", label: "" },
  { fieldname: "items", fieldtype: "Table", label: "Items" },
  { fieldname: "total", fieldtype: "Currency", label: "Total", read_only: 1 },
]

describe("importableFields", () => {
  it("drops layout, table and read-only fields", () => {
    expect(importableFields(fields).map((f) => f.fieldname)).toEqual(["customer_name", "qty", "rate", "active", "status", "due", "at"])
  })
})

describe("autoMapColumns", () => {
  it("matches by label or fieldname ignoring case, punctuation and required markers", () => {
    expect(autoMapColumns(["Customer Name*", "QTY", "due_date", "ID", "unknown"], fields))
      .toEqual(["customer_name", "qty", "due", "name", ""])
  })

  it("never maps two columns to the same field", () => {
    expect(autoMapColumns(["qty", "Quantity"], fields)).toEqual(["qty", ""])
  })
})

describe("normalizeDate", () => {
  it.each([
    ["2026-03-05", "2026-03-05"],
    ["2026-3-5", "2026-03-05"],
    ["05-03-2026", "2026-03-05"],
    ["05/03/2026", "2026-03-05"],
    ["5.3.2026", "2026-03-05"],
  ])("%s → %s", (input, out) => expect(normalizeDate(input)).toBe(out))

  it("rejects impossible dates and garbage", () => {
    expect(normalizeDate("2026-02-30")).toBeNull()
    expect(normalizeDate("31/31/2026")).toBeNull()
    expect(normalizeDate("tomorrow")).toBeNull()
  })
})

describe("coerceValue", () => {
  const f = (name: string) => fields.find((x) => x.fieldname === name)!

  it("parses numbers, stripping thousands separators", () => {
    expect(coerceValue("1,200", f("qty"))).toBe(1200)
    expect(coerceValue("12.5", f("rate"))).toBe(12.5)
    expect(coerceValue("", f("qty"))).toBeNull()
  })

  it("rejects non-integers for Int and non-numbers for Currency", () => {
    expect(() => coerceValue("1.5", f("qty"))).toThrow(/whole number/)
    expect(() => coerceValue("abc", f("rate"))).toThrow(/not a number/)
  })

  it("maps yes/no style values for Check", () => {
    expect(coerceValue("Yes", f("active"))).toBe(1)
    expect(coerceValue("false", f("active"))).toBe(0)
    expect(coerceValue("", f("active"))).toBe(0)
    expect(() => coerceValue("maybe", f("active"))).toThrow()
  })

  it("validates Select options", () => {
    expect(coerceValue("Open", f("status"))).toBe("Open")
    expect(() => coerceValue("Pending", f("status"))).toThrow(/Open, Closed/)
  })

  it("normalises Date and Datetime", () => {
    expect(coerceValue("01/02/2026", f("due"))).toBe("2026-02-01")
    expect(coerceValue("2026-02-01 9:30", f("at"))).toBe("2026-02-01 09:30:00")
    expect(coerceValue("2026-02-01T09:30:15", f("at"))).toBe("2026-02-01 09:30:15")
    expect(() => coerceValue("2026-02-01 late", f("at"))).toThrow()
    expect(() => coerceValue("2026-02-01 25:00", f("at"))).toThrow()
  })

  it("trims text", () => {
    expect(coerceValue("  hi ", f("customer_name"))).toBe("hi")
  })
})

describe("prepareImport", () => {
  it("builds docs and reports cell and required-field issues with 1-based rows", () => {
    const { docs, issues } = prepareImport(
      "Order",
      [["Acme", "2", "Open"], ["", "x", "Open"], ["Beta", "", "Nope"]],
      ["customer_name", "qty", "status"],
      importableFields(fields),
    )
    expect(docs[0]).toEqual({ doctype: "Order", customer_name: "Acme", qty: 2, status: "Open" })
    expect(issues).toEqual([
      { row: 2, fieldname: "qty", message: '"x" is not a whole number' },
      { row: 2, fieldname: "customer_name", message: "Customer Name is required" },
      { row: 3, fieldname: "status", message: '"Nope" is not one of: Open, Closed' },
    ])
  })

  it("ignores unmapped columns and maps an ID column to name", () => {
    const { docs, issues } = prepareImport("Order", [["ORD-1", "Acme", "junk"]], ["name", "customer_name", ""], importableFields(fields))
    expect(docs).toEqual([{ doctype: "Order", name: "ORD-1", customer_name: "Acme" }])
    expect(issues).toEqual([])
  })
})

describe("templateHeaders / chunk", () => {
  it("marks required fields with *", () => {
    expect(templateHeaders(fields)[0]).toBe("Customer Name*")
    expect(templateHeaders(fields)).not.toContain("Items")
  })

  it("chunks arrays", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 3)).toEqual([])
  })
})
