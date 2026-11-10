/**
 * First-run setup wizard — the Petal counterpart of Frappe Desk's
 * /app/setup-wizard. Pure logic lives here (status detection, slide building,
 * defaults, validation); the page at app/setup-wizard renders it.
 *
 * Backend contract (Frappe v15):
 *   - status:   "Installed Applications" single → rows with has_setup_wizard / is_setup_complete.
 *               Mirrors frappe.is_setup_complete(): frappe (+ erpnext, if installed) must be complete.
 *   - submit:   frappe.desk.page.setup_wizard.setup_wizard.setup_complete(args)
 *               → {status: "ok"} or, with trigger_site_setup_in_background,
 *                 {status: "registered"} + realtime "setup_task" events.
 */
import type { FrappeDocument, SetupWizardField, SetupWizardSlide } from "@petal/sdk"
import type { FrappeClient } from "@/lib/frappe/client"

export const SETUP_METHODS = {
  complete: "frappe.desk.page.setup_wizard.setup_wizard.setup_complete",
  languages: "frappe.desk.page.setup_wizard.setup_wizard.load_languages",
  country: "frappe.desk.page.setup_wizard.setup_wizard.load_country",
  regional: "frappe.geo.country_info.get_country_timezone_info",
  charts: "erpnext.accounts.doctype.account.chart_of_accounts.chart_of_accounts.get_charts_for_country",
} as const

/** Apps whose setup gates the whole site — same list as frappe.is_setup_complete(). */
const GATING_APPS = ["frappe", "erpnext"]

export interface InstalledAppRow {
  app_name: string
  has_setup_wizard?: 0 | 1 | boolean
  is_setup_complete?: 0 | 1 | boolean
}

export interface SetupStatus {
  complete: boolean
  /** Apps with a setup wizard that hasn't run yet, e.g. ["frappe", "erpnext"]. */
  pendingApps: string[]
  installedApps: string[]
}

export function computeSetupStatus(rows: InstalledAppRow[]): SetupStatus {
  const installedApps = rows.map((r) => r.app_name)
  const pendingApps = rows
    .filter((r) => Boolean(r.has_setup_wizard) && !r.is_setup_complete)
    .map((r) => r.app_name)
  const gating = rows.filter((r) => GATING_APPS.includes(r.app_name))
  const complete = gating.length > 0 && gating.every((r) => Boolean(r.is_setup_complete))
  return { complete, pendingApps, installedApps }
}

export interface CountryInfo {
  currency?: string
  timezones?: string[]
  date_format?: string
  code?: string
}

export interface RegionalData {
  country_info: Record<string, CountryInfo>
  all_timezones: string[]
}

/** Fiscal year [start, end] as MM-DD — copied from erpnext/public/js/setup_wizard.js. */
export const FISCAL_YEARS: Record<string, [string, string]> = {
  Afghanistan: ["12-21", "12-20"],
  Australia: ["07-01", "06-30"],
  Bangladesh: ["07-01", "06-30"],
  "Costa Rica": ["10-01", "09-30"],
  Egypt: ["07-01", "06-30"],
  Ethiopia: ["07-08", "07-07"],
  "Hong Kong": ["04-01", "03-31"],
  India: ["04-01", "03-31"],
  Iran: ["06-23", "06-22"],
  Kenya: ["07-01", "06-30"],
  Malaysia: ["07-01", "06-30"],
  Myanmar: ["04-01", "03-31"],
  Nepal: ["07-16", "07-15"],
  "New Zealand": ["04-01", "03-31"],
  Pakistan: ["07-01", "06-30"],
  Singapore: ["04-01", "03-31"],
  "South Africa": ["03-01", "02-28"],
  Thailand: ["10-01", "09-30"],
  "United Kingdom": ["04-01", "03-31"],
}

function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

