import { describe, it, expect, vi, beforeEach } from "vitest"
import { backendFor, normalizeHost, parseTenants, requestHost, resolveTenant } from "./tenants"
import { appOrigins } from "./env-config"

const headers = (h: Record<string, string>) => ({ get: (k: string) => h[k.toLowerCase()] ?? null })

const TENANTS = JSON.stringify({
  "Acme.Example.com": { name: "Acme", frappeUrl: "http://acme-frappe:8000/", frappeSite: "acme.example.com", apps: [{ name: "hr", version: "1", url: "https://cdn.x.com/hr.js" }] },
  "*.beta.example.com": { frappeUrl: "http://beta-frappe:8000", apps: [], pathMap: { "auth/csrf": "api/method/beta.csrf" } },
  "broken.example.com": { apps: [] },
  "badurl.example.com": { frappeUrl: "not a url", apps: [] },
})

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}) })

describe("parseTenants", () => {
  it("returns null when unset, and for non-object or invalid JSON", () => {
    expect(parseTenants(undefined)).toBeNull()
    expect(parseTenants("  ")).toBeNull()
    expect(parseTenants("[1]")).toBeNull()
    expect(parseTenants("{nope")).toBeNull()
  })

  it("normalises host keys and skips invalid tenants with an error", () => {
    const map = parseTenants(TENANTS)!
    expect(Object.keys(map).sort()).toEqual(["*.beta.example.com", "acme.example.com"])
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('"broken.example.com"'))
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("not a valid URL"))
  })

  it("caches by raw string", () => {
    expect(parseTenants(TENANTS)).toBe(parseTenants(TENANTS))
  })
})

describe("host resolution", () => {
  it("normalises case, ports and trailing dots", () => {
    expect(normalizeHost(" ACME.example.com:3000 ")).toBe("acme.example.com")
    expect(normalizeHost("acme.example.com.")).toBe("acme.example.com")
  })

  it("prefers the first X-Forwarded-Host over Host", () => {
    expect(requestHost(headers({ host: "petal:3000", "x-forwarded-host": "acme.example.com, proxy" }))).toBe("acme.example.com")
    expect(requestHost(headers({ host: "acme.example.com:443" }))).toBe("acme.example.com")
    expect(requestHost(headers({}))).toBe("")
  })

  it("matches exact hosts, then one-level wildcards", () => {
    const map = parseTenants(TENANTS)!
    expect(resolveTenant(map, "acme.example.com")?.name).toBe("Acme")
    expect(resolveTenant(map, "x.beta.example.com")?.frappeUrl).toBe("http://beta-frappe:8000")
    expect(resolveTenant(map, "beta.example.com")).toBeNull()
    expect(resolveTenant(map, "other.com")).toBeNull()
  })
})

describe("backendFor", () => {
  it("is single-tenant without PETAL_TENANTS", () => {
    expect(backendFor(headers({ host: "anything" }), { FRAPPE_BACKEND_URL: "http://erp.local:8000/" }))
      .toEqual({ frappeUrl: "http://erp.local:8000", siteHost: "erp.local", apps: null })
    expect(backendFor(headers({}), { FRAPPE_BACKEND_URL: "", FRAPPE_SITE_NAME: "site1.local" }))
      .toEqual({ frappeUrl: "http://localhost:8000", siteHost: "site1.local", apps: null })
  })

  it("routes by host in multi-tenant mode and rejects unknown hosts", () => {
    const env = { PETAL_TENANTS: TENANTS, FRAPPE_BACKEND_URL: "http://ignored:8000" }
    const acme = backendFor(headers({ host: "acme.example.com" }), env)!
    expect(acme.frappeUrl).toBe("http://acme-frappe:8000")
    expect(acme.siteHost).toBe("acme.example.com")
    expect(acme.apps!.map((a) => a.name)).toEqual(["hr"])
    const beta = backendFor(headers({ host: "eu.beta.example.com" }), env)!
    expect(beta.siteHost).toBe("beta-frappe")
    expect(beta.pathMap).toEqual({ "auth/csrf": "api/method/beta.csrf" })
    expect(backendFor(headers({ host: "evil.com" }), env)).toBeNull()
  })

  it("feeds CSP origins for the tenant's apps", () => {
    const acme = backendFor(headers({ host: "acme.example.com" }), { PETAL_TENANTS: TENANTS })!
    expect(appOrigins(acme.apps!)).toEqual(["https://cdn.x.com"])
  })
})
