import { describe, it, expect } from "vitest"
import { EXACT_MAP, extractCsrfToken, rewritePrintHtml, stripCookieDomain, translatePath } from "./proxy-paths"

describe("translatePath", () => {
  it("maps neutral paths, resources and pass-throughs", () => {
    expect(translatePath("auth/login", EXACT_MAP)).toBe("api/method/login")
    expect(translatePath("doc/Sales Invoice/SINV-1", EXACT_MAP)).toBe("api/resource/Sales Invoice/SINV-1")
    expect(translatePath("files/a.png", EXACT_MAP)).toBe("files/a.png")
  })

  it("lets pathMap overrides win", () => {
    expect(translatePath("auth/login", { ...EXACT_MAP, "auth/login": "api/method/custom.login" })).toBe("api/method/custom.login")
  })

  it("no longer hard-codes an app-specific CSRF method", () => {
    expect(EXACT_MAP["auth/csrf"]).toBeUndefined()
  })
})

describe("extractCsrfToken", () => {
  it("reads the token from Frappe's boot page", () => {
    expect(extractCsrfToken('<script>frappe.csrf_token = "abc123def";</script>')).toBe("abc123def")
    expect(extractCsrfToken("window.csrf_token='xyz'")).toBe("xyz")
  })

  it("returns null for guests, unrendered templates and missing tokens", () => {
    expect(extractCsrfToken('frappe.csrf_token = "None";')).toBeNull()
    expect(extractCsrfToken('frappe.csrf_token = "{{ csrf_token }}";')).toBeNull()
    expect(extractCsrfToken("<html></html>")).toBeNull()
  })
})

describe("rewritePrintHtml / stripCookieDomain", () => {
  it("routes assets and files through the proxy and hides Frappe's toolbar", () => {
    const out = rewritePrintHtml('<link href="/assets/a.css"><img src="/files/x.png"><style>b{background:url(/assets/i.png)}</style></body>')
    expect(out).toContain('href="/api/v1/assets/a.css"')
    expect(out).toContain('src="/api/v1/files/x.png"')
    expect(out).toContain("url(/api/v1/assets/i.png)")
    expect(out).toContain(".print-toolbar")
  })

  it("removes only the Domain attribute", () => {
    expect(stripCookieDomain("sid=1; Domain=erp.example.com; Path=/; HttpOnly")).toBe("sid=1; Path=/; HttpOnly")
  })
})
