// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest"
import { ensureCompat } from "."

describe("ensureCompat boot", () => {
  it("rejects when frappe.sessions.get fails, then retries on the next call", async () => {
    let fail = true
    const opts = {
      transport: async (method: string) => {
        if (method === "frappe.sessions.get") {
          return fail
            ? { status: 502, data: { exc_type: "BadGateway" } }
            : { status: 200, data: { message: { sysdefaults: { currency: "INR" }, user: { name: "Administrator", roles: [], defaults: {} } } } }
        }
        return { status: 200, data: { message: null } }
      },
      navigate: () => {},
      toast: () => {},
      autoBundles: false,
      fetchText: async () => "{}",
    }
    await expect(ensureCompat(opts)).rejects.toBeTruthy()
    fail = false
    const frappe = await ensureCompat(opts)
    expect(frappe.boot.sysdefaults.currency).toBe("INR")
    expect(frappe.session.user).toBe("Administrator")
    // Globals were installed once and survive the retry.
    expect(typeof (window as any).frappe.ui.form.on).toBe("function")
  })
})
