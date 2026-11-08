import { describe, it, expect } from "vitest"
import { buildColumns, defaultGroupField, groupableFields, moveCard, UNSET_COLUMN } from "./kanban"
import type { KanbanField } from "./kanban"

const status: KanbanField = { fieldname: "status", fieldtype: "Select", label: "Status", options: "Open\nWorking\nClosed" }
const owner: KanbanField = { fieldname: "owner_user", fieldtype: "Link", label: "Owner", options: "User" }

describe("groupableFields / defaultGroupField", () => {
  const fields: KanbanField[] = [
    { fieldname: "title", fieldtype: "Data", label: "Title" },
    { fieldname: "empty_select", fieldtype: "Select", label: "X", options: "  " },
    owner,
    { fieldname: "priority", fieldtype: "Select", label: "Priority", options: "Low\nHigh" },
    status,
  ]

  it("keeps Select fields with options and Link fields", () => {
    expect(groupableFields(fields).map((f) => f.fieldname)).toEqual(["owner_user", "priority", "status"])
  })

  it("prefers status, then any Select, then Link", () => {
    expect(defaultGroupField(fields)).toBe("status")
    expect(defaultGroupField(fields.filter((f) => f !== status))).toBe("priority")
    expect(defaultGroupField([owner])).toBe("owner_user")
    expect(defaultGroupField([])).toBeNull()
  })
})

describe("buildColumns", () => {
  const rows = [
    { name: "A", status: "Open" },
    { name: "B", status: "Closed" },
    { name: "C", status: "" },
    { name: "D", status: "Legacy" },
  ]

  it("creates one column per Select option in order, including empty ones", () => {
    const cols = buildColumns(rows, status)
    expect(cols.map((c) => c.value)).toEqual(["Open", "Working", "Closed", UNSET_COLUMN])
    expect(cols[1]!.rows).toEqual([])
  })

  it("puts empty and unknown values in a trailing Not set column", () => {
    const unset = buildColumns(rows, status).at(-1)!
    expect(unset.label).toBe("Not set")
    expect(unset.rows.map((r) => r.name)).toEqual(["C", "D"])
  })

  it("omits Not set when every row has a known value", () => {
    expect(buildColumns([{ name: "A", status: "Open" }], status).map((c) => c.value)).not.toContain(UNSET_COLUMN)
  })

  it("derives sorted Link columns from the data", () => {
    const cols = buildColumns([{ name: "1", owner_user: "zed" }, { name: "2", owner_user: "amy" }, { name: "3", owner_user: "amy" }], owner)
    expect(cols.map((c) => [c.value, c.rows.length])).toEqual([["amy", 2], ["zed", 1]])
  })
})

describe("moveCard", () => {
  const cols = buildColumns([{ name: "A", status: "Open" }, { name: "B", status: "Open" }], status)

  it("moves a card to the top of the target column and updates its field", () => {
    const next = moveCard(cols, "B", "Closed", "status")
    expect(next[0]!.rows.map((r) => r.name)).toEqual(["A"])
    expect(next[2]!.rows).toEqual([{ name: "B", status: "Closed" }])
  })

  it("does not mutate the input", () => {
    moveCard(cols, "A", "Working", "status")
    expect(cols[0]!.rows.map((r) => r.name)).toEqual(["A", "B"])
  })

  it("clears the value when moved to Not set, and is a no-op for unknown names", () => {
    const withUnset = [...cols, { value: UNSET_COLUMN, label: "Not set", rows: [] }]
    expect(moveCard(withUnset, "A", UNSET_COLUMN, "status").at(-1)!.rows[0]).toEqual({ name: "A", status: "" })
    expect(moveCard(cols, "nope", "Closed", "status")).toBe(cols)
  })
})
