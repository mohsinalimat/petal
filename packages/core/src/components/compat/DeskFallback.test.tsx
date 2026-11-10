import { afterEach, describe, expect, it, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { deskBaseUrl, deskFormUrl, deskPageUrl } from "@/lib/frappe-compat/desk"
import { DeskFallback } from "./DeskFallback"

afterEach(() => vi.unstubAllEnvs())

describe("Desk fallback", () => {
  it("builds Desk URLs and rejects non-http addresses", () => {
    expect(deskBaseUrl({ NEXT_PUBLIC_PETAL_DESK_URL: "https://erp.example.com/" })).toBe("https://erp.example.com")
    expect(deskBaseUrl({ NEXT_PUBLIC_PETAL_DESK_URL: "javascript:alert(1)" })).toBeNull()
    expect(deskBaseUrl({})).toBeNull()
    expect(deskFormUrl("https://erp.example.com", "Shift Assignment Tool", "new")).toBe("https://erp.example.com/app/shift-assignment-tool/new")
    expect(deskFormUrl("https://erp.example.com", "Sales Invoice", "SINV/1")).toBe("https://erp.example.com/app/sales-invoice/SINV%2F1")
    expect(deskPageUrl("https://erp.example.com", "point-of-sale")).toBe("https://erp.example.com/app/point-of-sale")
  })

  it("links to Desk, and embeds it only when asked", () => {
    vi.stubEnv("NEXT_PUBLIC_PETAL_DESK_URL", "https://erp.example.com")
    const { rerender } = render(<DeskFallback doctype="Location" name="LOC-1" />)
    expect(screen.getByRole("link", { name: /Open in Desk/ }).getAttribute("href")).toBe("https://erp.example.com/app/location/LOC-1")
    expect(screen.queryByTitle("Location LOC-1")).toBeNull()
    rerender(<DeskFallback doctype="Location" name="LOC-1" embed />)
    expect(screen.getByTitle("Location LOC-1").getAttribute("src")).toBe("https://erp.example.com/app/location/LOC-1")
  })

  it("explains the missing setting instead of linking nowhere", () => {
    vi.stubEnv("NEXT_PUBLIC_PETAL_DESK_URL", "")
    render(<DeskFallback doctype="Location" name="new" />)
    expect(screen.getByRole("status").textContent).toContain("NEXT_PUBLIC_PETAL_DESK_URL")
  })
})
