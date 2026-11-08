import { describe, it, expect } from "vitest"
import { availableViews, defaultDateFields, defaultKanbanField, defaultProgressField, viewPath } from "./available-views"

const f = (fieldname: string, fieldtype: string, extra: Record<string, unknown> = {}) => ({ fieldname, fieldtype, label: fieldname, ...extra })

describe("availableViews", () => {
  it("offers views based on the fields present", () => {
    expect(availableViews({ fields: [f("title", "Data")] })).toEqual(["list"])
    expect(availableViews({ fields: [f("status", "Select", { options: "A\nB" }), f("d", "Date")] })).toEqual(["list", "kanban", "calendar"])
    expect(availableViews({ fields: [f("a", "Date"), f("b", "Datetime")], is_tree: 1 })).toEqual(["list", "calendar", "gantt", "tree"])
  })

  it("ignores hidden fields and single doctypes", () => {
    expect(availableViews({ fields: [f("d", "Date", { hidden: 1 })] })).toEqual(["list"])
    expect(availableViews({ fields: [f("d", "Date")], issingle: 1 })).toEqual([])
  })
})

describe("default field choices", () => {
  it("picks conventional start/end names, falling back to field order", () => {
    expect(defaultDateFields({ fields: [f("posting_date", "Date"), f("end_date", "Date"), f("start_date", "Date")] }))
      .toEqual({ start: "start_date", end: "end_date" })
    expect(defaultDateFields({ fields: [f("a", "Date"), f("b", "Date")] })).toEqual({ start: "a", end: "b" })
    expect(defaultDateFields({ fields: [f("a", "Date")] })).toEqual({ start: "a", end: null })
    expect(defaultDateFields({ fields: [] })).toEqual({ start: null, end: null })
  })

  it("never uses the same field for start and end", () => {
    const r = defaultDateFields({ fields: [f("date", "Date"), f("due_date", "Date")] })
    expect(r.start).toBe("date")
    expect(r.end).toBe("due_date")
  })

  it("finds kanban and progress fields", () => {
    expect(defaultKanbanField({ fields: [f("status", "Select", { options: "A" })] })).toBe("status")
    expect(defaultProgressField({ fields: [f("qty", "Float"), f("percent_complete", "Float")] })).toBe("percent_complete")
    expect(defaultProgressField({ fields: [f("p", "Percent")] })).toBe("p")
    expect(defaultProgressField({ fields: [f("qty", "Int")] })).toBeNull()
  })
})

describe("viewPath", () => {
  it("encodes doctypes into view URLs", () => {
    expect(viewPath("kanban", "Sales Order")).toBe("/kanban/Sales%20Order")
    expect(viewPath("list", "ToDo")).toBe("/list/ToDo")
    expect(viewPath("tree", "Account")).toBe("/tree/Account")
  })
})
