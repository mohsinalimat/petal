import { describe, it, expect } from "vitest"
import { parseCsv, toCsv } from "./csv"

describe("parseCsv", () => {
  it("parses headers and rows", () => {
    expect(parseCsv("a,b\n1,2\n3,4")).toEqual({ headers: ["a", "b"], rows: [["1", "2"], ["3", "4"]] })
  })

  it("handles quoted fields with delimiters, escaped quotes and newlines", () => {
    const t = parseCsv('name,note\n"Smith, J","said ""hi""\nthen left"\n')
    expect(t.rows).toEqual([["Smith, J", 'said "hi"\nthen left']])
  })

  it("handles CRLF, a UTF-8 BOM and trims header whitespace", () => {
    expect(parseCsv("﻿ a , b \r\n1,2\r\n")).toEqual({ headers: ["a", "b"], rows: [["1", "2"]] })
  })

  it("skips blank lines and keeps empty trailing cells", () => {
    expect(parseCsv("a,b,c\n\n1,,\n\n").rows).toEqual([["1", "", ""]])
  })

  it("supports a custom delimiter", () => {
    expect(parseCsv("a;b\n1;2", ";").rows).toEqual([["1", "2"]])
  })

  it("returns empty headers for empty input", () => {
    expect(parseCsv("")).toEqual({ headers: [], rows: [] })
  })
})

describe("toCsv", () => {
  const cols = [{ key: "a", label: "A" }, { key: "b", label: "B, quoted" }]

  it("writes a header and CRLF-terminated rows", () => {
    expect(toCsv([{ a: 1, b: "x" }], cols)).toBe('A,"B, quoted"\r\n1,x\r\n')
  })

  it("quotes cells containing quotes or newlines and blanks nulls", () => {
    expect(toCsv([{ a: 'say "hi"', b: null }, { a: "l1\nl2" }], cols)).toBe('A,"B, quoted"\r\n"say ""hi""",\r\n"l1\nl2",\r\n')
  })

  it("neutralises spreadsheet formula injection but keeps negative numbers", () => {
    const out = toCsv([{ a: "=HYPERLINK(1)", b: "-12.5" }], cols)
    expect(out).toContain("'=HYPERLINK(1)")
    expect(out).toContain(",-12.5")
  })

  it("serialises objects as JSON", () => {
    expect(toCsv([{ a: { x: 1 } }], [{ key: "a", label: "A" }])).toBe('A\r\n"{""x"":1}"\r\n')
  })

  it("round-trips through parseCsv", () => {
    const rows = [{ a: "1, 2", b: 'q"q' }, { a: "multi\nline", b: "" }]
    const parsed = parseCsv(toCsv(rows, cols))
    expect(parsed.rows).toEqual([["1, 2", 'q"q'], ["multi\nline", ""]])
  })
})
