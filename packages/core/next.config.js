// tsx/cjs registers a TypeScript loader so we can require .ts files below.
require("tsx/cjs")
const fs = require("fs")
const path = require("path")

const { withPetal } = require("./src/plugin")
// petal.config.ts is per-install (gitignored); a fresh clone, CI or Docker build
// has none, so fall back to no apps (PETAL_APPS / petal.apps.json still apply).
const petalConfig = fs.existsSync(path.join(__dirname, "petal.config.ts"))
  ? require("./petal.config").default
  : { apps: [] }

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
  // Lets a production build/start run beside `petal dev` without clobbering its .next
  ...(process.env.PETAL_DIST_DIR ? { distDir: process.env.PETAL_DIST_DIR } : {}),
  // Petal is open source, so shipping maps exposes nothing; they make prod
  // stack traces readable (and satisfy Lighthouse). PETAL_SOURCE_MAPS=0 opts out.
  productionBrowserSourceMaps: process.env.PETAL_SOURCE_MAPS !== "0",
  env: {
    PETAL_APP_ORIGINS: computeAppOrigins(),
    NEXT_PUBLIC_PETAL_REALTIME: process.env.PETAL_REALTIME || "1",
  },
  async rewrites() {
    // Frappe stores attachments as "/files/x.png" / "/private/files/x.png" and
    // fields render them as-is; send them through the API proxy (which picks
    // the tenant's backend) instead of falling into the [...slug] page.
    const beforeFiles = [
      { source: "/files/:path+", destination: "/api/v1/files/:path+" },
      { source: "/private/files/:path+", destination: "/api/v1/private/files/:path+" },
    ]
    if (process.env.PETAL_REALTIME === "0") return { beforeFiles }
    const target = `${socketioUrl()}/socket.io`
    return {
      beforeFiles,
      afterFiles: [
        // socket.io always requests "/socket.io/?EIO=…" — keep the trailing slash intact
        { source: "/socket.io/", destination: `${target}/` },
        { source: "/socket.io/:path+", destination: `${target}/:path+` },
      ],
    }
  },
  // Next's default 308 from "/socket.io/" → "/socket.io" would break the polling transport
  skipTrailingSlashRedirect: true,
  // Only modules each page actually uses are bundled from these barrels
  // (@petal/ui re-exports recharts-based charts that most pages never render).
  experimental: {
    optimizePackageImports: ["@petal/ui", "lucide-react"],
  },
  webpack: (config, { dev }) => {
    // Polling burns a full CPU core and triggers spurious recompiles; it's only
    // needed when native file events don't work (e.g. Docker bind mounts).
    if (dev && process.env.PETAL_WATCH_POLL === "1") {
      config.watchOptions = { poll: 1000, aggregateTimeout: 300 }
    }
    return config
  },
}

module.exports = withPetal(petalConfig)(nextConfig)
