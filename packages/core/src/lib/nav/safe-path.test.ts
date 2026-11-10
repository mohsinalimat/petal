import { describe, expect, it } from "vitest"
import { safeInternalPath } from "./safe-path"

describe("safeInternalPath", () => {
  it.each([
    ["/form/Sales%20Invoice/new", "/form/Sales%20Invoice/new"],
    ["/list/Item?status=Open#top", "/list/Item?status=Open#top"],
    ["/", "/"],
  ])("keeps same-origin path %j", (input, expected) => {
    expect(safeInternalPath(input)).toBe(expected)
  })

  it.each([
    "https://evil.example/phish",
    "//evil.example",
    "/\\evil.example",
    "/\tevil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    " /list/Item",
    "list/Item",
    "data:text/html,hi",
    "",
    null,
    undefined,
  ])("rejects %j", (input) => {
    expect(safeInternalPath(input)).toBeNull()
  })
})