/** The fiscal year that contains `today` for the given country (ERPNext's rules). */
export function fiscalYearFor(country: string | undefined, today: Date = new Date()): { start: string; end: string } {
  const todayStr = isoDate(today)
  let year = today.getFullYear()
  const fy = country ? FISCAL_YEARS[country] : undefined
  if (!fy) return { start: `${year}-01-01`, end: `${year}-12-31` }
  if (`${year}-${fy[0]}` > todayStr) year -= 1
  return { start: `${year}-${fy[0]}`, end: fiscalYearEnd(`${year}-${fy[0]}`) }
}

/** start + 12 months − 1 day, as ERPNext computes fy_end_date. */
export function fiscalYearEnd(start: string): string {
  const [y, m, d] = start.split("-").map(Number) as [number, number, number]
  const end = new Date(y, m - 1 + 12, d)
  end.setDate(end.getDate() - 1)
  return isoDate(end)
}

/** "Acme Widgets Pvt Ltd" → "AWPL" (first letters, max 10, upper-case) — ERPNext's rule. */
export function companyAbbr(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((p) => p[0])
    .join("")
    .slice(0, 10)
    .toUpperCase()
}

/** Best guess of the user's country from the browser timezone. */
export function guessCountry(info: Record<string, CountryInfo>, timeZone?: string): string | undefined {
  const tz = timeZone ?? (typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined)
  if (!tz) return undefined
  for (const [country, ci] of Object.entries(info)) {
    if (ci.timezones?.includes(tz)) return country
  }
  return undefined
}

export interface WizardContext {
  status: SetupStatus
  /** Logged-in user — Administrator must set an email + password for the first real user. */
  user: { name: string; email?: string; full_name?: string }
  appSlides?: SetupWizardSlide[] | undefined
}

/** Built-in slide ids; their fields are rendered by the page with richer widgets. */
export const BUILTIN_SLIDES = {
  region: "region",
  user: "user",
  organization: "organization",
} as const

export function buildSlides(ctx: WizardContext): SetupWizardSlide[] {
  const { status, user } = ctx
  const isAdmin = user.name === "Administrator"
  const slides: SetupWizardSlide[] = []

  if (status.pendingApps.includes("frappe")) {
    slides.push({
      name: BUILTIN_SLIDES.region,
      title: "Welcome",
      description: "Pick your language and region. These set defaults for dates, numbers and currency.",
      fields: [
        { fieldname: "language", label: "Your Language", fieldtype: "Select", reqd: true, default: "English" },
        { fieldname: "country", label: "Your Country", fieldtype: "Select", reqd: true },
        { fieldname: "timezone", label: "Time Zone", fieldtype: "Select", reqd: true },
        { fieldname: "currency", label: "Currency", fieldtype: "Select", reqd: true },
        { fieldname: "enable_telemetry", label: "Allow sending usage data for improving applications", fieldtype: "Check", default: 0 },
      ],
    })
    slides.push({
      name: BUILTIN_SLIDES.user,
      title: "Let's set up your account",
      description: isAdmin
        ? "This becomes the first System Manager. You'll be signed in as this user when setup finishes."
        : "Confirm your name. Leave the password blank to keep your current one.",
      fields: [
        { fieldname: "full_name", label: "Full Name", fieldtype: "Data", reqd: true },
        { fieldname: "email", label: "Email Address (your login ID)", fieldtype: "Data", reqd: isAdmin },
        { fieldname: "password", label: isAdmin ? "Password" : "Update Password", fieldtype: "Password", reqd: isAdmin },
      ],
      validate: (v) => {
        const email = String(v.email ?? "").trim()
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Enter a valid email address."
        const pwd = String(v.password ?? "")
        if (pwd && pwd.length < 6) return "Password must be at least 6 characters."
        return null
      },
    })
  }

  if (status.pendingApps.includes("erpnext")) {
    slides.push({
      name: BUILTIN_SLIDES.organization,
      title: "Set up your organization",
      description: "Your first company. Accounts, warehouses and cost centers are created for it.",
      fields: [
        { fieldname: "company_name", label: "Company Name", fieldtype: "Data", reqd: true },
        { fieldname: "company_abbr", label: "Company Abbreviation", fieldtype: "Data", reqd: true },
        { fieldname: "chart_of_accounts", label: "Chart of Accounts", fieldtype: "Select" },
        { fieldname: "fy_start_date", label: "Financial Year Begins On", fieldtype: "Date", reqd: true },
        { fieldname: "fy_end_date", label: "Financial Year Ends On", fieldtype: "Date", reqd: true },
        {
          fieldname: "setup_demo",
          label: "Generate demo data for exploration",
          fieldtype: "Check",
          default: 0,
          description: "Creates sample records you can erase later.",
        },
      ],
      validate: (v) => {
        const name = String(v.company_name ?? "").trim()
        if (name.toLowerCase() === "company") return "Company Name cannot be \"Company\"."
        const abbr = String(v.company_abbr ?? "").trim()
        if (abbr.length > 10) return "Company Abbreviation cannot have more than 10 characters."
        const start = String(v.fy_start_date ?? "")
        const end = String(v.fy_end_date ?? "")
        if (start && end && start > end) return "Financial Year start must be before its end."
        return null
      },
    })
  }

  for (const s of ctx.appSlides ?? []) {
    if (s.app && !status.pendingApps.includes(s.app)) continue
    if (slides.some((x) => x.name === s.name)) continue
    slides.push(s)
  }

  return slides
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "")
}

