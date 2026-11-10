// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { sanitizeHtml } from "./FrappeHtml"

const hrefOf = (html: string) => {
  const div = document.createElement("div")
  div.innerHTML = sanitizeHtml(html)
  return div.querySelector("a")?.getAttribute("href") ?? null
}

describe("sanitizeHtml", () => {
  it("blocks javascript: URLs hidden with control characters, entities or case", () => {
    expect(hrefOf('<a href="java&#x09;script:alert(1)">x</a>')).toBeNull()
    expect(hrefOf('<a href="java\nscript:alert(1)">x</a>')).toBeNull()
    expect(hrefOf('<a href=" &#x01;JavaScript:alert(1)">x</a>')).toBeNull()
    expect(hrefOf('<a href="vbscript:x">x</a>')).toBeNull()
    expect(hrefOf('<a href="data:text/html,<script>alert(1)</script>">x</a>')).toBeNull()
  })

  it("keeps ordinary links, Desk routes and inline images", () => {
    expect(hrefOf('<a href="/app/sales-invoice/SINV-1">x</a>')).toBe("/app/sales-invoice/SINV-1")
    expect(hrefOf('<a href="https://erpnext.com">x</a>')).toBe("https://erpnext.com")
    expect(hrefOf('<a href="#section">x</a>')).toBe("#section")
    expect(hrefOf('<a href="mailto:a@b.co">x</a>')).toBe("mailto:a@b.co")
    expect(sanitizeHtml('<img src="data:image/png;base64,AAAA">')).toContain("data:image/png")
  })

  it("drops style elements and SVG animations", () => {
    const out = sanitizeHtml('<style>body{display:none}</style><svg><a><animate attributeName="href" values="javascript:alert(1)"/><text>x</text></a></svg><svg><set attributeName="onclick" to="alert(1)"/></svg>ok')
    expect(out).not.toMatch(/<style|<animate|<set/i)
    expect(out).toContain("ok")
  })

  it("removes event handlers and xlink:href javascript", () => {
    const out = sanitizeHtml('<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg><b onmouseover="alert(1)">b</b>')
    expect(out).not.toMatch(/javascript|onmouseover/i)
  })
})
