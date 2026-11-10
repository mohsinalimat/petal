"use client"
import { useState } from "react"
import { cn } from "../lib/utils"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackendApp {
  name: string
  title?: string
  description?: string
  version?: string
  moduleCount: number
}

export interface FrontendApp {
  name: string
  url: string
  devUrl?: string
  version: string
  loaded: boolean
  error?: string
}

export interface InstalledAppsProps {
  backendApps: BackendApp[]
  frontendApps: FrontendApp[]
  backendLoading?: boolean
  frontendLoading?: boolean
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const KNOWN_TITLES: Record<string, string> = {
  petal: "Petal",
  frappe: "Frappe Framework",
  erpnext: "ERPNext",
  hrms: "Frappe HRMS",
  crm: "Frappe CRM",
  lms: "Frappe LMS",
  wiki: "Frappe Wiki",
  print_designer: "Print Designer",
  helpdesk: "Frappe Helpdesk",
  insights: "Frappe Insights",
  gameplan: "Gameplan",
  drive: "Frappe Drive",
  builder: "Frappe Builder",
  india_compliance: "India Compliance",
  payments: "Payments",
  webshop: "Webshop",
}

function formatAppName(name: string): string {
  return KNOWN_TITLES[name] ?? name.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
}

const PALETTE = [
  "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  "bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300",
  "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300",
  "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-900/40 dark:text-fuchsia-300",
  "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300",
]

function avatarColor(name: string): string {
  const hash = name.split("").reduce((a, c) => a + c.charCodeAt(0), 0)
  return PALETTE[hash % PALETTE.length] ?? PALETTE[0]!
}

// ---------------------------------------------------------------------------
// Icons (inline SVG, no external dep)
// ---------------------------------------------------------------------------

function ServerIcon({ className }: { className?: string }) {
  return (
    <svg className={cn("h-4 w-4", className)} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <rect x="2" y="2" width="20" height="8" rx="2" />
      <rect x="2" y="14" width="20" height="8" rx="2" />
      <line x1="6" y1="6" x2="6.01" y2="6" strokeLinecap="round" />
      <line x1="6" y1="18" x2="6.01" y2="18" strokeLinecap="round" />
    </svg>
  )
}

function LayersIcon({ className }: { className?: string }) {
  return (
    <svg className={cn("h-4 w-4", className)} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

function CardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <div className="h-10 w-10 shrink-0 animate-pulse rounded-xl bg-muted" />
        <div className="flex-1 space-y-2">
          <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
          <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <div className="h-5 w-16 animate-pulse rounded-full bg-muted" />
        <div className="h-5 w-20 animate-pulse rounded-full bg-muted" />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// AppAvatar
// ---------------------------------------------------------------------------

function AppAvatar({ name }: { name: string }) {
  return (
    <span
      className={cn(
        "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg font-bold",
        avatarColor(name),
      )}
    >
      {name[0]?.toUpperCase()}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Backend app card
// ---------------------------------------------------------------------------

function BackendAppCard({ app }: { app: BackendApp }) {
  const title = app.title ?? formatAppName(app.name)

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-5 transition-shadow hover:shadow-md">
      <div className="flex items-start gap-3">
        <AppAvatar name={app.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">{title}</p>
          <p className="font-mono text-[11px] text-muted-foreground">{app.name}</p>
        </div>
        <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
          Active
        </span>
      </div>

      {app.description && (
        <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {app.description}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <span className="flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" />
            <path strokeLinecap="round" d="M8 12h8M12 8v8" />
          </svg>
          Python / Frappe
        </span>

        {app.version && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
            v{app.version}
          </span>
        )}

        {app.moduleCount > 0 && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {app.moduleCount} module{app.moduleCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Frontend app card
// ---------------------------------------------------------------------------

function FrontendAppCard({ app }: { app: FrontendApp }) {
  const activeUrl = app.devUrl ?? app.url
  const isDev = !!app.devUrl

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-5 transition-shadow hover:shadow-md">
      <div className="flex items-start gap-3">
        <AppAvatar name={app.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-foreground">
            {formatAppName(app.name)}
          </p>
          <p className="font-mono text-[11px] text-muted-foreground">{app.name}</p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold",
            app.loaded
              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
          )}
        >
          {app.loaded ? "Loaded" : "Failed"}
        </span>
      </div>

      {app.error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 font-mono text-[11px] text-red-600 dark:bg-red-950/30 dark:text-red-400">
          {app.error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <span className="flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
          <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
            <polyline points="16 18 22 12 16 6" />
            <polyline points="8 6 2 12 8 18" />
          </svg>
          Next.js / ESM
        </span>

        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
          v{app.version}
        </span>

        {isDev && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            dev
          </span>
        )}

        <a
          href={activeUrl}
          target="_blank"
          rel="noopener noreferrer"
          title={activeUrl}
          className="max-w-[180px] truncate rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {activeUrl}
        </a>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="col-span-full flex flex-col items-center justify-center py-16 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        {icon}
      </div>
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground/60">{hint}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Summary bar
// ---------------------------------------------------------------------------

function SummaryBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
      <svg className="mt-0.5 h-4 w-4 shrink-0 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <circle cx="12" cy="12" r="10" />
        <path strokeLinecap="round" d="M12 16v-4M12 8h.01" />
      </svg>
      <span>{children}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// InstalledApps
// ---------------------------------------------------------------------------

type Tab = "backend" | "frontend"

export function InstalledApps({
  backendApps,
  frontendApps,
  backendLoading = false,
  frontendLoading = false,
}: InstalledAppsProps) {
  const [tab, setTab] = useState<Tab>("frontend")

  const failedFrontend = frontendApps.filter((a) => !a.loaded).length
  const totalModules = backendApps.reduce((n, a) => n + a.moduleCount, 0)

  return (
    <div>
      {/* Tab bar */}
      <div className="mb-6 flex items-center gap-1 rounded-lg border border-border bg-muted/50 p-1 w-fit">
        {(["frontend", "backend"] as Tab[]).map((t) => {
          const isActive = tab === t
          const count = t === "backend" ? backendApps.length : frontendApps.length
          const loading = t === "backend" ? backendLoading : frontendLoading

          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t === "backend" ? <ServerIcon /> : <LayersIcon />}
              <span>{t === "backend" ? "Backend" : "Frontend"}</span>
              {!loading && (
                <span
                  className={cn(
                    "flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[11px] font-bold",
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "bg-muted-foreground/20 text-muted-foreground",
                    // Red tint for failed frontend apps
                    t === "frontend" && failedFrontend > 0 && !isActive
                      ? "bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400"
                      : "",
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Frontend tab */}
      {tab === "frontend" && (
        <section>
          {!frontendLoading && frontendApps.length > 0 && (
            <SummaryBar>
              <strong className="text-foreground">{frontendApps.length}</strong> React app
              {frontendApps.length !== 1 ? "s" : ""} registered in{" "}
              <code className="rounded bg-muted px-1 font-mono text-[11px] text-foreground">petal.config.ts</code>.
              {failedFrontend > 0 && (
                <>
                  {" "}
                  <strong className="text-red-600 dark:text-red-400">{failedFrontend}</strong>{" "}
                  failed to load.
                </>
              )}
            </SummaryBar>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {frontendLoading
              ? Array.from({ length: 2 }).map((_, i) => <CardSkeleton key={i} />)
              : frontendApps.length === 0
              ? (
                <EmptyState
                  icon={<LayersIcon className="h-6 w-6" />}
                  title="No frontend apps registered"
                  hint="Add apps to petal.config.ts to see them here"
                />
              )
              : frontendApps.map((app) => <FrontendAppCard key={app.name} app={app} />)
            }
          </div>
        </section>
      )}

      {/* Backend tab */}
      {tab === "backend" && (
        <section>
          {!backendLoading && backendApps.length > 0 && (
            <SummaryBar>
              <strong className="text-foreground">{backendApps.length}</strong> Python app
              {backendApps.length !== 1 ? "s" : ""} installed on this Frappe site.
              {totalModules > 0 && (
                <>
                  {" "}Total{" "}
                  <strong className="text-foreground">{totalModules}</strong> module
                  {totalModules !== 1 ? "s" : ""} across all apps.
                </>
              )}
            </SummaryBar>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {backendLoading
              ? Array.from({ length: 4 }).map((_, i) => <CardSkeleton key={i} />)
              : backendApps.length === 0
              ? (
                <EmptyState
                  icon={<ServerIcon className="h-6 w-6" />}
                  title="No backend apps found"
                  hint="Make sure you have permission to read Module Def"
                />
              )
              : backendApps.map((app) => <BackendAppCard key={app.name} app={app} />)
            }
          </div>
        </section>
      )}
    </div>
  )
}
