import { describe, it, expect } from "vitest"
import { parseLayout } from "./parseLayout"
import type { MetaField } from "./types"

const f = (fieldname: string, fieldtype: string, extra: Partial<MetaField> = {}): MetaField => ({ fieldname, fieldtype, label: fieldname, ...extra })

describe("parseLayout", () => {
  it("returns a single empty Details tab for no fields", () => {
    expect(parseLayout([])).toEqual([{ label: "Details", fieldname: "__default__", sections: [] }])
  })

  it("groups fields into tabs, sections and columns", () => {
    const tabs = parseLayout([
      f("title", "Data"),
      f("col", "Column Break", { label: "Right" }),
      f("status", "Select"),
      f("sec", "Section Break", { label: "Money", collapsible: 1 }),
      f("amount", "Currency"),
      f("tab2", "Tab Break", { label: "More" }),
      f("notes", "Text"),
    ])
    expect(tabs.map((t) => t.label)).toEqual(["Details", "More"])
    const [first, money] = tabs[0]!.sections
    expect(first!.columns.map((c) => [c.label, c.fields.map((x) => x.fieldname)])).toEqual([["", ["title"]], ["Right", ["status"]]])
    expect(money).toMatchObject({ label: "Money", collapsible: true })
    expect(tabs[1]!.sections[0]!.columns[0]!.fields[0]!.fieldname).toBe("notes")
  })

  it("skips hidden and non-rendering fields and drops empty columns and tabs", () => {
    const tabs = parseLayout([
      f("a", "Data"),
      f("h", "Data", { hidden: 1 }),
      f("html", "HTML"),
      f("cb", "Column Break"),
      f("empty_tab", "Tab Break", { label: "Empty" }),
    ])
    expect(tabs).toHaveLength(1)
    expect(tabs[0]!.sections[0]!.columns).toHaveLength(1)
    expect(tabs[0]!.sections[0]!.columns[0]!.fields.map((x) => x.fieldname)).toEqual(["a"])
  })

  it("keeps labelled sections even when empty", () => {
    const tabs = parseLayout([f("a", "Data"), f("s", "Section Break", { label: "Later" })])
    expect(tabs[0]!.sections.map((s) => s.label)).toEqual(["", "Later"])
  })
})
