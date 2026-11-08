// Env-var parsing shared by route handlers and middleware. No `fs`, so it is
// safe to import from the edge runtime.

import type { PetalAppMeta } from "@petal/sdk"

/**
 * PETAL_APPS env var — a JSON array of PetalAppMeta. Lets container deployments
 * register apps without baking them into the image or mounting petal.apps.json.
 */
export function parseAppsEnv(raw: string | undefined): PetalAppMeta[] | null {
  if (!raw || !raw.trim()) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    if (Array.isArray(parsed)) return parsed as PetalAppMeta[]
    console.error("[Petal] PETAL_APPS must be a JSON array — ignoring")
  } catch {
    console.error("[Petal] PETAL_APPS contains invalid JSON — ignoring")
  }
  return null
}

/** Origins (scheme://host:port) of every app bundle URL — used for the CSP script-src. */
export function appOrigins(apps: Array<Pick<PetalAppMeta, "url" | "devUrl">>): string[] {
  const origins = new Set<string>()
  for (const app of apps) {
    for (const url of [app.url, app.devUrl]) {
      if (!url) continue
      try { origins.add(new URL(url).origin) } catch { /* invalid URLs are rejected at load time */ }
    }
  }
  return [...origins]
}
