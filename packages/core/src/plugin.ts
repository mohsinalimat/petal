import fs from "fs"
import path from "path"
import type { PetalConfig } from "@petal/sdk"
import type { NextConfig } from "next"

export function withPetal(petalConfig: PetalConfig) {
  const dir = path.join(process.cwd(), ".petal")
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  // Write only the static config from petal.config.ts.
  // petal.apps.json (CLI-managed) is read at request time by runtime-config.ts — no restart needed.
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      apps: petalConfig.apps ?? [],
      ...(petalConfig.pathMap ? { pathMap: petalConfig.pathMap } : {}),
    }),
  )

  const backendUrl = process.env.FRAPPE_BACKEND_URL || "http://localhost:8000"

  return (nextConfig: NextConfig = {}): NextConfig => ({
    ...nextConfig,
    env: {
      ...nextConfig.env,
      // FRAPPE_BACKEND_URL is deliberately NOT listed here: anything in `env` is
      // inlined at build time, which would freeze the backend URL into Docker
      // images. Server code reads it from process.env at runtime instead.
      // NEXT_PUBLIC_ alias lets client components show the URL (display only).
      NEXT_PUBLIC_FRAPPE_BACKEND_URL: backendUrl,
    },
  })
}
