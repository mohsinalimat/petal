import { describe, expect, it, vi } from "vitest"
import {
  buildSetupArgs,
  buildSlides,
  companyAbbr,
  computeSetupStatus,
  fetchSetupStatus,
  fieldDefaults,
  fiscalYearEnd,
  fiscalYearFor,
  guessCountry,
  isSystemManager,
  selectOptions,
  validateSlide,
  type SetupStatus,
} from "./setup-wizard"

const freshSite: SetupStatus = { complete: false, pendingApps: ["frappe", "erpnext"], installedApps: ["frappe", "erpnext"] }
const admin = { name: "Administrator" }

describe("computeSetupStatus", () => {
  it("is incomplete while frappe or erpnext is pending", () => {
    const st = computeSetupStatus([
      { app_name: "frappe", has_setup_wizard: 1, is_setup_complete: 1 },
      { app_name: "erpnext", has_setup_wizard: 1, is_setup_complete: 0 },
      { app_name: "hrms", has_setup_wizard: 0, is_setup_complete: 0 },
    ])
    expect(st.complete).toBe(false)
    expect(st.pendingApps).toEqual(["erpnext"])
  })

  it("ignores non-gating apps for completeness", () => {
    const st = computeSetupStatus([
      { app_name: "frappe", has_setup_wizard: 1, is_setup_complete: 1 },
      { app_name: "edusuite", has_setup_wizard: 1, is_setup_complete: 0 },
    ])
    expect(st.complete).toBe(true)
    expect(st.pendingApps).toEqual(["edusuite"])
  })

  it("treats an empty table as incomplete, like frappe.is_setup_complete", () => {
    expect(computeSetupStatus([]).complete).toBe(false)
  })
})

describe("fetchSetupStatus", () => {
  it("reads Installed Applications fresh", async () => {
    const client = {
      invalidate: vi.fn(),
      getDoc: vi.fn().mockResolvedValue({ installed_applications: [{ app_name: "frappe", has_setup_wizard: 1, is_setup_complete: 0 }] }),
    }
    const st = await fetchSetupStatus(client as never)
    expect(client.invalidate).toHaveBeenCalledWith("Installed Applications")
    expect(client.getDoc).toHaveBeenCalledWith("Installed Applications", "Installed Applications")
    expect(st).toMatchObject({ complete: false, pendingApps: ["frappe"] })
  })

  it("treats a permission error as complete (non-System Managers never see the wizard)", async () => {
    const client = { invalidate: vi.fn(), getDoc: vi.fn().mockRejectedValue(new Error("403")) }
    expect((await fetchSetupStatus(client as never)).complete).toBe(true)
  })
})

describe("isSystemManager", () => {
  it("accepts Administrator and System Manager role", () => {
    expect(isSystemManager(admin)).toBe(true)
    expect(isSystemManager({ name: "a@b.c", roles: ["System Manager"] })).toBe(true)
    expect(isSystemManager({ name: "a@b.c", roles: ["Accounts User"] })).toBe(false)
    expect(isSystemManager(null)).toBe(false)
  })
})

describe("fiscal year", () => {
  it("India starts April; before April belongs to the previous year", () => {
    expect(fiscalYearFor("India", new Date(2026, 10, 8))).toEqual({ start: "2026-04-01", end: "2027-03-31" })
    expect(fiscalYearFor("India", new Date(2027, 1, 10))).toEqual({ start: "2026-04-01", end: "2027-03-31" })
  })

  it("defaults to the calendar year", () => {
    expect(fiscalYearFor("Germany", new Date(2026, 5, 1))).toEqual({ start: "2026-01-01", end: "2026-12-31" })
    expect(fiscalYearFor(undefined, new Date(2026, 5, 1))).toEqual({ start: "2026-01-01", end: "2026-12-31" })
  })

  it("end is start + 12 months − 1 day, including leap years", () => {
    expect(fiscalYearEnd("2026-07-16")).toBe("2027-07-15")
    expect(fiscalYearEnd("2027-03-01")).toBe("2028-02-29")
  })
})

describe("companyAbbr", () => {
  it("takes first letters, upper-cased, max 10", () => {
    expect(companyAbbr("Acme widgets  pvt ltd")).toBe("AWPL")
    expect(companyAbbr("a b c d e f g h i j k l")).toBe("ABCDEFGHIJ")
    expect(companyAbbr("")).toBe("")
  })
})

describe("guessCountry", () => {
  it("matches the browser timezone", () => {
    const info = { India: { timezones: ["Asia/Kolkata"] }, Nepal: { timezones: ["Asia/Kathmandu"] } }
    expect(guessCountry(info, "Asia/Kathmandu")).toBe("Nepal")
    expect(guessCountry(info, "Europe/Paris")).toBeUndefined()
  })
})

