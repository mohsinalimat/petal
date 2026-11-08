// tsx/cjs registers a TypeScript loader so we can require .ts files below.
require("tsx/cjs")
const fs = require("fs")
const path = require("path")

const { withPetal } = require("./src/plugin")
const petalConfig = require("./petal.config").default

// Origins that are allowed to serve remote app bundles (petal.hooks.js) and their
// CSS. Computed once at server start from petal.config.ts + petal.apps.json (if
// present) and fed to middleware.ts as an env var, since CSP is enforced there.
// Adding an app via `petal app add` while the server is running takes effect for
// app loading immediately (petal.apps.json is hot-reloaded), but its origin isn't
// trusted by the CSP header until the next restart — fail closed, not open.
function computeAppOrigins() {
  const metas = [...(petalConfig.apps ?? [])]
  const appsJsonPath = path.join(__dirname, "petal.apps.json")
  if (fs.existsSync(appsJsonPath)) {
    try {
      const dynamicApps = JSON.parse(fs.readFileSync(appsJsonPath, "utf8"))
      if (Array.isArray(dynamicApps)) metas.push(...dynamicApps)
    } catch {
      // ignored — runtime-config.ts already logs and falls back for the app registry itself
    }
  }
  const origins = new Set()
  for (const meta of metas) {
    for (const url of [meta.url, meta.devUrl]) {
      if (!url) continue
      try {
        origins.add(new URL(url).origin)
      } catch {
        // ignored — invalid URLs are rejected by app-registry.ts at load time
      }
    }
  }
  return [...origins].join(" ")
}

// Frappe's realtime (socket.io) server. Defaults to the backend host on :9000,
// which is how `bench start` runs it. The browser reaches it through the
// same-origin /socket.io rewrite below so the session cookie is sent along.
function socketioUrl() {
  if (process.env.FRAPPE_SOCKETIO_URL) return process.env.FRAPPE_SOCKETIO_URL.replace(/\/$/, "")
  const u = new URL(process.env.FRAPPE_BACKEND_URL || "http://localhost:8000")
  u.port = "9000"
  return u.origin
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@petal/sdk", "@petal/ui"],
  output: "standalone",
  env: {
    PETAL_APP_ORIGINS: computeAppOrigins(),
    NEXT_PUBLIC_PETAL_REALTIME: process.env.PETAL_REALTIME || "1",
  },
  async rewrites() {
    if (process.env.PETAL_REALTIME === "0") return []
    const target = `${socketioUrl()}/socket.io`
    return [
      // socket.io always requests "/socket.io/?EIO=…" — keep the trailing slash intact
      { source: "/socket.io/", destination: `${target}/` },
      { source: "/socket.io/:path+", destination: `${target}/:path+` },
    ]
  },
  // Next's default 308 from "/socket.io/" → "/socket.io" would break the polling transport
  skipTrailingSlashRedirect: true,
  webpack: (config) => {
    config.watchOptions = {
      poll: 1000,
      aggregateTimeout: 300,
    }
    return config
  },
}

module.exports = withPetal(petalConfig)(nextConfig)