/** Required-field check, then the slide's own validator. Returns an error message or null. */
export function validateSlide(slide: SetupWizardSlide, values: Record<string, unknown>): string | null {
  const missing = slide.fields.filter((f) => f.reqd && f.fieldtype !== "Check" && isEmpty(values[f.fieldname]))
  if (missing.length) return `Please fill in: ${missing.map((f) => f.label).join(", ")}`
  for (const f of slide.fields) {
    if (f.fieldtype === "Int" && !isEmpty(values[f.fieldname]) && !Number.isInteger(Number(values[f.fieldname]))) {
      return `${f.label} must be a whole number.`
    }
  }
  return slide.validate?.(values) ?? null
}

export function fieldDefaults(slides: SetupWizardSlide[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const s of slides) for (const f of s.fields) if (f.default !== undefined) out[f.fieldname] = f.default
  return out
}

export function selectOptions(field: SetupWizardField): string[] {
  if (Array.isArray(field.options)) return field.options
  return (field.options ?? "").split("\n").map((o) => o.trim()).filter(Boolean)
}

/** Shape the collected values into setup_complete's `args`. */
export function buildSetupArgs(slides: SetupWizardSlide[], values: Record<string, unknown>): Record<string, unknown> {
  const args: Record<string, unknown> = {}
  for (const s of slides) {
    for (const f of s.fields) {
      let v = values[f.fieldname]
      if (f.fieldtype === "Check") v = v ? 1 : 0
      else if (f.fieldtype === "Int" && !isEmpty(v)) v = Number(v)
      else if (typeof v === "string") v = v.trim()
      if (f.fieldtype === "Password" && isEmpty(v)) continue
      if (isEmpty(v)) continue
      args[f.fieldname] = v
    }
  }
  return args
}

/**
 * Reads setup status. Users who can't read Installed Applications (anyone but a
 * System Manager) can't run the wizard either, so they're treated as complete.
 */
export async function fetchSetupStatus(client: Pick<FrappeClient, "getDoc" | "invalidate">): Promise<SetupStatus> {
  try {
    // GETs are cached for 30s; status must be fresh (it is polled while setup runs).
    client.invalidate("Installed Applications")
    const doc = await client.getDoc<FrappeDocument & { installed_applications?: InstalledAppRow[] }>(
      "Installed Applications",
      "Installed Applications",
    )
    return computeSetupStatus(doc.installed_applications ?? [])
  } catch {
    return { complete: true, pendingApps: [], installedApps: [] }
  }
}

export function isSystemManager(user: { name: string; roles?: string[] } | null | undefined): boolean {
  if (!user) return false
  return user.name === "Administrator" || (user.roles ?? []).includes("System Manager")
}

export type SetupTaskEvent =
  | { progress: [number, number]; stage_status?: string }
  | { status: "ok" }
  | { status: "fail"; fail_msg?: string }