describe("buildSlides", () => {
  it("fresh ERPNext site: region, user, organization", () => {
    expect(buildSlides({ status: freshSite, user: admin }).map((s) => s.name)).toEqual(["region", "user", "organization"])
  })

  it("skips frappe slides once frappe is set up", () => {
    const st = { ...freshSite, pendingApps: ["erpnext"] }
    expect(buildSlides({ status: st, user: admin }).map((s) => s.name)).toEqual(["organization"])
  })

  it("plain Frappe site has no organization slide", () => {
    const st = { complete: false, pendingApps: ["frappe"], installedApps: ["frappe"] }
    expect(buildSlides({ status: st, user: admin }).map((s) => s.name)).toEqual(["region", "user"])
  })

  it("requires email + password only for Administrator", () => {
    const forAdmin = buildSlides({ status: freshSite, user: admin }).find((s) => s.name === "user")!
    const forUser = buildSlides({ status: freshSite, user: { name: "u@x.io" } }).find((s) => s.name === "user")!
    expect(forAdmin.fields.filter((f) => f.reqd).map((f) => f.fieldname)).toEqual(["full_name", "email", "password"])
    expect(forUser.fields.filter((f) => f.reqd).map((f) => f.fieldname)).toEqual(["full_name"])
  })

  it("adds app slides only while their app is pending, without duplicates", () => {
    const appSlides = [
      { name: "school", app: "edusuite", title: "School", fields: [] },
      { name: "billing", app: "billing", title: "Billing", fields: [] },
      { name: "extra", title: "Extra", fields: [] },
      { name: "region", title: "Dup", fields: [] },
    ]
    const st = { ...freshSite, pendingApps: ["frappe", "edusuite"] }
    expect(buildSlides({ status: st, user: admin, appSlides }).map((s) => s.name)).toEqual(["region", "user", "school", "extra"])
  })
})

describe("validateSlide", () => {
  const [region, user, org] = buildSlides({ status: freshSite, user: admin })

  it("reports missing required fields by label", () => {
    expect(validateSlide(region!, { language: "English" })).toBe("Please fill in: Your Country, Time Zone, Currency")
  })

  it("does not treat an unchecked Check as missing", () => {
    expect(validateSlide(region!, { language: "English", country: "India", timezone: "Asia/Kolkata", currency: "INR" })).toBeNull()
  })

  it("validates email and password", () => {
    expect(validateSlide(user!, { full_name: "A", email: "nope", password: "secret1" })).toMatch(/valid email/)
    expect(validateSlide(user!, { full_name: "A", email: "a@b.io", password: "123" })).toMatch(/6 characters/)
    expect(validateSlide(user!, { full_name: "A", email: "a@b.io", password: "secret1" })).toBeNull()
  })

  it("applies ERPNext's organization rules", () => {
    const base = { company_name: "Acme", company_abbr: "AC", fy_start_date: "2026-04-01", fy_end_date: "2027-03-31" }
    expect(validateSlide(org!, base)).toBeNull()
    expect(validateSlide(org!, { ...base, company_name: "Company" })).toMatch(/cannot be/)
    expect(validateSlide(org!, { ...base, company_abbr: "ABCDEFGHIJK" })).toMatch(/10 characters/)
    expect(validateSlide(org!, { ...base, fy_end_date: "2026-01-01" })).toMatch(/before its end/)
  })

  it("checks Int fields", () => {
    const slide = { name: "x", title: "X", fields: [{ fieldname: "n", label: "Count", fieldtype: "Int" as const }] }
    expect(validateSlide(slide, { n: "1.5" })).toMatch(/whole number/)
    expect(validateSlide(slide, { n: "3" })).toBeNull()
  })
})

describe("buildSetupArgs", () => {
  it("normalises values into setup_complete args", () => {
    const slides = buildSlides({ status: freshSite, user: admin })
    const args = buildSetupArgs(slides, {
      language: "English", country: "India", timezone: "Asia/Kolkata", currency: "INR",
      enable_telemetry: false, full_name: "  Ujjwal P ", email: "u@x.io", password: "",
      company_name: "Acme", company_abbr: "AC", chart_of_accounts: "Standard",
      fy_start_date: "2026-04-01", fy_end_date: "2027-03-31", setup_demo: true, stray: "ignored",
    })
    expect(args).toEqual({
      language: "English", country: "India", timezone: "Asia/Kolkata", currency: "INR",
      enable_telemetry: 0, full_name: "Ujjwal P", email: "u@x.io",
      company_name: "Acme", company_abbr: "AC", chart_of_accounts: "Standard",
      fy_start_date: "2026-04-01", fy_end_date: "2027-03-31", setup_demo: 1,
    })
  })
})

describe("helpers", () => {
  it("fieldDefaults and selectOptions", () => {
    const slides = buildSlides({ status: freshSite, user: admin })
    expect(fieldDefaults(slides)).toEqual({ language: "English", enable_telemetry: 0, setup_demo: 0 })
    expect(selectOptions({ fieldname: "a", label: "A", fieldtype: "Select", options: "X\n Y \n\n" })).toEqual(["X", "Y"])
    expect(selectOptions({ fieldname: "a", label: "A", fieldtype: "Select", options: ["P"] })).toEqual(["P"])
  })
})
