import fs from "fs"
import path from "path"
import type { PetalConfig, PetalAppMeta } from "@petal/sdk"
import { parseAppsEnv } from "./env-config"
import { backendFor } from "./tenants"

export { appOrigins, parseAppsEnv } from "./env-config"

type StoredConfig = {
  apps: NonNullable<PetalConfig["apps"]>
  pathMap?: PetalConfig["pathMap"]
}

let _staticCached: StoredConfig | null = null

function loadStaticConfig(): StoredConfig {
  if (_staticCached) return _staticCached
  try {
    const raw = fs.readFileSync(path.join(process.cwd(), ".petal/config.json"), "utf8")
    _staticCached = JSON.parse(raw) as StoredConfig
    return _staticCached
  } catch {
    console.error("[Petal] .petal/config.json not found — did you call withPetal() in next.config.js?")
    return { apps: [] }
  }
}

// Read petal.apps.json fresh on every call — no cache — so CLI changes are picked up without restart.
function loadAppsJson(): PetalAppMeta[] | null {
  const appsJsonPath = path.join(process.cwd(), "petal.apps.json")
  if (!fs.existsSync(appsJsonPath)) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(appsJsonPath, "utf8"))
  } catch {
    console.error("[Petal] petal.apps.json contains invalid JSON — ignoring and falling back to petal.config.ts apps")
    return null
  }
  if (!Array.isArray(parsed)) {
    console.error("[Petal] petal.apps.json must be a JSON array — ignoring and falling back to petal.config.ts apps")
    return null
  }
  return parsed as PetalAppMeta[]
}

/** App list precedence: petal.apps.json (CLI-managed) → PETAL_APPS env → petal.config.ts. */
export function getRuntimeConfig(): PetalConfig {
  const { apps: staticApps, pathMap } = loadStaticConfig()
  const dynamicApps = loadAppsJson() ?? parseAppsEnv(process.env.PETAL_APPS)
  return {
    apps: dynamicApps ?? staticApps,
    ...(pathMap ? { pathMap } : {}),
  }
}

/**
 * Config for one request. In multi-tenant mode (PETAL_TENANTS set) the tenant's
 * apps and pathMap win; returns null for a hostname that isn't a known tenant.
 */
export function getRequestConfig(headers: { get(name: string): string | null }): (PetalConfig & { site: string }) | null {
  const backend = backendFor(headers, process.env)
  if (!backend) return null
  const base = getRuntimeConfig()
  const pathMap = { ...(base.pathMap ?? {}), ...(backend.pathMap ?? {}) }
  return {
    apps: backend.apps ?? base.apps ?? [],
    ...(Object.keys(pathMap).length ? { pathMap } : {}),
    site: backend.siteHost,
  }
}
