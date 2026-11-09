"use client"
import { useEffect, useRef, useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { usePathname, useRouter } from "next/navigation"
import { appRegistry } from "@/lib/registry/app-registry"
import { registerBuiltinIcons } from "@/lib/icons/builtin-icons"
import { getFrappeClient } from "@/hooks/useFrappe"
import { usePetalStore } from "@/store/petal-store"
import { toast, humanizeError } from "@/store/toast-store"
import type { FrappeDocument } from "@petal/sdk"
import { fetchFrappeSidebarItems } from "@/lib/sidebar/frappe-sidebar"
import { Sidebar } from "@/components/shell/Sidebar"
import { Navbar } from "@/components/shell/Navbar"
import { Toaster } from "@/components/shell/Toaster"
import { ErrorBoundary } from "@/components/shell/ErrorBoundary"
import { CompatHost } from "@/components/compat/CompatHost"
import { fetchSetupStatus, isSystemManager } from "@/lib/setup/setup-wizard"

const SETUP_PATH = "/setup-wizard"

export function PetalProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
  }))
  const { setUser, setAuthStatus, setHooks, setSidebarItems, setAppTheme, setSettings } = usePetalStore()
  const { authStatus, user } = usePetalStore()
  const setupState = usePetalStore((s) => s.setupState)
  const setSetupState = usePetalStore((s) => s.setSetupState)
  const pathname = usePathname()
  const router = useRouter()
  const bootDoneRef = useRef(false)


  // Boot runs independent tracks in parallel so the shell paints as soon as
  // the session is known:
  //   1. /api/config + apps    → on_init, client config (overrides.frappeClient), theme
  //   2. auth check            → authStatus (gates the shell). A session restored
  //      from storage needs no request, so the shell paints immediately.
  //   3. Frappe sidebar        → plain fetch (not FrappeClient), starts right after auth
  // Every FrappeClient request — boot, settings, and page data alike — is held by
  // client.waitFor() until track 1 has applied the apps' client config.
  const [appsLoaded, setAppsLoaded] = useState(false)
  const [frappeSidebar, setFrappeSidebar] = useState<import("@petal/sdk").SidebarItem[] | null>(null)

  useEffect(() => {
    registerBuiltinIcons()
    const client = getFrappeClient()

    const appsReady = (async () => {
      try {
        const config: import("@petal/sdk").PetalConfig = await fetch("/api/config").then((r) => r.json())
        await appRegistry.loadFromConfig(config)
        client.applyConfig(appRegistry.getMergedFrappeClientConfig())
        setAppTheme(appRegistry.getMergedTheme())
        setSettings({ ...appRegistry.getMergedSettings(), ...usePetalStore.getState().settings })
      } catch (e) {
        console.error("[Petal] Could not load app config:", e)
      } finally {
        setAppsLoaded(true)
      }
    })()
    client.waitFor(appsReady)

    void (async () => {
      try {
        if (user) {
          setAuthStatus("authenticated")
        } else {
          const freshUser = await client.getLoggedInUser()
          setUser(freshUser)
          setAuthStatus("authenticated")
        }
        void client.initCSRF()
      } catch {
        setAuthStatus("unauthenticated")
      }
    })()

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setUser, setAuthStatus, setAppTheme, setSettings])

  // First-run setup: once per session, ask Frappe whether the setup wizard has
  // run (same rule as frappe.is_setup_complete). Only System Managers can run it.
  useEffect(() => {
    if (authStatus !== "authenticated" || setupState !== "unknown") return
    let cancelled = false
    void fetchSetupStatus(getFrappeClient()).then((status) => {
      if (cancelled) return
      const currentUser = usePetalStore.getState().user
      // Only send users to the wizard when it has something to run: with no
      // pending app (odd Installed Applications data) it would be a dead end.
      const needsWizard = !status.complete && status.pendingApps.length > 0
      setSetupState(needsWizard && isSystemManager(currentUser) ? "pending" : "complete")
    })
    return () => { cancelled = true }
  }, [authStatus, setupState, setSetupState])

  useEffect(() => {
    if (authStatus !== "authenticated") return
    if (setupState === "pending" && pathname !== SETUP_PATH) router.replace(SETUP_PATH)
    else if (setupState === "complete" && pathname === SETUP_PATH) router.replace("/")
  }, [authStatus, setupState, pathname, router])

  // Sidebar uses plain fetch (no FrappeClient overrides), so it can start right after auth.
  useEffect(() => {
    if (authStatus !== "authenticated") return
    void fetchFrappeSidebarItems().then(setFrappeSidebar)
  }, [authStatus])

  // Settings go through FrappeClient (held by client.waitFor until app config is applied).
  useEffect(() => {
    if (authStatus !== "authenticated") return
    const client = getFrappeClient()
    void Promise.all([
      client.getDoc<FrappeDocument & { currency?: string }>("System Settings", "System Settings").catch(() => null),
      client.getDoc<FrappeDocument & { default_company?: string }>("Global Defaults", "Global Defaults").catch(() => null),
      client.getList<FrappeDocument & { name: string }>({
        doctype: "Fiscal Year",
        fields: ["name"],
        order_by: "year_start_date desc",
        limit: 1,
      }).catch(() => [] as (FrappeDocument & { name: string })[]),
    ]).then(([sysSettings, globalDefaults, years]) => {
      const merged: Record<string, unknown> = { ...usePetalStore.getState().settings }
      if (sysSettings?.currency) merged.currency = sysSettings.currency
      if (globalDefaults?.default_company) merged.defaultCompany = globalDefaults.default_company
      if (years.length > 0 && years[0]) merged.defaultFiscalYear = years[0].name
      setSettings(merged)
    })
  }, [authStatus, setSettings])

  // App on_boot hooks need both a session and loaded apps.
  useEffect(() => {
    if (authStatus !== "authenticated" || !appsLoaded) return
    if (bootDoneRef.current) return
    bootDoneRef.current = true
    void (async () => {
      try {
        await appRegistry.runBootHooks()
      } catch (e) {
        console.error("[Petal] Boot hook failed:", e)
      }
      setHooks(appRegistry.getMergedHooks())
    })()
  }, [authStatus, appsLoaded, setHooks])

  // Sidebar = Frappe workspaces + app items, re-merged whenever either arrives.
  const hooks = usePetalStore((s) => s.hooks)
  useEffect(() => {
    if (!frappeSidebar) return
    type SI = import("@petal/sdk").SidebarItem
    const overrides = hooks.sidebar_item_overrides ?? {}
    function applyOverrides(items: SI[]): SI[] {
      return items.map((item) => {
        const ov = overrides[item.label] ?? overrides[item.path]
        const patched: SI = ov ? { ...item, ...ov } : item
        if (patched.children?.length) return { ...patched, children: applyOverrides(patched.children) }
        return patched
      })
    }
    setSidebarItems(
      applyOverrides([...frappeSidebar, ...(hooks.sidebar_items ?? [])]).filter((item) => !item.hidden),
    )
  }, [frappeSidebar, hooks, setSidebarItems])

  useEffect(() => {
    if (authStatus === "unauthenticated" && pathname !== "/login" && pathname !== "/petal-docs") {
      router.replace("/login")
    }
  }, [authStatus, pathname, router])

  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return
    const es = new EventSource("/api/__petal_hmr")
    es.addEventListener("reload", () => {
      console.info("[Petal] App bundle changed — reloading modules…")
      window.location.reload()
    })
    return () => es.close()
  }, [])

  useEffect(() => {
    function onUnhandledRejection(e: PromiseRejectionEvent) {
      // Prevent Next.js / React dev overlay from also showing this error
      e.preventDefault()
      const { title, detail } = humanizeError(e.reason)
      toast.error(title, detail)
    }

    function onError(e: ErrorEvent) {
      // Skip opaque cross-origin script errors (no useful info available)
      if (!e.message || e.message === "Script error.") return
      e.preventDefault()
      const { title, detail } = humanizeError(e.error ?? e.message)
      toast.error(title, detail)
    }

    // Use capture phase so our handler runs before React/Next.js dev overlay handlers
    window.addEventListener("unhandledrejection", onUnhandledRejection, true)
    window.addEventListener("error", onError, true)
    return () => {
      window.removeEventListener("unhandledrejection", onUnhandledRejection, true)
      window.removeEventListener("error", onError, true)
    }
  }, [])

  if (pathname === "/login" || pathname === "/docs/print" || pathname === "/petal-docs") {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
        <Toaster />
      </QueryClientProvider>
    )
  }

  // Hold the shell until we know whether first-run setup is needed, so the desk
  // never flashes before a redirect to the wizard.
  const setupBlocking = authStatus === "authenticated" && setupState !== "complete"

  if (pathname === SETUP_PATH && authStatus === "authenticated" && setupState === "pending") {
    return (
      <QueryClientProvider client={queryClient}>
        {children}
        <Toaster />
      </QueryClientProvider>
    )
  }

  if (authStatus === "loading" || setupBlocking) {
    return (
      <QueryClientProvider client={queryClient}>
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="flex flex-col items-center gap-4">
            <div className="w-12 h-12 bg-primary rounded-xl flex items-center justify-center text-white font-bold text-xl">
              P
            </div>
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              Starting Petal...
            </div>
          </div>
        </div>
      </QueryClientProvider>
    )
  }

  const failedApps = appRegistry.getFailedApps()

  return (
    <QueryClientProvider client={queryClient}>
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex flex-col flex-1 overflow-hidden">
        <Navbar />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          {failedApps.size > 0 && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm dark:border-red-800/50 dark:bg-red-950/30">
              <div className="flex items-start gap-3">
                <svg className="mt-0.5 h-4 w-4 shrink-0 text-red-500 dark:text-red-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <div>
                  <p className="font-semibold text-red-800 dark:text-red-300 mb-1">
                    Failed to load {failedApps.size} app{failedApps.size > 1 ? "s" : ""}
                  </p>
                  <ul className="space-y-0.5 text-red-700 dark:text-red-400">
                    {Array.from(failedApps.entries()).map(([name, err]) => (
                      <li key={name}>
                        <span className="font-mono font-medium">{name}</span>
                        <span className="text-red-500 dark:text-red-500 mx-1">—</span>
                        {err}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}
          <ErrorBoundary resetKey={pathname}>
            {children}
          </ErrorBoundary>
        </main>
      </div>
      {/* Toaster sits outside ErrorBoundary so it always renders even when a page crashes */}
      <Toaster />
      {hooks.frappe_compat?.enabled && <CompatHost />}
    </div>
    </QueryClientProvider>
  )
}
