"use client"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { SetupWizardField, SetupWizardSlide } from "@petal/sdk"
import { Button, Input, cn } from "@petal/ui"
import { getFrappeClient } from "@/hooks/useFrappe"
import { getRealtimeClient } from "@/hooks/useRealtime"
import { usePetalStore } from "@/store/petal-store"
import {
  BUILTIN_SLIDES,
  SETUP_METHODS,
  buildSetupArgs,
  buildSlides,
  companyAbbr,
  fetchSetupStatus,
  fieldDefaults,
  fiscalYearEnd,
  fiscalYearFor,
  guessCountry,
  selectOptions,
  validateSlide,
  type RegionalData,
  type SetupStatus,
  type SetupTaskEvent,
} from "@/lib/setup/setup-wizard"

type Phase =
  | { kind: "loading" }
  | { kind: "load-error"; message: string }
  | { kind: "slides" }
  | { kind: "running"; stage?: string | undefined; progress?: [number, number] }
  | { kind: "done" }

type Values = Record<string, unknown>

const POLL_MS = 4000

const selectClass =
  "flex h-9 w-full rounded-md border border-border bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50"

export default function SetupWizardPage() {
  const user = usePetalStore((s) => s.user)
  const hooks = usePetalStore((s) => s.hooks)
  const hooksReady = usePetalStore((s) => s.hooksReady)

  const [phase, setPhase] = useState<Phase>({ kind: "loading" })
  const [status, setStatus] = useState<SetupStatus | null>(null)
  const [languages, setLanguages] = useState<string[]>([])
  const [regional, setRegional] = useState<RegionalData | null>(null)
  const [charts, setCharts] = useState<string[]>([])
  const [values, setValues] = useState<Values>({})
  const [step, setStep] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const abbrTouched = useRef(false)
  const cleanup = useRef<Array<() => void>>([])
  const runCleanup = useCallback(() => {
    const fns = cleanup.current
    cleanup.current = []
    fns.forEach((fn) => fn())
  }, [])
  /** User the slides were loaded for; a fresh copy of the same user must not reset the answers. */
  const loadedFor = useRef<string | null>(null)
  const userName = user?.name ?? null

  // ── Load everything the slides need ────────────────────────────────────────
  useEffect(() => {
    const user = usePetalStore.getState().user
    if (!user || !hooksReady || loadedFor.current === user.name) return
    const client = getFrappeClient()
    let cancelled = false
    void (async () => {
      try {
        const [st, langs, reg, geo] = await Promise.all([
          fetchSetupStatus(client),
          client.callMethod<{ default_language?: string; languages?: string[] }>(SETUP_METHODS.languages).catch(() => null),
          client.callMethod<RegionalData>(SETUP_METHODS.regional, undefined, { cache: true }),
          client.callMethod<unknown>(SETUP_METHODS.country).catch(() => null),
        ])
        if (cancelled) return
        setStatus(st)
        setLanguages(langs?.languages?.length ? langs.languages : ["English"])
        setRegional(reg)

        const geoCountry = typeof geo === "string" && geo in reg.country_info ? geo : undefined
        const country = geoCountry ?? guessCountry(reg.country_info) ?? ""
        const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone
        const tzs = (country && reg.country_info[country]?.timezones) || []
        const fy = fiscalYearFor(country || undefined)

        const slides = buildSlides({ status: st, user, appSlides: hooks.setup_wizard_slides })
        setValues({
          ...fieldDefaults(slides),
          language: langs?.default_language || "English",
          country,
          timezone: tzs.includes(browserTz) ? browserTz : (tzs[0] ?? browserTz),
          currency: (country && reg.country_info[country]?.currency) || "",
          full_name: user.name === "Administrator" ? "" : (user.full_name ?? ""),
          email: user.name === "Administrator" ? "" : (user.email ?? user.name),
          fy_start_date: fy.start,
          fy_end_date: fy.end,
        })
        loadedFor.current = user.name
        setPhase({ kind: "slides" })
      } catch (e) {
        if (!cancelled) setPhase({ kind: "load-error", message: e instanceof Error ? e.message : String(e) })
      }
    })()
    return () => { cancelled = true }
  }, [userName, hooksReady, hooks.setup_wizard_slides])

  useEffect(() => runCleanup, [runCleanup])

  const slides = useMemo<SetupWizardSlide[]>(
    () => (status && user ? buildSlides({ status, user, appSlides: hooks.setup_wizard_slides }) : []),
    [status, user, hooks.setup_wizard_slides],
  )
  const hasOrgSlide = slides.some((s) => s.name === BUILTIN_SLIDES.organization)

  // Chart of Accounts options depend on country (ERPNext only).
  const country = String(values.country ?? "")
  useEffect(() => {
    if (!hasOrgSlide) return
    const client = getFrappeClient()
    let cancelled = false
    // When frappe was already set up the region slide is skipped; ERPNext then
    // uses System Settings' country server-side, so charts fall back to standard ones.
    const args = country ? { country, with_standard: 1 } : null
    if (!args) { setCharts(["Standard", "Standard with Numbers"]); return }
    void client
      .callMethod<string[]>(SETUP_METHODS.charts, args, { cache: true })
      .then((list) => {
        if (cancelled) return
        const opts = Array.isArray(list) && list.length ? list : ["Standard"]
        setCharts(opts)
        setValues((v) => (opts.includes(String(v.chart_of_accounts)) ? v : { ...v, chart_of_accounts: opts[0] }))
      })
      .catch(() => { if (!cancelled) setCharts(["Standard"]) })
    return () => { cancelled = true }
  }, [country, hasOrgSlide])

  // ── Field changes with Desk's linked behaviour ─────────────────────────────
  const setField = useCallback((fieldname: string, value: unknown) => {
    setError(null)
    setValues((prev) => {
      const next: Values = { ...prev, [fieldname]: value }
      if (fieldname === "country" && regional) {
        const info = regional.country_info[String(value)]
        if (info) {
          if (info.currency) next.currency = info.currency
          const tz = info.timezones ?? []
          if (tz.length && !tz.includes(String(prev.timezone))) next.timezone = tz[0]
        }
        const fy = fiscalYearFor(String(value) || undefined)
        next.fy_start_date = fy.start
        next.fy_end_date = fy.end
      }
      if (fieldname === "company_name" && !abbrTouched.current) next.company_abbr = companyAbbr(String(value))
      if (fieldname === "company_abbr") abbrTouched.current = true
      if (fieldname === "fy_start_date" && /^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
        next.fy_end_date = fiscalYearEnd(String(value))
      }
      return next
    })
  }, [regional])

  function optionsFor(field: SetupWizardField): string[] {
    switch (field.fieldname) {
      case "language": return languages
      case "country": return regional ? Object.keys(regional.country_info).sort() : []
      case "timezone": {
        if (!regional) return []
        const own = regional.country_info[country]?.timezones ?? []
        return [...own, ...regional.all_timezones.filter((t) => !own.includes(t))]
      }
      case "currency": {
        if (!regional) return []
        const set = new Set(Object.values(regional.country_info).map((c) => c.currency).filter(Boolean) as string[])
        return [...set].sort()
      }
      case "chart_of_accounts": return charts
      default: return selectOptions(field)
    }
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  async function finish() {
    runCleanup()
    setError(null)
    setPhase({ kind: "running", stage: "Starting setup" })
    const client = getFrappeClient()
    let settled = false

    const succeed = () => {
      if (settled) return
      settled = true
      runCleanup()
      setPhase({ kind: "done" })
      // Frappe logs the browser in as the new first user (login_as_first_user),
      // so drop the cached session and reload into the desk.
      try { sessionStorage.removeItem("petal-store") } catch {}
      setTimeout(() => window.location.assign("/"), 1200)
    }
    const fail = (message: string) => {
      if (settled) return
      settled = true
      runCleanup()
      setPhase({ kind: "slides" })
      setError(message)
    }

    // Subscribe before calling so no progress event is missed.
    const rt = await getRealtimeClient()
    if (rt) {
      cleanup.current.push(rt.on<SetupTaskEvent>("setup_task", (e) => {
        if ("progress" in e) setPhase({ kind: "running", stage: e.stage_status, progress: e.progress })
        else if (e.status === "ok") succeed()
        else if (e.status === "fail") fail(e.fail_msg || "Setup failed. Check the Error Log on the server.")
      }))
    }

    try {
      const res = await client.callMethod<{ status?: string }>(SETUP_METHODS.complete, {
        args: buildSetupArgs(slides, values),
      })
      if (res?.status === "registered") {
        // Running in a background job: wait for realtime, and poll in case realtime is down.
        const timer = setInterval(() => {
          void fetchSetupStatus(client).then((st) => { if (st.complete) succeed() })
        }, POLL_MS)
        cleanup.current.push(() => clearInterval(timer))
        return
      }
      succeed()
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e))
    }
  }

  function next() {
    const slide = slides[step]
    if (!slide) return
    const msg = validateSlide(slide, values)
    if (msg) { setError(msg); return }
    setError(null)
    if (step < slides.length - 1) setStep(step + 1)
    else void finish()
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  if (phase.kind === "loading") {
    return <Centered><Spinner label="Preparing setup…" /></Centered>
  }

  if (phase.kind === "load-error") {
    return (
      <Centered>
        <Card>
          <h1 className="text-lg font-semibold text-foreground">Couldn&apos;t load the setup wizard</h1>
          <p className="mt-2 text-sm text-muted-foreground">{phase.message}</p>
          <Button className="mt-4" onClick={() => window.location.reload()}>Try again</Button>
        </Card>
      </Centered>
    )
  }

  if (phase.kind === "running" || phase.kind === "done") {
    const pct = phase.kind === "done" ? 100
      : phase.progress ? Math.round(((phase.progress[0] + 1) / Math.max(phase.progress[1], 1)) * 100) : 5
    return (
      <Centered>
        <Card>
          <h1 className="text-lg font-semibold text-foreground">
            {phase.kind === "done" ? "Setup complete" : "Setting up your system"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground" aria-live="polite">
            {phase.kind === "done" ? "Taking you to your desk…" : `${phase.stage ?? "Working"}…`}
          </p>
          <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
          </div>
          {phase.kind === "running" && (
            <p className="mt-3 text-xs text-muted-foreground">This can take a minute. Keep this tab open.</p>
          )}
        </Card>
      </Centered>
    )
  }

  if (slides.length === 0) {
    // Apps still pending but none of them asks for input: run setup_complete
    // with no answers so the server marks them done.
    const pending = status?.pendingApps ?? []
    return (
      <Centered>
        <Card>
          <h1 className="text-lg font-semibold text-foreground">{pending.length ? "Finish setup" : "Nothing to set up"}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {pending.length
              ? `${pending.join(", ")} still need${pending.length === 1 ? "s" : ""} to finish setting up. No details are needed.`
              : "Every installed app has finished its setup."}
          </p>
          {error && <p className="mt-2 text-sm text-destructive" role="alert">{error}</p>}
          {pending.length
            ? <Button className="mt-4" onClick={() => void finish()}>Finish setup</Button>
            : <Button className="mt-4" onClick={() => { usePetalStore.getState().setSetupState("complete") }}>Go to desk</Button>}
        </Card>
      </Centered>
    )
  }

  const slide = slides[Math.min(step, slides.length - 1)]!
  const isLast = step === slides.length - 1
  const readOnlyEmail = slide.name === BUILTIN_SLIDES.user && user?.name !== "Administrator"

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-primary/10 flex items-center justify-center p-4">
      <div className="w-full max-w-xl space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary rounded-xl flex items-center justify-center text-white font-black text-lg">P</div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Setup</p>
              <p className="text-sm text-foreground">Step {step + 1} of {slides.length}</p>
            </div>
          </div>
          <ol className="flex items-center gap-1.5" aria-label="Setup progress">
            {slides.map((s, i) => (
              <li
                key={s.name}
                aria-current={i === step ? "step" : undefined}
                className={cn("h-1.5 rounded-full transition-all", i === step ? "w-6 bg-primary" : i < step ? "w-3 bg-primary/60" : "w-3 bg-muted")}
              />
            ))}
          </ol>
        </div>

        <form
          className="rounded-2xl border border-border bg-background p-6 shadow-sm space-y-5"
          onSubmit={(e) => { e.preventDefault(); next() }}
          noValidate
        >
          <div>
            <h1 className="text-xl font-semibold text-foreground">{slide.title}</h1>
            {slide.description && <p className="mt-1 text-sm text-muted-foreground">{slide.description}</p>}
          </div>

          {error && (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800/50 dark:bg-red-950/30 dark:text-red-300">
              {error}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {slide.fields.map((f) => (
              <WizardField
                key={f.fieldname}
                field={f}
                value={values[f.fieldname]}
                options={f.fieldtype === "Select" ? optionsFor(f) : []}
                readOnly={readOnlyEmail && f.fieldname === "email"}
                onChange={(v) => setField(f.fieldname, v)}
              />
            ))}
          </div>

          <div className="flex items-center justify-between pt-2">
            <Button type="button" variant="ghost" disabled={step === 0} onClick={() => { setError(null); setStep(step - 1) }}>
              Back
            </Button>
            <Button type="submit">{isLast ? "Complete Setup" : "Next"}</Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function WizardField({
  field, value, options, readOnly, onChange,
}: {
  field: SetupWizardField
  value: unknown
  options: string[]
  readOnly?: boolean
  onChange: (v: unknown) => void
}) {
  const id = `sw-${field.fieldname}`
  const wide = field.fieldtype === "Check" || field.fieldtype === "Small Text" || field.fieldname === "chart_of_accounts"

  if (field.fieldtype === "Check") {
    return (
      <div className="sm:col-span-2">
        <label htmlFor={id} className="flex items-start gap-2.5 text-sm text-foreground cursor-pointer">
          <input
            id={id}
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-border accent-[hsl(var(--primary))]"
            checked={Boolean(Number(value)) || value === true}
            onChange={(e) => onChange(e.target.checked ? 1 : 0)}
          />
          <span>
            {field.label}
            {field.description && <span className="block text-xs text-muted-foreground mt-0.5">{field.description}</span>}
          </span>
        </label>
      </div>
    )
  }

  const str = value === undefined || value === null ? "" : String(value)
  return (
    <div className={cn("space-y-1.5", wide && "sm:col-span-2")}>
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {field.label}
        {field.reqd && <span className="text-red-500 ml-0.5" aria-hidden>*</span>}
      </label>
      {field.fieldtype === "Select" ? (
        <select id={id} className={selectClass} value={str} required={field.reqd} onChange={(e) => onChange(e.target.value)}>
          {!str && <option value="">{field.placeholder ?? "Select…"}</option>}
          {str && !options.includes(str) && <option value={str}>{str}</option>}
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : field.fieldtype === "Small Text" ? (
        <textarea
          id={id}
          className={cn(selectClass, "h-20 py-2")}
          value={str}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <Input
          id={id}
          type={field.fieldtype === "Password" ? "password" : field.fieldtype === "Date" ? "date" : field.fieldtype === "Int" ? "number" : field.fieldname === "email" ? "email" : "text"}
          autoComplete={field.fieldtype === "Password" ? "new-password" : field.fieldname === "email" ? "email" : field.fieldname === "full_name" ? "name" : "off"}
          value={str}
          readOnly={readOnly}
          required={field.reqd}
          placeholder={field.placeholder}
          maxLength={field.fieldname === "company_abbr" ? 10 : undefined}
          className={readOnly ? "bg-muted text-muted-foreground" : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {field.description && <p className="text-xs text-muted-foreground">{field.description}</p>}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-background flex items-center justify-center p-4">{children}</div>
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="w-full max-w-md rounded-2xl border border-border bg-background p-6 shadow-sm">{children}</div>
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      {label}
    </div>
  )
}
