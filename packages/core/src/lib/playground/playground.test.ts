import { describe, it, expect } from "vitest"
import { describeRequest, parseJsonObject, pushHistory, toClientSnippet, toCurlSnippet, validateRequest } from "./playground"
import type { HistoryEntry } from "./playground"

describe("validateRequest", () => {
  it("validates method paths and JSON args", () => {
    expect(validateRequest({ kind: "method", method: "frappe.client.get_count", args: "" })).toBeNull()
    expect(validateRequest({ kind: "method", method: "get_count", args: "" })).toMatch(/dotted path/)
    expect(validateRequest({ kind: "method", method: "a.b", args: "[1]" })).toMatch(/JSON object/)
    expect(validateRequest({ kind: "method", method: "a.b", args: "{bad" })).toMatch(/Invalid JSON/)
  })

  it("validates get_doc and get_list inputs", () => {
    expect(validateRequest({ kind: "get_doc", doctype: "User", name: "" })).toMatch(/name is required/)
    expect(validateRequest({ kind: "get_list", doctype: "User", fields: '"name"', filters: "", limit: 10 })).toMatch(/Fields must be/)
    expect(validateRequest({ kind: "get_list", doctype: "User", fields: "", filters: "", limit: 0 })).toMatch(/Limit/)
    expect(validateRequest({ kind: "get_list", doctype: "User", fields: '["name"]', filters: '[["enabled","=",1]]', limit: 20 })).toBeNull()
  })

  it("treats empty args as an empty object", () => {
    expect(parseJsonObject("  ")).toEqual({ ok: true, value: {} })
  })
})

describe("snippets", () => {
  it("generates Petal client calls", () => {
    expect(toClientSnippet({ kind: "method", method: "a.b", args: "" })).toBe('await frappe.callMethod("a.b")')
    expect(toClientSnippet({ kind: "method", method: "a.b", args: '{"x":1}' })).toContain('"x": 1')
    expect(toClientSnippet({ kind: "get_doc", doctype: "User", name: "Admin" })).toBe('await frappe.getDoc("User", "Admin")')
    expect(toClientSnippet({ kind: "get_list", doctype: "ToDo", fields: "", filters: "", limit: 5 })).toContain('"name"')
  })

  it("generates curl against the real Frappe API with token auth and safe quoting", () => {
    const c = toCurlSnippet({ kind: "method", method: "a.b", args: `{"q":"it's"}` }, "https://erp.example.com/")
    expect(c).toContain('"https://erp.example.com/api/method/a.b"')
    expect(c).toContain("Authorization: token")
    expect(c).toContain(`'{"q":"it'\\''s"}'`)
    expect(toCurlSnippet({ kind: "get_doc", doctype: "Sales Invoice", name: "S/1" }, "https://e"))
      .toContain("/api/resource/Sales%20Invoice/S%2F1")
  })
})

describe("history", () => {
  const e = (method: string, at: number): HistoryEntry => ({ kind: "method", method, args: "", at, ok: true, ms: 1 })

  it("prepends, de-duplicates identical requests and caps length", () => {
    let h: HistoryEntry[] = []
    h = pushHistory(h, e("a.a", 1))
    h = pushHistory(h, e("b.b", 2))
    h = pushHistory(h, e("a.a", 3))
    expect(h.map((x) => [x.kind === "method" ? x.method : "", x.at])).toEqual([["a.a", 3], ["b.b", 2]])
    expect(pushHistory(h, e("c.c", 4), 2)).toHaveLength(2)
  })

  it("describes requests", () => {
    expect(describeRequest({ kind: "get_doc", doctype: "User", name: "x" })).toBe("GET User/x")
    expect(describeRequest({ kind: "get_list", doctype: "User", fields: "", filters: "", limit: 1 })).toBe("LIST User")
  })
})
