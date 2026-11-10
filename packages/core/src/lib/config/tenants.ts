// Multi-tenancy: map request hostnames to their own Frappe backend and apps.
//
// Pure (no `fs`) so it can run in proxy.ts as well as in
// route handlers. Enabled only when PETAL_TENANTS is set; otherwise Petal runs
// single-tenant from FRAPPE_BACKEND_URL / petal.config.ts / PETAL_APPS.

import type { PetalAppMeta } from "@petal/sdk"

export type TenantConfig = {
  /** Display name for logs. */
  name?: string
  /** Internal URL of this tenant's Frappe backend — server-side only. */
  frappeUrl: string
  /** Frappe site name for Host-header routing. Defaults to frappeUrl's hostname. */
  frappeSite?: string
  apps: PetalAppMeta[]
  pathMap?: Record<string, string>
}

export type TenantMap = Record<string, TenantConfig>

let cache: { raw: string; map: TenantMap | null } | null = null

/**
 * Parse PETAL_TENANTS (a JSON object keyed by hostname). Invalid tenants are
 * skipped with a logged error so one typo can't take every tenant down.
 * Returns null when unset/empty (single-tenant mode).
 */
export function parseTenants(raw: string | undefined): TenantMap | null {
  if (!raw || !raw.trim()) return null
  if (cache?.raw === raw) return cache.map
  let map: TenantMap | null = null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      console.error("[Petal] PETAL_TENANTS must be a JSON object keyed by hostname — multi-tenancy disabled")
    } else {
      map = {}
      for (const [host, cfg] of Object.entries(parsed as Record<string, unknown>)) {
        const problem = validateTenant(cfg)
        if (problem) {
          console.error(`[Petal] PETAL_TENANTS["${host}"] ignored: ${problem}`)
          continue
        }
        map[normalizeHost(host)] = cfg as TenantConfig
      }
    }
  } catch {
    console.error("[Petal] PETAL_TENANTS contains invalid JSON — multi-tenancy disabled")
  }
  cache = { raw, map }
  return map
}

function validateTenant(cfg: unknown): string | null {
  if (!cfg || typeof cfg !== "object") return "must be an object"
  const c = cfg as Partial<TenantConfig>
  if (typeof c.frappeUrl !== "string") return "frappeUrl is required"
  try { new URL(c.frappeUrl) } catch { return `frappeUrl "${c.frappeUrl}" is not a valid URL` }
  if (!Array.isArray(c.apps)) return "apps must be an array"
  return null
}

export function normalizeHost(host: string): string {
  return host.trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "")
}

/** Hostname the browser used. Honours X-Forwarded-Host from a reverse proxy (first value). */
export function requestHost(headers: { get(name: string): string | null }): string {
  const fwd = headers.get("x-forwarded-host")?.split(",")[0]
  return normalizeHost(fwd || headers.get("host") || "")
}

/** Exact hostname match first, then a wildcard key like "*.example.com". */
export function resolveTenant(map: TenantMap, host: string): TenantConfig | null {
  const h = normalizeHost(host)
  if (map[h]) return map[h]!
  const dot = h.indexOf(".")
  if (dot > 0) {
    const wild = map[`*${h.slice(dot)}`]
    if (wild) return wild
  }
  return null
}

export type Backend = { frappeUrl: string; siteHost: string; apps: PetalAppMeta[] | null; pathMap?: Record<string, string> }

/**
 * The backend serving this request: the tenant's when multi-tenancy is on
 * (null for an unknown host), otherwise the single-tenant default.
 */
export function backendFor(
  headers: { get(name: string): string | null },
  /** Usually process.env — reads PETAL_TENANTS, FRAPPE_BACKEND_URL, FRAPPE_SITE_NAME. */
  env: Record<string, string | undefined>,
): Backend | null {
  const tenants = parseTenants(env.PETAL_TENANTS)
  if (tenants) {
    const t = resolveTenant(tenants, requestHost(headers))
    if (!t) return null
    return {
      frappeUrl: t.frappeUrl.replace(/\/$/, ""),
      siteHost: t.frappeSite || new URL(t.frappeUrl).hostname,
      apps: t.apps,
      ...(t.pathMap ? { pathMap: t.pathMap } : {}),
    }
  }
  const url = (env.FRAPPE_BACKEND_URL || "http://localhost:8000").replace(/\/$/, "")
  return { frappeUrl: url, siteHost: env.FRAPPE_SITE_NAME || new URL(url).hostname, apps: null }
}
