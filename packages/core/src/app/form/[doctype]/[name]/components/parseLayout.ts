import type { MetaField, LayoutTab, LayoutSection } from "./types"

export const SKIP_RENDER = new Set([
  "HTML", "Fold", "Button", "Heading", "Break",
  "Tab Break", "Section Break", "Column Break",
])

export function parseLayout(fields: MetaField[]): LayoutTab[] {
  const tabs: LayoutTab[] = []
  let currentTab: LayoutTab         = { label: "Details", fieldname: "__default__", sections: [] }
  let currentSection: LayoutSection = { label: "", collapsible: false, columns: [{ label: "", fields: [] }] }
  let colIdx = 0

  function pushSection() {
    const nonEmpty = currentSection.columns.filter((c) => c.fields.length > 0)
    if (nonEmpty.length > 0 || currentSection.label) {
      currentTab.sections.push({
        ...currentSection,
        columns: nonEmpty.length > 0 ? nonEmpty : [{ label: "", fields: [] }],
      })
    }
  }
  function pushTab() {
    pushSection()
    if (currentTab.sections.length > 0) tabs.push(currentTab)
  }

  for (const f of fields) {
    if (f.hidden === 1) continue

    if (f.fieldtype === "Tab Break") {
      pushTab()
      currentTab     = { label: f.label || "Tab", fieldname: f.fieldname, sections: [] }
      currentSection = { label: "", collapsible: false, columns: [{ label: "", fields: [] }] }
      colIdx         = 0
    } else if (f.fieldtype === "Section Break") {
      pushSection()
      currentSection = { label: f.label || "", collapsible: f.collapsible === 1, columns: [{ label: "", fields: [] }] }
      if (f.fieldname) currentSection.fieldname = f.fieldname
      colIdx         = 0
    } else if (f.fieldtype === "Column Break") {
      colIdx++
      while (currentSection.columns.length <= colIdx) {
        currentSection.columns.push({ label: "", fields: [] })
      }
      currentSection.columns[colIdx]!.label = f.label || ""
      if (f.fieldname) currentSection.columns[colIdx]!.fieldname = f.fieldname
    } else if (!SKIP_RENDER.has(f.fieldtype)) {
      while (currentSection.columns.length <= colIdx) {
        currentSection.columns.push({ label: "", fields: [] })
      }
      currentSection.columns[colIdx]!.fields.push(f)
    }
  }

  pushTab()
  return tabs.length > 0 ? tabs : [{ label: "Details", fieldname: "__default__", sections: [] }]
}
