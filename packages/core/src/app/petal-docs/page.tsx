"use client"

import { useState, useEffect } from "react"

// ─────────────────────────────────────────────────────────────────────────────
// Primitives
// ─────────────────────────────────────────────────────────────────────────────

function CodeBlock({ code, label }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(code.trim())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <div className="rounded-xl overflow-hidden border border-zinc-700/60">
      {label && (
        <div className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-zinc-700/60">
          <span className="text-xs text-zinc-400 font-mono">{label}</span>
          <button onClick={copy} className="text-xs text-zinc-400 hover:text-white transition-colors">
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>
      )}
      <div className="relative group">
        {!label && (
          <button
            onClick={copy}
            className="absolute top-3 right-3 text-xs text-zinc-400 hover:text-white px-2 py-1 bg-white/10 rounded opacity-0 group-hover:opacity-100 transition-opacity z-10"
          >
            {copied ? "✓ Copied" : "Copy"}
          </button>
        )}
        <pre className="bg-zinc-950 text-zinc-100 p-4 text-xs overflow-x-auto font-mono leading-relaxed">
          <code>{code.trim()}</code>
        </pre>
      </div>
    </div>
  )
}

type PropRow = { name: string; type: string; required?: boolean; default?: string; desc: string }

function PropTable({ rows }: { rows: PropRow[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50 border-b border-border text-left">
            <th className="px-4 py-3 font-semibold text-foreground whitespace-nowrap">Prop</th>
            <th className="px-4 py-3 font-semibold text-foreground whitespace-nowrap">Type</th>
            <th className="px-4 py-3 font-semibold text-foreground whitespace-nowrap">Default</th>
            <th className="px-4 py-3 font-semibold text-foreground">Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-b border-border last:border-0 hover:bg-muted/30">
              <td className="px-4 py-3 font-mono text-xs text-primary whitespace-nowrap">
                {r.name}
                {r.required && <span className="ml-1 text-red-500 font-sans font-bold">*</span>}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-amber-600 dark:text-amber-400">{r.type}</td>
              <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{r.default ?? "—"}</td>
              <td className="px-4 py-3 text-sm text-muted-foreground">{r.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Callout({ variant = "info", children }: { variant?: "info" | "warning" | "tip"; children: React.ReactNode }) {
  const styles = {
    info: "bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950/30 dark:border-blue-800/50 dark:text-blue-300",
    warning: "bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/30 dark:border-amber-800/50 dark:text-amber-300",
    tip: "bg-green-50 border-green-200 text-green-800 dark:bg-green-950/30 dark:border-green-800/50 dark:text-green-300",
  }
  const icons = { info: "ℹ", warning: "⚠", tip: "💡" }
  return (
    <div className={`flex gap-3 p-4 rounded-lg border text-sm ${styles[variant]}`}>
      <span className="shrink-0 text-base">{icons[variant]}</span>
      <div>{children}</div>
    </div>
  )
}

function Badge({ children, color = "default" }: { children: React.ReactNode; color?: "default" | "green" | "blue" | "violet" }) {
  const c = {
    default: "bg-muted text-muted-foreground",
    green: "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400",
    blue: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-400",
    violet: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-400",
  }
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${c[color]}`}>{children}</span>
}

function Mono({ children }: { children: React.ReactNode }) {
  return <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{children}</code>
}

// ─────────────────────────────────────────────────────────────────────────────
// TOC
// ─────────────────────────────────────────────────────────────────────────────

const SECTIONS = [
  { id: "overview",         label: "Overview" },
  { id: "host-setup",       label: "Host Setup" },
  { id: "installation",     label: "App Development" },
  { id: "deployment",       label: "Deployment" },
  { id: "multi-tenancy",    label: "Multi-Tenancy" },
  { id: "env-vars",         label: "Environment Variables" },
  { id: "custom-apps",      label: "Custom Apps" },
  { id: "hooks-reference",  label: "PetalHooks" },
  { id: "config-reference", label: "PetalConfig" },
  { id: "frappe-client",    label: "Frappe Client" },
  { id: "sidebar-items",    label: "SidebarItem" },
  { id: "icon-registry",    label: "Icon Registry" },
  { id: "cli",              label: "CLI" },
]

// ─────────────────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [active, setActive] = useState("overview")

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(e.target.id)
        }
      },
      { rootMargin: "-15% 0px -75% 0px" },
    )
    SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id)
      if (el) obs.observe(el)
    })
    return () => obs.disconnect()
  }, [])

  return (
    <div className="max-w-6xl mx-auto">

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div id="overview" className="scroll-mt-6 mb-12">
        <div className="flex flex-col sm:flex-row items-start gap-6 mb-8">
          <div className="shrink-0 p-3 rounded-2xl bg-primary/10 border border-primary/20">
            <svg viewBox="0 0 48 48" className="h-14 w-14 text-primary" fill="currentColor">
              <ellipse cx="24" cy="13" rx="6"   ry="10"  opacity="0.9"/>
              <ellipse cx="35" cy="24" rx="10"  ry="6"   opacity="0.9"/>
              <ellipse cx="24" cy="35" rx="6"   ry="10"  opacity="0.9"/>
              <ellipse cx="13" cy="24" rx="10"  ry="6"   opacity="0.9"/>
              <ellipse cx="32.5" cy="15.5" rx="4.5" ry="7.5" transform="rotate(45 32.5 15.5)"   opacity="0.45"/>
              <ellipse cx="32.5" cy="32.5" rx="4.5" ry="7.5" transform="rotate(-45 32.5 32.5)"  opacity="0.45"/>
              <ellipse cx="15.5" cy="32.5" rx="4.5" ry="7.5" transform="rotate(45 15.5 32.5)"   opacity="0.45"/>
              <ellipse cx="15.5" cy="15.5" rx="4.5" ry="7.5" transform="rotate(-45 15.5 15.5)"  opacity="0.45"/>
              <circle cx="24" cy="24" r="6.5"/>
            </svg>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <h1 className="text-4xl font-bold text-foreground">Petal</h1>
              <Badge color="green">v1.0.0</Badge>
              <Badge color="violet">Frappe v15</Badge>
            </div>
            <p className="text-lg text-muted-foreground max-w-2xl">
              Build custom pages, forms, and sidebar items on top of your Petal instance. Apps are independent ESM modules — develop, deploy, and version them without touching the core.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
          <div>
            <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Get started</p>
            <CodeBlock code="git clone https://github.com/ujjwalkumar93/petal.git" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-2 font-medium uppercase tracking-wide">Configure & run</p>
            <CodeBlock code="pnpm install && petal setup && petal start" />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[
            { icon: "🧩", title: "Hook-Based Extension", desc: "Export a PetalHooks object to add routes, sidebar items, form overrides, and more." },
            { icon: "⚡", title: "Independent Deploys",  desc: "Build and publish your app as an ESM bundle — no Petal rebuild required." },
            { icon: "🔄", title: "Live Dev with HMR",    desc: "Point devUrl at your Vite dev server for instant hot-module replacement while developing." },
          ].map((f) => (
            <div key={f.title} className="border border-border rounded-xl p-5 bg-card">
              <div className="text-2xl mb-2">{f.icon}</div>
              <p className="font-semibold text-foreground mb-1">{f.title}</p>
              <p className="text-sm text-muted-foreground">{f.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── Two-column layout ────────────────────────────────────────────── */}
      <div className="flex gap-10">

        {/* TOC */}
        <aside className="hidden xl:block w-48 shrink-0">
          <nav className="sticky top-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 px-3">On this page</p>
            <ul className="space-y-0.5">
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className={`block text-sm py-1.5 px-3 rounded-md transition-colors ${
                      active === s.id
                        ? "text-primary font-semibold bg-primary/8"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    }`}
                  >
                    {s.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-16">

          {/* ── Host Setup ───────────────────────────────────────────────── */}
          <section id="host-setup" className="scroll-mt-6">
            <h2 className="text-2xl font-bold text-foreground mb-1">Host Setup</h2>
            <p className="text-muted-foreground mb-6">
              A Petal <em>host</em> is a Next.js application pre-wired with the Frappe proxy, authentication, and the dynamic app loader. Scaffold one with a single command — no manual Next.js configuration required.
            </p>

            <div className="mb-6">
              <Callout variant="info">
                <strong>Prerequisites:</strong> Node.js 18+, pnpm 9+ (or npm/bun), and a running Frappe v15 backend.
              </Callout>
            </div>

            <h3 className="font-semibold text-foreground mb-3">Step 1 · Clone and install</h3>
            <CodeBlock label="terminal" code={`git clone https://github.com/ujjwalkumar93/petal.git my-petal-host
cd my-petal-host
pnpm install
petal setup   # configure backend URL and apps
pnpm dev      # → http://localhost:3000`} />

            <h3 className="font-semibold text-foreground mt-8 mb-3">What gets generated</h3>
            <CodeBlock label="project layout" code={`my-petal-host/
├── petal.config.ts     # Primary config — apps (backend URL goes in .env.local)
├── .env.local          # Backend secrets (never committed)
├── next.config.js      # withPetal() plugin — reads petal.config.ts at build
├── src/
│   └── app/…           # Next.js App Router pages
├── tailwind.config.ts
└── package.json        # @petal/sdk, @petal/ui, next`} />

            <h3 className="font-semibold text-foreground mt-8 mb-3">petal.config.ts — primary configuration</h3>
            <p className="text-sm text-muted-foreground mb-3">
              This is the single source of truth for your host. <Mono>withPetal(config)</Mono> in <Mono>next.config.js</Mono> reads it at startup and writes app config to <Mono>.petal/config.json</Mono>, which the server reads on every request.
            </p>
            <CodeBlock label="petal.config.ts" code={`import type { PetalConfig } from "@petal/sdk"

const config: PetalConfig = {
  apps: [], // Custom apps to load at runtime
}

export default config`} />

            <h3 className="font-semibold text-foreground mt-8 mb-3">Registering a custom app</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Once a custom app is built and deployed to a CDN, register it with the CLI. Changes are picked up on the next request — no restart needed:
            </p>
            <CodeBlock label="terminal" code={`petal app add
#  App name:              hr-portal
#  Version:               2.1.0
#  Dev server URL:        http://localhost:5174/petal.hooks.js
#  Production bundle URL: https://cdn.mycompany.com/hr-portal/2.1.0/petal.hooks.js`} />
            <div className="mt-3">
              <Callout variant="tip">
                In development (<Mono>pnpm dev</Mono>), Petal loads from <Mono>devUrl</Mono> instead of <Mono>url</Mono>. Point it at your Vite dev server for instant HMR without deploying to a CDN.
              </Callout>
            </div>

            <h3 className="font-semibold text-foreground mt-8 mb-3">.env.local — secrets</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Backend secrets that should never be committed. Generated by <Mono>create-petal-app</Mono> from your answers.
            </p>
            <CodeBlock label=".env.local" code={`# Frappe backend (server-side only — proxied, never sent to the browser)
FRAPPE_BACKEND_URL=http://localhost:8000

# Public URL of this Petal instance
NEXT_PUBLIC_FRONTEND_URL=http://localhost:3000`} />
          </section>

          {/* ── App Development ───────────────────────────────────────────── */}
          <section id="installation" className="scroll-mt-6">
            <h2 className="text-2xl font-bold text-foreground mb-1">App Development</h2>
            <p className="text-muted-foreground mb-6">
              Your Petal host is already running — this guide covers setting up a local <em>custom app</em> development environment so you can build and test against your live Petal + Frappe instance.
            </p>

            <h3 className="font-semibold text-foreground mb-3">Step 1 · Scaffold a new app</h3>
            <CodeBlock label="terminal" code={`petal create my-app
cd my-app
pnpm install`} />

            <h3 className="font-semibold text-foreground mt-8 mb-3">Step 2 · Start the dev server</h3>
            <CodeBlock label="terminal" code={`pnpm dev
# Vite dev server starts at http://localhost:5174`} />

            <h3 className="font-semibold text-foreground mt-8 mb-3">Step 3 · Register your app</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Ask your Petal host administrator to run <Mono>petal app add</Mono> with your dev server URL. No restart needed — the next page load picks it up:
            </p>
            <CodeBlock label="terminal (run on the host)" code={`petal app add
#  App name:              my-app
#  Version:               1.0.0
#  Dev server URL:        http://localhost:5174/petal.hooks.js
#  Production bundle URL: https://cdn.example.com/my-app/1.0.0/petal.hooks.js`} />

            <div className="mt-3">
              <Callout variant="tip">
                When <Mono>NODE_ENV=development</Mono>, Petal loads from <Mono>devUrl</Mono> instead of <Mono>url</Mono>. Your changes appear instantly via Vite HMR — no redeploy needed.
              </Callout>
            </div>

            <h3 className="font-semibold text-foreground mt-8 mb-3">CORS — Frappe Site Config</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Your Frappe admin needs to allow requests from your local dev server. Add to <Mono>site_config.json</Mono>:
            </p>
            <CodeBlock label="site_config.json" code={`{
  "allow_cors": "http://localhost:5174",
  "cors_allow_credentials": true
}`} />
          </section>

          {/* ── Deployment ───────────────────────────────────────────────── */}
          <section id="deployment" className="scroll-mt-6">
            <h2 className="text-2xl font-bold text-foreground mb-1">Deployment</h2>
            <p className="text-muted-foreground mb-6">
              Two deployment paths: build and run the Next.js app yourself (full control), or use the pre-built Docker image (zero build step).
            </p>

            <h3 className="font-semibold text-foreground mb-3">Option A · Self-hosted (source build)</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Build the Next.js app from your scaffolded project and deploy to any Node.js host (Vercel, Railway, Render, bare server).
            </p>
            <CodeBlock label="terminal" code={`pnpm build    # reads petal.config.ts via withPetal()
pnpm start    # → http://localhost:3000`} />
            <div className="mt-3 mb-8">
              <Callout variant="info">
                <Mono>petal.config.ts</Mono> is processed at startup by <Mono>withPetal()</Mono>. Apps registered via <Mono>petal app add</Mono> (<Mono>petal.apps.json</Mono>) are read at request time — no restart or rebuild needed when they change.
              </Callout>
            </div>

            <h3 className="font-semibold text-foreground mb-3">Option B · Docker (pre-built image)</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Pull the official Petal image and configure via environment variables. Use <Mono>petal setup</Mono> to generate all required files interactively.
            </p>
            <CodeBlock label="terminal" code={`# Clone and install
git clone https://github.com/ujjwalkumar93/petal.git
cd petal && pnpm install

# Run the interactive setup
petal setup
# Prompts: backend URL, site name, brand color, port, optional app

# Start the container
docker compose up`} />

            <h3 className="font-semibold text-foreground mt-8 mb-3">Files generated by petal setup</h3>
            <CodeBlock label="generated files" code={`petal.config.ts     # apps (single source of truth)
.env.local          # FRAPPE_BACKEND_URL, NEXT_PUBLIC_FRONTEND_URL
docker-compose.yml  # pulls ghcr.io/petalframework/petal:latest`} />

            <h3 className="font-semibold text-foreground mt-8 mb-3">docker-compose.yml (generated)</h3>
            <CodeBlock label="docker-compose.yml" code={`services:
  petal:
    image: ghcr.io/petalframework/petal:latest
    ports:
      - "3000:3000"
    env_file:
      - .env.local
    restart: unless-stopped`} />

            <h3 className="font-semibold text-foreground mt-8 mb-3">Adding apps to a Docker deployment</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Your <Mono>.env.local</Mono> only needs the backend URL. Register apps with <Mono>petal app add</Mono> — they are read at request time, no image rebuild needed:
            </p>
            <CodeBlock label=".env.local (Docker)" code={`FRAPPE_BACKEND_URL=http://frappe:8000
NEXT_PUBLIC_FRONTEND_URL=https://petal.mycompany.com`} />
            <div className="mt-3">
              <Callout variant="tip">
                Run <Mono>petal app add</Mono> on the host to register new apps. Changes take effect on the next request — no container restart required.
              </Callout>
            </div>
          </section>

          {/* ── Multi-Tenancy ────────────────────────────────────────────── */}
          <section id="multi-tenancy" className="scroll-mt-6">
            <h2 className="text-2xl font-bold text-foreground mb-1">Multi-Tenancy <Badge color="blue">SaaS</Badge></h2>
            <p className="text-muted-foreground mb-6">
              A single Petal instance can serve multiple tenants. Each incoming hostname is mapped to its own Frappe backend, custom apps, and theme — with no shared state between tenants.
            </p>

            <Callout variant="info">
              Multi-tenancy is opt-in and backward-compatible. If <Mono>PETAL_TENANTS</Mono> is not set, Petal runs in single-tenant mode using <Mono>FRAPPE_BACKEND_URL</Mono> and <Mono>PETAL_APPS</Mono> as before.
            </Callout>

            <h3 className="font-semibold text-foreground mt-8 mb-3">How it works</h3>
            <p className="text-sm text-muted-foreground mb-4">
              When <Mono>PETAL_TENANTS</Mono> is set, every incoming request is resolved by hostname:
            </p>
            <div className="space-y-2 mb-6 text-sm text-muted-foreground">
              {[
                { arrow: "→", from: "/api/config", to: "returns tenant-specific apps" },
                { arrow: "→", from: "/api/v1/…",   to: "proxies to the tenant's Frappe backend" },
                { arrow: "→", from: "unknown host", to: "returns HTTP 404" },
              ].map((r) => (
                <div key={r.from} className="flex items-center gap-3 px-4 py-2.5 rounded-lg bg-muted/40 border border-border">
                  <Mono>{r.from}</Mono>
                  <span className="text-muted-foreground/60">{r.arrow}</span>
                  <span>{r.to}</span>
                </div>
              ))}
            </div>
            <p className="text-sm text-muted-foreground mb-6">
              Auth cookies are naturally scoped to each subdomain by the browser, so sessions are already isolated between tenants.
            </p>

            <h3 className="font-semibold text-foreground mb-3">TenantConfig</h3>
            <PropTable rows={[
              { name: "frappeUrl",  type: "string",           required: true, desc: "Internal URL of this tenant's Frappe backend. Used server-side by the proxy — never sent to the browser." },
              { name: "frappeSite", type: "string",                           desc: "Frappe virtual-host site name for Host header routing. Defaults to the hostname parsed from frappeUrl." },
              { name: "apps",       type: "PetalAppMeta[]",   required: true, desc: "Custom app bundles to load for this tenant. Same format as PetalConfig.apps." },
              { name: "name",       type: "string",                           desc: "Optional display name for logs and error messages." },
            ]} />

            <h3 className="font-semibold text-foreground mt-8 mb-3">Configure via PETAL_TENANTS</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Set <Mono>PETAL_TENANTS</Mono> in <Mono>.env.local</Mono> as a JSON object keyed by hostname. When this variable is present, the per-tenant backend and apps take precedence over all other env vars.
            </p>
            <CodeBlock label=".env.local" code={`PETAL_TENANTS={
  "acme.example.com": {
    "name": "Acme Corp",
    "frappeUrl": "http://acme-frappe:8000",
    "frappeSite": "acme.example.com",
    "apps": [
      {
        "name": "hr-portal",
        "version": "1.2.0",
        "url": "https://cdn.example.com/hr-portal/1.2.0/petal.hooks.js"
      }
    ]
  },
  "beta.example.com": {
    "name": "Beta Inc",
    "frappeUrl": "http://beta-frappe:8000",
    "frappeSite": "beta.example.com",
    "apps": [
      {
        "name": "inventory-app",
        "version": "0.9.0",
        "url": "https://cdn.example.com/inventory/0.9.0/petal.hooks.js"
      }
    ]
  }
}`} />

            <h3 className="font-semibold text-foreground mt-8 mb-3">Docker Compose — multi-tenant</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Run a single Petal container and route both subdomains to it (via a reverse proxy like Nginx or Caddy). Petal resolves the tenant from the <Mono>Host</Mono> header on each request.
            </p>
            <CodeBlock label="docker-compose.yml" code={`services:
  petal:
    image: ghcr.io/petalframework/petal:latest
    ports:
      - "3000:3000"
    env_file:
      - .env.local    # contains PETAL_TENANTS (and no FRAPPE_BACKEND_URL/PETAL_APPS)
    restart: unless-stopped

  # Example: Caddy as a reverse proxy — routes both subdomains to Petal
  caddy:
    image: caddy:alpine
    ports:
      - "80:80"
      - "443:443"
    command: caddy reverse-proxy --from acme.example.com --to petal:3000
    # Add a second Caddyfile entry for beta.example.com in production`} />

            <div className="mt-3">
              <Callout variant="tip">
                Point your DNS wildcard (<Mono>*.example.com → server-ip</Mono>) at the host running Docker, and add each subdomain as a key in <Mono>PETAL_TENANTS</Mono>. Adding a new tenant requires only updating the env var and restarting the container — no code changes.
              </Callout>
            </div>
          </section>

          {/* ── Environment Variables ─────────────────────────────────────── */}
          <section id="env-vars" className="scroll-mt-6">
            <h2 className="text-2xl font-bold text-foreground mb-1">Environment Variables <Badge color="default">Admin Reference</Badge></h2>
            <p className="text-muted-foreground mb-6">
              These are configured by your Petal host administrator. For source builds, most values come from <Mono>petal.config.ts</Mono> via <Mono>withPetal()</Mono> — only secrets live in <Mono>.env.local</Mono>. Docker deployments use <Mono>.env.local</Mono> exclusively.
            </p>

            <h3 className="font-semibold text-foreground mb-3">Secrets (.env.local)</h3>
            <PropTable rows={[
              { name: "FRAPPE_BACKEND_URL",        type: "string", required: true, desc: "Frappe backend URL as seen from the Next.js server. The hostname is derived from this for virtual-host routing." },
              { name: "NEXT_PUBLIC_FRONTEND_URL",  type: "string",                 default: "http://localhost:3000", desc: "Public URL of this Petal instance." },
            ]} />

            <p className="text-sm text-muted-foreground mt-6 mb-3">Example <Mono>.env.local</Mono>:</p>
            <CodeBlock label=".env.local" code={`FRAPPE_BACKEND_URL=http://frappe:8000
NEXT_PUBLIC_FRONTEND_URL=https://petal.mycompany.com`} />
          </section>

          {/* ── Custom Apps ──────────────────────────────────────────────── */}
          <section id="custom-apps" className="scroll-mt-6">
            <h2 className="text-2xl font-bold text-foreground mb-1">Custom App Development</h2>
            <p className="text-muted-foreground mb-6">
              A Petal app is an ESM module that exports a <Mono>PetalHooks</Mono> object as its default export. Petal loads it at runtime via dynamic <Mono>import()</Mono>, so you can deploy and version apps independently from the core shell.
            </p>

            <h3 className="font-semibold text-foreground mb-3">1 · Scaffold with the CLI</h3>
            <CodeBlock label="terminal" code={`petal create my-app
cd my-app
pnpm install`} />

            <h3 className="font-semibold text-foreground mt-8 mb-3">2 · File Structure</h3>
            <CodeBlock label="project layout" code={`my-app/
├── src/
│   ├── index.ts             # Entry point — re-exports hooks as default
│   ├── hooks.ts             # PetalHooks definition
│   └── components/
│       ├── MyPage.tsx       # Custom route page
│       └── MyForm.tsx       # Custom form override
├── package.json
└── vite.config.ts           # Builds to a single ESM bundle`} />

            <h3 className="font-semibold text-foreground mt-8 mb-3">3 · Define Hooks</h3>
            <CodeBlock label="src/hooks.ts" code={`import type { PetalHooks } from "@petal/sdk"

export const hooks: PetalHooks = {
  // ── Lifecycle ────────────────────────────────────────────────
  on_init: () => {
    // Runs before auth — register icons, theme overrides
  },

  on_boot: async () => {
    // Runs after the user authenticates — safe to call Frappe APIs
  },

  // ── Navigation ───────────────────────────────────────────────
  sidebar_items: [
    {
      label: "My App",
      path: "/my-app",
      icon: "dashboard",                       // built-in name
    },
    {
      label: "Reports",
      path: "/my-app/reports",
      icon: () => <svg viewBox="0 0 24 24">…</svg>,  // render fn
      children: [
        { label: "Monthly", path: "/my-app/reports/monthly" },
        { label: "Annual",  path: "/my-app/reports/annual"  },
      ],
    },
  ],

  // Rename / hide / re-icon existing items from Frappe
  sidebar_item_overrides: {
    "Buying":            { hidden: true },
    "My Institution":    { icon: MY_CUSTOM_ICON },
  },

  // Control display order of top-level items
  sidebar_order: ["My App", "Accounting", "HR", "Reports"],

  // ── Routes ───────────────────────────────────────────────────
  routes: [
    {
      path: "/my-app",
      component: () => import("./components/MyPage"),
    },
    {
      path: "/my-app/reports/:period",
      component: () => import("./components/Reports"),
    },
  ],

  // ── Form / List overrides ────────────────────────────────────
  form_overrides: {
    "Sales Order": () => import("./components/SalesOrderForm"),
  },

  list_overrides: {
    "Item": () => import("./components/ItemList"),
  },

  // ── Dynamic field rules ──────────────────────────────────────
  form_field_behaviors: {
    "Announcement": (doc) => {
      if (doc.for_all === 1) return { roles: { hidden: true } }
      return {}
    },
  },

  // ── Theme / Auth overrides ───────────────────────────────────
  overrides: {
    theme: {
      primaryColor: "#7c3aed",
      borderRadius: "0.75rem",
    },
    auth: {
      redirectAfterLogin: "/my-app",
    },
  },
}`} />

            <h3 className="font-semibold text-foreground mt-8 mb-3">4 · Entry Point</h3>
            <CodeBlock label="src/index.ts" code={`export { hooks as default } from "./hooks"`} />

            <h3 className="font-semibold text-foreground mt-8 mb-3">5 · Build</h3>
            <CodeBlock label="terminal" code={`pnpm build
# Outputs: dist/petal.hooks.js  (single ESM bundle)
# Upload dist/petal.hooks.js to your CDN / object storage`} />

            <h3 className="font-semibold text-foreground mt-8 mb-3">6 · Register with the CLI</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Run <Mono>petal app add</Mono> on the host. No restart needed — the next page load picks it up:
            </p>
            <CodeBlock label="terminal (run on the host)" code={`petal app add
#  App name:              my-app
#  Version:               1.0.0
#  Dev server URL:        http://localhost:5174/petal.hooks.js
#  Production bundle URL: https://cdn.example.com/my-app/1.0.0/petal.hooks.js`} />
            <div className="mt-3">
              <Callout variant="tip">
                When <Mono>NODE_ENV=development</Mono>, Petal loads from <Mono>devUrl</Mono> instead of <Mono>url</Mono> — point it at your Vite dev server for instant HMR without deploying.
              </Callout>
            </div>
          </section>

          {/* ── PetalHooks Reference ─────────────────────────────────────── */}
          <section id="hooks-reference" className="scroll-mt-6">
            <h2 className="text-2xl font-bold text-foreground mb-1">PetalHooks Reference</h2>
            <p className="text-muted-foreground mb-6">
              All fields exported from an app&apos;s <Mono>hooks.ts</Mono>. Every field is optional.
            </p>

            <PropTable rows={[
              { name: "on_init",                type: "() => void | Promise<void>",                           desc: "Runs once after the module loads, before authentication. Use for icon registration, theme overrides." },
              { name: "on_boot",                type: "() => void | Promise<void>",                           desc: "Runs once after the user authenticates. Safe to call Frappe APIs here." },
              { name: "on_app_error",           type: "(error: Error) => Promise<void>",                      desc: "Called if the app fails to load or throws during init/boot." },
              { name: "sidebar_items",          type: "SidebarItem[]",                                        desc: "Items appended to the sidebar after items fetched from Frappe workspaces." },
              { name: "sidebar_item_overrides", type: "Record<string, Partial<SidebarItem>>",                 desc: "Override label, icon, hidden, or badge on any item matched by label or path." },
              { name: "sidebar_order",          type: "string[]",                                             desc: "Display order for top-level sidebar items by label or path. Unlisted items follow." },
              { name: "navbar_items",           type: "NavbarItem[]",                                         desc: "Components injected into the top navbar." },
              { name: "routes",                 type: "RouteDefinition[]",                                    desc: "Client-side routes. component is a lazy import returning a default React component." },
              { name: "form_overrides",         type: "Record<string, () => Promise<{ default: ComponentType }>>", desc: "Replace the default Frappe form for a doctype with a custom React component." },
              { name: "form_field_behaviors",   type: "Record<string, (doc) => Record<string, FieldBehavior>>",   desc: "Dynamic per-field rules (read_only, hidden, styles) per doctype. Called on every value change." },
              { name: "list_overrides",         type: "Record<string, () => Promise<{ default: ComponentType }>>", desc: "Replace the default list view for a doctype." },
              { name: "overrides.theme",        type: "PetalThemeOverride",                                   desc: "Override CSS theme tokens: primaryColor, borderRadius, fontFamily, etc." },
              { name: "overrides.auth",         type: "AuthConfig",                                           desc: "Auth lifecycle hooks and redirects. See AuthConfig below." },
              { name: "overrides.frappeClient", type: "FrappeClientConfig",                                   desc: "Intercept every HTTP request (beforeRequest / afterRequest)." },
              { name: "overrides.settings",     type: "Record<string, unknown>",                              desc: "Arbitrary key-value settings merged into the global Petal store." },
            ]} />

            <h3 className="font-semibold text-foreground mt-8 mb-3">FieldBehavior</h3>
            <PropTable rows={[
              { name: "read_only",    type: "boolean",                 desc: "Render the field as read-only." },
              { name: "hidden",       type: "boolean",                 desc: "Hide the field entirely." },
              { name: "label_style",  type: "Record<string, string>",  desc: "Inline CSS applied to the field label element." },
              { name: "input_style",  type: "Record<string, string>",  desc: "Inline CSS applied to the primary input element." },
            ]} />

            <h3 className="font-semibold text-foreground mt-8 mb-3">AuthConfig</h3>
            <PropTable rows={[
              { name: "before_login",          type: "(credentials) => Promise<void | false>", desc: "Runs before login. Return false to abort." },
              { name: "after_login",           type: "(user: FrappeUser) => Promise<void>",    desc: "Runs after a successful login." },
              { name: "before_logout",         type: "() => Promise<void | false>",            desc: "Runs before logout. Return false to abort." },
              { name: "after_logout",          type: "() => Promise<void>",                    desc: "Runs after a successful logout." },
              { name: "redirectAfterLogin",    type: "string",                                 default: "/",        desc: "Path to navigate to after login." },
              { name: "redirectAfterLogout",   type: "string",                                 default: "/login",   desc: "Path to navigate to after logout." },
              { name: "loginComponent",        type: "() => Promise<{ default: ComponentType }>", desc: "Fully replace the login page UI with a custom component." },
            ]} />

            <h3 className="font-semibold text-foreground mt-8 mb-3">form_field_behaviors Example</h3>
            <CodeBlock label="src/hooks.ts" code={`form_field_behaviors: {
  // Hide "roles" when the announcement targets everyone
  "Announcement": (doc) => {
    if (doc.for_all === 1) return { roles: { hidden: true } }
    return {}
  },

  // Freeze all fields on a submitted Sales Order
  "Sales Order": (doc) => {
    if (doc.docstatus !== 1) return {}
    const freeze: Record<string, FieldBehavior> = {}
    Object.keys(doc).forEach((k) => { freeze[k] = { read_only: true } })
    return freeze
  },
},`} />

            <h3 className="font-semibold text-foreground mt-8 mb-3">Request Interceptor Example</h3>
            <CodeBlock label="src/hooks.ts" code={`overrides: {
  frappeClient: {
    beforeRequest: async (options) => {
      // Inject a custom header on every Frappe call
      return {
        ...options,
        headers: {
          ...options.headers,
          "X-App-Token": getAppToken(),
        },
      }
    },
    afterRequest: async (response) => {
      // Log or transform every response
      console.log("[my-app] response", response)
      return response
    },
  },
},`} />
          </section>

          {/* ── PetalConfig Reference ─────────────────────────────────────── */}
          <section id="config-reference" className="scroll-mt-6">
            <h2 className="text-2xl font-bold text-foreground mb-1">PetalConfig</h2>
            <p className="text-muted-foreground mb-6">
              Shape of <Mono>petal.config.ts</Mono> — the primary configuration file processed by <Mono>withPetal()</Mono> at build time. In Docker deployments this is overridden by env vars passed to the container at runtime.
            </p>

            <PropTable rows={[
              { name: "apps",    type: "PetalAppMeta[]",  required: true,  desc: "Apps to load at runtime. Written to .petal/config.json by withPetal() at startup." },
              { name: "pathMap", type: "Record<string, string>",            desc: "Override or extend the proxy path translation table. Keys are neutral paths, values are Frappe paths." },
            ]} />

            <h3 className="font-semibold text-foreground mt-8 mb-3">PetalAppMeta</h3>
            <PropTable rows={[
              { name: "name",    type: "string", required: true, desc: "Unique app identifier string." },
              { name: "version", type: "string", required: true, desc: "Semver version, e.g. 1.2.0." },
              { name: "url",     type: "string", required: true, desc: "CDN URL of the compiled ESM bundle (petal.hooks.js)." },
              { name: "devUrl",  type: "string",                 desc: "Vite dev server URL. Used when NODE_ENV=development." },
            ]} />

          </section>

          {/* ── Frappe Client API ─────────────────────────────────────────── */}
          <section id="frappe-client" className="scroll-mt-6">
            <h2 className="text-2xl font-bold text-foreground mb-1">Frappe Client API</h2>
            <p className="text-muted-foreground mb-6">
              Access via the <Mono>useFrappe()</Mono> hook inside React components, or <Mono>getFrappeClient()</Mono> outside. Every request is proxied through <Mono>/api/v1/</Mono> — the real Frappe origin never appears in the browser&apos;s network tab.
            </p>

            <PropTable rows={[
              { name: "getDoc(doctype, name)",        type: "Promise<T extends FrappeDocument>",    desc: "Fetch a single document by doctype and name." },
              { name: "getList(params)",              type: "Promise<T[]>",                         desc: "Fetch a filtered, paginated list of documents." },
              { name: "saveDoc(doc)",                 type: "Promise<T>",                           desc: "Create (if no name) or update an existing document." },
              { name: "deleteDoc(doctype, name)",     type: "Promise<void>",                        desc: "Permanently delete a document." },
              { name: "callMethod(method, args?)",    type: "Promise<T>",                           desc: "Call any whitelisted Frappe server method." },
              { name: "getLoggedInUser()",            type: "Promise<FrappeUser>",                  desc: "Get the currently authenticated user." },
              { name: "login(email, password)",       type: "Promise<FrappeUser>",                  desc: "Authenticate and start a Frappe session." },
              { name: "logout()",                     type: "Promise<void>",                        desc: "Destroy the current session." },
              { name: "uploadFile(file, dt?, name?)", type: "Promise<{ file_url: string }>",        desc: "Upload a File and optionally attach it to a document." },
              { name: "applyConfig(config)",          type: "void",                                 desc: "Apply FrappeClientConfig interceptors at runtime." },
            ]} />

            <h3 className="font-semibold text-foreground mt-8 mb-3">FrappeListParams</h3>
            <PropTable rows={[
              { name: "doctype",      type: "string",                        required: true, desc: "The Frappe doctype to query." },
              { name: "fields",       type: "string[]",                      default: '["name"]', desc: 'Fields to return. Use ["*"] for all.' },
              { name: "filters",      type: "Array<[field, op, value, ...]>", desc: 'AND conditions. e.g. [["status","=","Open"]].' },
              { name: "or_filters",   type: "Array<[field, op, value, ...]>", desc: "Same as filters but joined with OR." },
              { name: "order_by",     type: "string",                        desc: '"creation desc", "name asc", etc.' },
              { name: "limit",        type: "number",                        default: "20",  desc: "Maximum rows to return." },
              { name: "limit_start",  type: "number",                        default: "0",   desc: "Offset for pagination." },
            ]} />

            <h3 className="font-semibold text-foreground mt-8 mb-3">Examples</h3>
            <CodeBlock label="MyComponent.tsx" code={`import { useFrappe } from "@/hooks/useFrappe"
import type { FrappeDocument } from "@petal/sdk"

interface Item extends FrappeDocument {
  item_code: string
  item_name: string
  standard_rate: number
}

function MyComponent() {
  const frappe = useFrappe()

  async function examples() {
    // Fetch a list with filters
    const items = await frappe.getList<Item>({
      doctype: "Item",
      fields: ["name", "item_code", "item_name", "standard_rate"],
      filters: [["disabled", "=", "0"]],
      order_by: "item_name asc",
      limit: 50,
    })

    // Fetch a single document
    const item = await frappe.getDoc<Item>("Item", "WIDGET-001")

    // Create a new document
    const created = await frappe.saveDoc<Item>({
      doctype: "Item",
      item_code: "WIDGET-002",
      item_name: "Red Widget",
      standard_rate: 29.99,
    })

    // Update an existing document
    const updated = await frappe.saveDoc<Item>({
      doctype: "Item",
      name: "WIDGET-001",
      standard_rate: 24.99,
    })

    // Call a whitelisted server method
    const { message: count } = await frappe.callMethod<{ message: number }>(
      "frappe.client.get_count",
      { doctype: "Item", filters: [["disabled", "=", "0"]] },
    )

    // Upload a file and attach to a doc
    const { file_url } = await frappe.uploadFile(
      fileInputRef.current.files[0],
      "Item",       // doctype
      "WIDGET-001", // name
    )
  }
}`} />
          </section>

          {/* ── SidebarItem ───────────────────────────────────────────────── */}
          <section id="sidebar-items" className="scroll-mt-6">
            <h2 className="text-2xl font-bold text-foreground mb-1">SidebarItem</h2>
            <p className="text-muted-foreground mb-6">
              Shape of each entry in <Mono>sidebar_items</Mono>, <Mono>sidebar_item_overrides</Mono>, and <Mono>children</Mono> arrays.
            </p>

            <PropTable rows={[
              { name: "label",    type: "string",                         required: true, desc: "Display text shown in the sidebar." },
              { name: "path",     type: "string",                         required: true, desc: "Navigation path, e.g. /my-app/orders." },
              { name: "icon",     type: "string | (() => ReactNode)",      desc: "Built-in icon name, raw SVG string, or render function." },
              { name: "badge",    type: "() => ReactNode",                 desc: "Render function for a badge shown right of the label (e.g. unread count)." },
              { name: "children", type: "SidebarItem[]",                   desc: "Nested child items. Renders as a collapsible sub-menu." },
              { name: "hidden",   type: "boolean",                         default: "false", desc: "When true the item is excluded from the sidebar." },
            ]} />

            <h3 className="font-semibold text-foreground mt-8 mb-3">Icon Forms</h3>
            <CodeBlock label="hooks.ts" code={`// 1. Built-in registry name (string)
{ icon: "accounting" }

// 2. Raw inline SVG string
{ icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor">…</svg>' }

// 3. Render function (full JSX control)
{ icon: () => <MyIcon className="h-5 w-5 text-primary" /> }

// 4. Emoji / any text (last-resort fallback)
{ icon: "🚀" }`} />

            <h3 className="font-semibold text-foreground mt-8 mb-3">Badge — Live Unread Count</h3>
            <CodeBlock label="hooks.ts" code={`sidebar_items: [
  {
    label: "Inbox",
    path: "/inbox",
    badge: () => {
      // Hooks work inside badge render functions
      const { unread } = useInboxStore()
      if (!unread) return null
      return (
        <span className="px-1.5 py-0.5 text-xs font-bold bg-red-500 text-white rounded-full">
          {unread > 99 ? "99+" : unread}
        </span>
      )
    },
  },
],`} />

            <h3 className="font-semibold text-foreground mt-8 mb-3">Nested Children</h3>
            <CodeBlock label="hooks.ts" code={`sidebar_items: [
  {
    label: "Settings",
    path: "/settings",
    icon: "settings",
    children: [
      { label: "General",       path: "/settings/general" },
      { label: "Integrations",  path: "/settings/integrations" },
      { label: "Billing",       path: "/settings/billing" },
    ],
  },
],`} />
          </section>

          {/* ── Icon Registry ─────────────────────────────────────────────── */}
          <section id="icon-registry" className="scroll-mt-6">
            <h2 className="text-2xl font-bold text-foreground mb-1">Icon Registry</h2>
            <p className="text-muted-foreground mb-6">
              These built-in names resolve automatically in any <Mono>icon</Mono> string field. Custom apps can register additional icons via <Mono>iconRegistry.register()</Mono>.
            </p>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mb-8">
              {[
                "home","accounting","buying","selling","stock",
                "assets","hr","payroll","crm","project",
                "support","quality","website","users","settings",
                "integration","file","tool","dashboard",
              ].map((name) => (
                <div
                  key={name}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card text-xs font-mono text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors cursor-default"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-primary/60 shrink-0" />
                  {name}
                </div>
              ))}
            </div>

            <h3 className="font-semibold text-foreground mb-3">Register a Custom Icon</h3>
            <p className="text-sm text-muted-foreground mb-3">
              Call <Mono>iconRegistry.register()</Mono> inside <Mono>on_init</Mono> so the icon is available before any components render:
            </p>
            <CodeBlock label="src/hooks.ts" code={`import { iconRegistry } from "@petal/core/icons"
import { MyCustomIcon } from "./components/MyCustomIcon"

const hooks: PetalHooks = {
  on_init: () => {
    iconRegistry.register("my-feature", () => (
      <MyCustomIcon className="h-5 w-5" />
    ))
  },

  sidebar_items: [
    // Now you can reference it by name anywhere
    { label: "My Feature", path: "/my-feature", icon: "my-feature" },
  ],
}`} />
          </section>

          {/* ── CLI Reference ─────────────────────────────────────────────── */}
          <section id="cli" className="scroll-mt-6">
            <h2 className="text-2xl font-bold text-foreground mb-1">CLI Reference</h2>
            <p className="text-muted-foreground mb-6">
              Install Petal by cloning the repo. The CLI is included — run commands from the repo root after <Mono>pnpm install</Mono>.
            </p>

            <div className="space-y-4">
              {([
                {
                  cmd: "petal setup",
                  badge: "Host",
                  badgeColor: "blue" as const,
                  desc: "Interactive setup for a Petal deployment. Generates petal.config.ts (apps + theme), .env.local (backend secrets), and docker-compose.yml.",
                  example: `petal setup
# ✓ Created petal.config.ts
# ✓ Created .env.local
# ✓ Created docker-compose.yml
# Next: docker compose up`,
                },
                {
                  cmd: "petal create <app-name>",
                  badge: "App",
                  badgeColor: "green" as const,
                  desc: "Scaffold a new custom Petal app. Creates a Vite + React + TypeScript project pre-wired with @petal/sdk, a starter hooks.ts, and a vite.config.ts that builds a single ESM bundle (petal.hooks.js).",
                  example: `petal create hr-portal
# ✓ Created hr-portal/
# Next: cd hr-portal && pnpm install && pnpm dev`,
                },
              ] as const).map((c) => (
                <div key={c.cmd} className="border border-border rounded-xl overflow-hidden">
                  <div className="px-4 py-3 bg-zinc-900 flex items-center gap-3">
                    <code className="text-sm text-zinc-100 font-mono flex-1">{c.cmd}</code>
                    <Badge color={c.badgeColor}>{c.badge}</Badge>
                  </div>
                  <div className="px-4 py-3 text-sm text-muted-foreground border-b border-border">{c.desc}</div>
                  {c.example && (
                    <pre className="px-4 py-3 text-xs font-mono text-muted-foreground bg-muted/30 overflow-x-auto">{c.example}</pre>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Footer */}
          <div className="border-t border-border pt-6 pb-10 flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
            <span>Petal v1.0.0 · Developer Documentation</span>
            <span>Built on Next.js + Frappe</span>
          </div>

        </div>
      </div>
    </div>
  )
}
