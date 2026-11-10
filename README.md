# Petal

> A modern, extensible React frontend for Frappe — built on Next.js 16 and React 19.

Petal is an open-source alternative to Frappe Desk. It connects to any Frappe  backend, auto-discovers workspaces and DocTypes, and ships a full form and list engine out of the box. Custom React apps plug in through a typed hooks API — adding sidebar items, custom pages, form overrides, and field behaviours without touching the core.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Monorepo Structure](#monorepo-structure)
3. [Prerequisites](#prerequisites)
4. [Quick Start](#quick-start)
5. [Configuration](#configuration)
6. [Built-in Views & Tools](#built-in-views--tools)
7. [Custom App Development](#custom-app-development)
8. [Hooks API Reference](#hooks-api-reference)
9. [Styling & CSS](#styling--css)
10. [CLI Reference](#cli-reference)
11. [Deployment](#deployment)
12. [Frappe Client API](#frappe-client-api)
13. [Proxy API Reference](#proxy-api-reference)
14. [Auth Configuration](#auth-configuration)
15. [CORS & Frappe Backend Setup](#cors--frappe-backend-setup)
16. [Testing](#testing)
17. [Troubleshooting](#troubleshooting)

---

## Architecture

```
┌────────────────────────────────────────────────────────────────┐
│  Browser                                                       │
│                                                                │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │  @petal/core  (Next.js 16 App Router)                   │  │
│  │  ├─ Shell: Sidebar, Navbar, Auth guard                  │  │
│  │  ├─ Built-in: /list, /form, /report, /workspace, …     │  │
│  │  └─ petal.config.ts  ←  apps + pathMap                 │  │
│  └───────────────────────┬─────────────────────────────────┘  │
│                          │  dynamic import(url)  [ESM]        │
│        ┌─────────────────┼─────────────────────┐             │
│        ▼                 ▼                     ▼             │
│   billing-fe        erpnext-fe          any-other-app        │
│   petal.hooks.js    petal.hooks.js      petal.hooks.js        │
│   petal.hooks.css   (served from CDN, localhost, S3…)        │
│                          │  REST + CSRF                       │
└──────────────────────────┼────────────────────────────────────┘
                           ▼
             Frappe / ERPNext backend
             (any version, any installed apps)
```

### How app loading works

1. At Next.js startup, `next.config.js` reads `petal.config.ts` via `withPetal()`, which writes app config to `.petal/config.json`. The `/api/config` route reads that file on every request.
2. The browser receives the app list from `/api/config` and calls `import(url)` for each app's `petal.hooks.js`.
3. `on_init` fires immediately (pre-auth): CSS injection, icon registration, theme patches.
4. Petal checks the Frappe session. Unauthenticated → `/login`.
5. After auth, `on_boot` fires. Frappe workspaces are fetched and merged with any `sidebar_items` from apps.
6. The shell renders. Built-in routes and all custom app routes are active.

---

## Monorepo Structure

```
petal/
├── packages/
│   ├── core/                  # Next.js shell — the deployable Petal host
│   │   ├── src/
│   │   │   ├── app/           # Next.js App Router pages + API proxy routes
│   │   │   ├── components/    # Shell UI (Sidebar, Navbar, ErrorBoundary)
│   │   │   ├── lib/           # FrappeClient, app registry, runtime config
│   │   │   └── store/         # Zustand global store
│   │   ├── petal.config.ts    # apps + pathMap (primary config)
│   │
│   ├── sdk/                   # TypeScript types — imported by custom apps
│   │   └── src/types/
│   │       ├── hooks.ts       # PetalHooks, SidebarItem, RouteDefinition, …
│   │       ├── app.ts         # PetalConfig, PetalAppMeta, …
│   │       └── frappe.ts      # FrappeDocument, FrappeUser, …
│   │
│   ├── ui/                    # Shared React component library
│   │
│   └── cli/                   # `petal` CLI
│       └── src/commands/
│           ├── setup.ts       # petal setup
│           ├── start.ts       # petal start
│           ├── create.ts      # petal create
│           ├── dev.ts         # petal dev
│           └── app/           # petal app list/add/remove/update
│
└── tooling/
    ├── tsconfig/
    └── eslint/
```

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 18 or 20 |
| pnpm | 8+ |
| Frappe | v15 |

---

## Quick Start

### 1. Clone the repo

```bash
git clone https://github.com/ujjwalkumar93/petal.git
cd petal
pnpm install
```

### 2. Configure and start

```bash
# Point Petal at your Frappe backend (creates petal.config.ts and .env.local)
petal setup

# Start the shell
petal start          # http://localhost:3000
```

---

## Configuration

### `petal.config.ts` — primary config

This is the single source of truth for apps. `next.config.js` reads it at startup via `withPetal()`, which writes the apps array to `.petal/config.json`. The `/api/config` route reads that file on every request.

```ts
import type { PetalConfig } from "@petal/sdk"

const config: PetalConfig = {
  apps: [
    {
      name: "billing-fe",
      version: "0.1.0",
      url: "https://cdn.example.com/billing-fe/petal.hooks.js",
      devUrl: "http://localhost:5175/petal.hooks.js",
      // tailwindPrefix: "billing-",
    },
  ],
  // Optional: override or extend the proxy's path translation table
  // pathMap: {
  //   "auth/csrf": "api/method/my_app.api.get_csrf_token",
  // },
}

export default config
```

In development (`NODE_ENV=development`) the shell loads `devUrl`. In production it loads `url`.

**Restart `petal start` after editing this file** — the values are baked in at startup.

### `.env.local`

```env
FRAPPE_BACKEND_URL=http://localhost:8000

NEXT_PUBLIC_FRONTEND_URL=http://localhost:3000
NEXT_PUBLIC_APP_NAME=Petal
NEXT_PUBLIC_APP_VERSION=1.0.0
```

### Environment variables

| Variable | Read at | Default | Purpose |
|---|---|---|---|
| `FRAPPE_BACKEND_URL` | runtime | `http://localhost:8000` | Frappe site the proxy talks to |
| `FRAPPE_SITE_NAME` | runtime | backend hostname | Frappe site name (Host header + realtime namespace), if it differs from the hostname |
| `PETAL_APPS` | runtime | — | JSON array of apps; used when `petal.apps.json` is absent, overrides `petal.config.ts` |
| `PETAL_TENANTS` | runtime | — | JSON object keyed by hostname; enables multi-tenancy (see `/petal-docs#multi-tenancy`) |
| `FRAPPE_SOCKETIO_URL` | build | backend host on `:9000` | Frappe realtime server, reached via the same-origin `/socket.io` rewrite |
| `PETAL_REALTIME` | build | `1` | Set `0` to disable live updates |

App list precedence: `petal.apps.json` → `PETAL_APPS` → `petal.config.ts`.

---

## Built-in Views & Tools

Every DocType gets these without any configuration. Views appear in the switcher only when the DocType has the fields they need.

| Feature | Where | Notes |
|---|---|---|
| **Kanban** | `/kanban/:doctype?field=status` | Group by any Select or Link field. Drag cards (or use the per-card "Move to" menu on touch screens) — saves via `frappe.client.set_value`. Submitted docs can only move if the field is `allow_on_submit`. |
| **Calendar** | `/calendar/:doctype?start=…&end=…` | Month grid on desktop, agenda list on phones. Click an empty day to create a record dated that day. |
| **Gantt** | `/gantt/:doctype?start=…&end=…` | Needs two Date fields. Uses a Percent / `*progress*` field for progress bars when present. Zoomable. |
| **CSV export** | List → ⋯ → Export | Exports the filtered list (up to 5,000 rows) or just the selected rows. Formula-leading cells are escaped. |
| **CSV import** | List → ⋯ → Import, or `/import/:doctype` | Auto-maps columns, validates types/required fields before sending, inserts in batches of 50 and pinpoints failing rows. Update mode matches on an ID column. Parent fields only — use Frappe's Data Import for child tables. |
| **Bulk edit / submit** | List → select rows → ⋯ | Sets one field on all selected records, or submits selected drafts, via `bulk_update.submit_cancel_or_update_docs`. Frappe queues batches over 20 in the background. |
| **Activity** | Bottom of every saved form | Comments, field-level change history, emails, attachments (upload/remove) and assignments. |
| **Workflow** | Form toolbar | When a DocType has an active Workflow, its state badge and the transitions *you* are allowed to take replace Submit/Cancel. |
| **Amend** | Cancelled submittable docs | Opens a pre-filled draft linked by `amended_from`. Duplicate now skips `no_copy` fields. |
| **Live updates** | Lists, boards, calendars, forms | Lists refresh when anyone saves a record. An open form reloads itself, or warns you if you have unsaved edits. Needs Frappe's socket.io server (`bench start` runs it on :9000). |
| **API Playground** | `/developer` | Run whitelisted methods, `getDoc`, `getList` as yourself; copy a Petal client or curl snippet; request history. |

## Custom App Development

A Petal custom app is a **Vite ESM library build** that exports one default object: your `PetalHooks`. The compiled bundle (`petal.hooks.js` + `petal.hooks.css`) is hosted anywhere — localhost, CDN, S3, your own server. Petal fetches it at runtime with a browser `import()`.

Your source code never leaves your machine. Clients only ever receive the minified bundle.

### Step 1 — scaffold

Run from the parent directory where you want the app folder created:

```bash
petal create my-app
```

Interactive prompts:
- App name (lowercase, hyphens)
- Description
- Dev server port (default 5174 — pick a unique port per app)
- Local petal checkout? (yes = `file:` SDK reference, no = `"latest"` from npm)

This creates a complete project and **auto-registers** it in `petal.config.ts` if a petal core directory is found nearby. No manual step required.

**Scaffold output:**

```
my-app/
├── src/
│   ├── hooks/
│   │   ├── lifecycle.ts     # on_init (CSS injection), on_boot
│   │   ├── sidebar.ts       # sidebar_items, sidebar_order
│   │   └── forms/
│   │       └── index.ts     # form_field_behaviors
│   ├── pages/
│   │   └── Home.tsx
│   ├── utils/
│   │   └── api.ts           # frappe helper (getList, getDoc, callMethod, …)
│   └── styles.css           # @tailwind base/components/utilities
├── petal.hooks.ts            # entry point — assembles all hooks
├── vite.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── package.json
```

### Step 2 — install and run dev server

```bash
cd my-app
pnpm install
petal dev
```

```
  ◆ petal dev — my-app → http://localhost:5174/petal.hooks.js

  Watching for changes. Hard-refresh Petal (Cmd+Shift+R) after each rebuild.

  ✓ rebuilt in 340ms → refresh browser
  [serve] Local: http://localhost:5174/
```

`petal dev` runs an initial `vite build` first, then starts `vite build --watch` and `vite preview --host` in parallel. The preview server has `cors: true` so the Petal shell on port 3000 can import the bundle cross-origin.

### Step 3 — register (if not auto-registered)

If the scaffold couldn't find petal core nearby, add the app manually in `packages/core/petal.config.ts`:

```ts
apps: [
  {
    name: "my-app",
    version: "0.1.0",
    url: "https://cdn.example.com/my-app/petal.hooks.js",
    devUrl: "http://localhost:5174/petal.hooks.js",
  },
],
```

Restart `petal start` — the value is baked in at startup.

### Step 4 — edit your hooks

**`petal.hooks.ts`** — the entry point:

```ts
import type { PetalHooks } from "@petal/sdk"
import { sidebar }   from "./src/hooks/sidebar"
import { forms }     from "./src/hooks/forms"
import { lifecycle } from "./src/hooks/lifecycle"

const hooks: PetalHooks = {
  ...sidebar,
  ...forms,
  ...lifecycle,
  routes: [
    { path: "/my-app", component: () => import("./src/pages/Home") },
  ],
}

export default hooks
```

**`src/hooks/sidebar.ts`:**

```ts
import type { PetalHooks } from "@petal/sdk"

export const sidebar: Pick<PetalHooks, "sidebar_items" | "sidebar_order"> = {
  sidebar_items: [
    { label: "My App", path: "/my-app", icon: "dashboard" },
  ],
  sidebar_order: ["My App"],
}
```

**`src/hooks/forms/index.ts`:**

```ts
import type { PetalHooks } from "@petal/sdk"

export const forms: Pick<PetalHooks, "form_field_behaviors"> = {
  form_field_behaviors: {
    "Sales Order": (doc) => {
      if (doc.customer_type === "Company") {
        return { contact_person: { hidden: false } }
      }
      return { contact_person: { hidden: true } }
    },
  },
}
```

### Step 5 — build for production

```bash
pnpm build
# → dist/petal.hooks.js   (minified ESM)
# → dist/petal.hooks.css  (compiled Tailwind)
```

Upload `dist/` to your CDN or server, then update the `url` and `version` fields in `petal.config.ts` and restart `petal start`. Petal appends `?v=<version>` to every import URL, so bumping the version busts CDN cache automatically.

---

## Hooks API Reference

All types are exported from `@petal/sdk`.

### `PetalHooks`

```ts
interface PetalHooks {
  // Navigation
  sidebar_items?:         SidebarItem[]
  sidebar_item_overrides?: Record<string, Partial<Omit<SidebarItem, "path" | "children">>>
  sidebar_order?:         string[]
  navbar_items?:          NavbarItem[]

  // Pages
  routes?:                RouteDefinition[]

  // Frappe form / list replacements
  form_overrides?:        Record<string, () => Promise<{ default: ComponentType<{ docname: string }> }>>
  list_overrides?:        Record<string, () => Promise<{ default: ComponentType<{ filters?: Record<string, unknown> }> }>>

  // Augment a built-in form without fully replacing it (before / after / toolbar slots)
  form_slots?:            Record<string, FormSlotComponents>

  // Dynamic field behaviour
  form_field_behaviors?:  Record<string, (doc: Record<string, unknown>) => Record<string, FieldBehavior>>

  // Global overrides
  overrides?:             PetalHooksOverrides

  // Lifecycle
  on_init?:               () => void | Promise<void>
  on_boot?:               () => void | Promise<void>
  on_app_error?:          (error: Error) => Promise<void>
}
```

### `SidebarItem`

```ts
interface SidebarItem {
  label:     string
  path:      string
  icon?:     string | (() => ReactNode)   // registry name, raw SVG, or render fn
  badge?:    () => ReactNode              // rendered to the right of the label
  children?: SidebarItem[]
  hidden?:   boolean
}
```

**Built-in icon names:** `"home"`, `"accounting"`, `"buying"`, `"selling"`, `"stock"`, `"assets"`, `"hr"`, `"payroll"`, `"crm"`, `"project"`, `"support"`, `"quality"`, `"website"`, `"users"`, `"settings"`, `"integration"`, `"file"`, `"tool"`, `"dashboard"`.

Register custom icons in `on_init`:

```ts
import { iconRegistry } from "@petal/sdk"

on_init: () => {
  iconRegistry.register("my-icon", () => <svg>…</svg>)
}
```

### `sidebar_item_overrides`

Patch any sidebar item — including Frappe workspace items — by label or path. Applied after all apps' items are merged.

```ts
sidebar_item_overrides: {
  "Buying": { hidden: true },
  "Support": { badge: () => <span className="text-red-500">3</span> },
  "/workspace/Selling": { icon: "selling", label: "Sales" },
},
```

### `sidebar_order`

Control top-level display order. Items not listed appear after the ordered set in their original relative order.

```ts
sidebar_order: ["Home", "CRM", "Sales", "Accounting"],
```

### `RouteDefinition`

```ts
interface RouteDefinition {
  path:       string
  component:  () => Promise<{ default: ComponentType }>
  layout?:    "default" | "blank" | "fullscreen"
}
```

`"blank"` — no sidebar or navbar (print views, standalone dashboards).  
`"fullscreen"` — fills viewport minus the navbar.

### `FieldBehavior`

Returned by each `form_field_behaviors` handler. Called on every form value change.

```ts
interface FieldBehavior {
  read_only?:   boolean
  hidden?:      boolean
  label_style?: Record<string, string>   // inline CSS on the label element
  input_style?: Record<string, string>   // inline CSS on the input element
}
```

### `PetalHooksOverrides`

```ts
interface PetalHooksOverrides {
  theme?:        PetalThemeOverride
  frappeClient?: FrappeClientConfig    // beforeRequest / afterRequest
  workspace?:    WorkspaceConfig
  auth?:         AuthConfig
  settings?:     Record<string, unknown>
}
```

### `form_overrides`

Replace Petal's built-in form for a specific DocType with your own React component.

```ts
form_overrides: {
  "Sales Order": () => import("./src/overrides/SalesOrderForm"),
},
```

Your component receives `{ docname: string }`.

### `list_overrides`

Replace the built-in list view for a specific DocType.

```ts
list_overrides: {
  "Customer": () => import("./src/overrides/CustomerList"),
},
```

Your component receives `{ filters?: Record<string, unknown> }`.

---

## Styling & CSS

Each custom app owns its own Tailwind compilation. Petal's CSS is **not** shared — this is intentional so that app bundles can be deployed independently without any coupling to the host's source tree.

### CSS class isolation with `tailwindPrefix`

If two apps define conflicting Tailwind utility overrides (e.g. both extend `text-primary` differently), they can collide at the DOM level. Prevent this by setting a prefix in both the app's `tailwind.config.ts` and in `petal.config.ts`:

```ts
// my-app/tailwind.config.ts
export default {
  prefix: "billing-",
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  // ...
}
```

```ts
// petal.config.ts
apps: [{ name: "billing-fe", tailwindPrefix: "billing-", url: "..." }]
```

Then use the prefix in your components: `className="billing-text-primary billing-bg-muted"`.

### How it works

The scaffold generates a `styles.css` (`@tailwind base/components/utilities`) and a `tailwind.config.ts` scoped to `./src/**`. Vite compiles this into `dist/petal.hooks.css` alongside `dist/petal.hooks.js`.

The CSS is injected at runtime by `on_init`, resolving the stylesheet URL relative to the JS bundle URL:

```ts
// src/hooks/lifecycle.ts
import "../styles.css"       // tells Vite to emit petal.hooks.css

function injectStylesheet(): void {
  const scriptUrl = (document.currentScript as HTMLScriptElement | null)?.src
  if (!scriptUrl) return
  if (document.querySelector("link[data-my-app]")) return
  const link = document.createElement("link")
  link.rel = "stylesheet"
  link.href = scriptUrl.replace(/petal\.hooks\.js(\?.*)?$/, "petal.hooks.css")
  link.setAttribute("data-my-app", "1")
  document.head.appendChild(link)
}

export const lifecycle: Pick<PetalHooks, "on_init" | "on_boot"> = {
  on_init: () => { injectStylesheet() },
  on_boot: async () => {},
}
```

This works on any host — localhost, CDN, any path — because the URL is derived from where the JS was actually fetched.

### Tailwind theme tokens

The scaffold's `tailwind.config.ts` maps CSS variables to Tailwind color utilities, matching Petal's design system:

```ts
colors: {
  background:           "hsl(var(--background))",
  foreground:           "hsl(var(--foreground))",
  primary:              "hsl(var(--primary))",
  "primary-foreground": "hsl(var(--primary-foreground))",
  muted:                "hsl(var(--muted))",
  "muted-foreground":   "hsl(var(--muted-foreground))",
  border:               "hsl(var(--border))",
}
```

These CSS variables are set by Petal's shell at boot from the active theme, so your app's Tailwind utilities (`text-primary`, `bg-muted`, etc.) respond to the global theme automatically.

---

## CLI Reference

### `petal setup`

Run once from a Petal core directory. Creates `petal.config.ts`, `.env.local`, and `docker-compose.yml`.

```bash
petal setup
```

All files are gitignored — they hold instance-specific secrets and app registrations.

---

### `petal start`

Start the Next.js server. Works from anywhere inside the project — petal walks up the directory tree to find `packages/core`.

```bash
petal start                  # dev mode, port 3000
petal start -p 4000          # custom port
petal start --prod           # production mode (next start)
petal start --prod -p 4000
```

Requires `pnpm install` to have been run. **Reads `petal.config.ts` at startup** — restart after editing it. Apps registered via `petal app add` (`petal.apps.json`) are picked up automatically without a restart.

---

### `petal app list`

Show all apps registered in `petal.apps.json`.

```bash
petal app list

  Registered apps (/path/to/petal/packages/core/petal.apps.json)

  ● billing-fe v1.0.0
      dev:  http://localhost:5175/petal.hooks.js
      prod: https://cdn.example.com/billing-fe/petal.hooks.js
```

---

### `petal app add`

Interactive prompt — registers a new app in `petal.apps.json`. Changes are picked up on the next request — no `petal start` restart needed.

```bash
petal app add
#  App name:              billing-fe
#  Version:               0.1.0
#  Dev server URL:        http://localhost:5175/petal.hooks.js
#  Production bundle URL: https://cdn.example.com/billing-fe/petal.hooks.js
```

---

### `petal app update <name>`

Update version or URLs for a registered app. Existing values shown as defaults.

```bash
petal app update billing-fe
```

---

### `petal app remove <name>`

Unregister an app. Asks for confirmation.

```bash
petal app remove billing-fe
```

---

### `petal create [app-name]`

Scaffold a new custom app and auto-register it.

```bash
petal create                 # interactive
petal create billing-fe      # name pre-filled
```

**Prompts:**
- App name
- Description
- Dev server port (default 5174)
- Using a local petal checkout? (determines SDK reference: `file:` vs `"latest"`)

If petal core is found in a parent directory (up to 10 levels), the app is automatically registered in `petal.config.ts`. Otherwise instructions to register manually are printed.

---

### `petal dev`

Run from inside a custom app directory. Does an initial blocking `vite build` first (so the preview server has something to serve), then starts `vite build --watch` and `vite preview` in parallel.

```bash
petal dev                       # port auto-detected from vite.config.ts preview.port
petal dev -p 5180               # explicit port
petal dev --shell http://localhost:4000   # Petal shell URL to auto-reload (default :3000)
```

Port is resolved by reading `vite.config.ts` with a regex scan — no eval or import needed.

After each Vite rebuild, the CLI automatically pings `POST <shell-url>/__petal_hmr`, which triggers a live reload of the app modules in all open browser tabs — no manual hard-refresh needed.

---

## Deployment

### Docker / CI

```bash
docker build -t petal --build-arg FRAPPE_SOCKETIO_URL=http://frappe:9000 .
docker run -p 3000:3000 \
  -e FRAPPE_BACKEND_URL=http://frappe:8000 \
  -e PETAL_APPS='[{"name":"billing-fe","version":"1.0.0","url":"https://cdn.example.com/billing-fe/petal.hooks.js"}]' \
  petal
```

Apps defined in `petal.config.ts` are baked into `.petal/config.json` at build time by `withPetal()`. Apps registered via `petal app add` (`petal.apps.json`) or `PETAL_APPS` are read at request time, and their origins are added to the CSP automatically. `.env.local` is excluded from the image — configure containers with runtime env vars (see [Environment variables](#environment-variables)).

CI (`.github/workflows/ci.yml`) runs typecheck, unit tests with coverage, the production build, and a Docker build on every push and PR.

`petal setup` generates a `docker-compose.yml` with `env_file: .env.local` wired up.

### Deploying a custom app bundle

1. Build: `pnpm build` → `dist/petal.hooks.js` + `dist/petal.hooks.css`
2. Upload both files to your CDN / S3 bucket (keep them in the same directory)
3. Update the `url` and `version` in `petal.config.ts`, restart `petal start`

Petal appends `?v=<version>` to the `url` on every page load, so incrementing the version is sufficient — no CDN purge required.

### License gating

Throw inside `on_init` to block app load. Petal catches the error, logs it to `failedApps`, and shows a red error banner — the rest of the shell continues working.

```ts
on_init: async () => {
  const valid = await validateLicenseKey(import.meta.env.VITE_LICENSE_KEY)
  if (!valid) throw new Error("Invalid or expired license key.")
  injectStylesheet()
},
```

---

## Frappe Client API

The scaffolded `src/utils/api.ts` ships a lightweight Frappe REST helper. All requests go through the Petal Next.js proxy (`/api/v1/…`) which strips Frappe-specific paths from the browser's network tab, handles cookie forwarding, and translates CSRF headers.

```ts
import { frappe } from "./utils/api"
```

### Methods

#### `frappe.getList<T>(params)`

```ts
const orders = await frappe.getList<SalesOrder>({
  doctype: "Sales Order",
  fields: ["name", "customer", "grand_total", "status"],
  filters: [["status", "=", "To Deliver and Bill"]],
  order_by: "creation desc",
  limit: 20,
})
```

#### `frappe.getDoc<T>(doctype, name)`

```ts
const order = await frappe.getDoc<SalesOrder>("Sales Order", "SAL-ORD-0001")
```

#### `frappe.saveDoc<T>(doc)`

Creates a new doc when `doc.name` is absent, updates otherwise.

```ts
const saved = await frappe.saveDoc<SalesOrder>({
  doctype: "Sales Order",
  customer: "Acme Corp",
  delivery_date: "2025-06-01",
  items: [{ item_code: "PROD-001", qty: 10, rate: 500 }],
})

await frappe.saveDoc({ doctype: "Sales Order", name: "SAL-ORD-0001", status: "Closed" })
```

#### `frappe.deleteDoc(doctype, name)`

```ts
await frappe.deleteDoc("Sales Order", "SAL-ORD-0001")
```

#### `frappe.callMethod<T>(method, args?, opts?)`

Call any whitelisted Frappe Python method:

```ts
const result = await frappe.callMethod<{ message: string }>(
  "my_app.api.process_order",
  { order_name: "SAL-ORD-0001" },
)

// Cache the result for 30 seconds (avoids repeated fetches on re-render)
const result = await frappe.callMethod("my_app.api.get_summary", {}, { cache: true })
```

#### `frappe.uploadFile(file, meta?)`

```ts
const url = await frappe.uploadFile(file, {
  doctype: "Sales Order",
  docname: "SAL-ORD-0001",
  fieldname: "attachment",
  is_private: 0,
})
```

Returns the relative file URL from Frappe.

### CSRF handling

The client fetches and caches the CSRF token from Frappe automatically after login via `initCSRF()`. The token is reset on each `login()` call and re-fetched. For non-GET requests, it is sent as `X-CSRF-Token` which the proxy translates to `X-Frappe-CSRF-Token`.

No backend setup is needed: unless `pathMap["auth/csrf"]` points at a method of your own, the proxy reads the token from Frappe's `/app` boot page for the logged-in session. See [CSRF setup](#2-csrf-setup) for alternatives.

### Request middleware

Intercept every request via `overrides.frappeClient` in your hooks:

```ts
overrides: {
  frappeClient: {
    beforeRequest: async (options) => {
      options.headers = { ...options.headers, "X-App-Version": "1.0.0" }
      return options
    },
  },
},
```

---

## Proxy API Reference

All browser requests go through `/api/v1/…`. The proxy translates neutral Petal paths to Frappe internal paths — Frappe method names never appear in the browser's network tab.

| Neutral path | Frappe path |
|---|---|
| `auth/login` | `api/method/login` |
| `auth/logout` | `api/method/logout` |
| `auth/me` | `api/method/frappe.auth.get_logged_user` |
| `auth/csrf` | token scraped from `/app` (or `pathMap["auth/csrf"]` if set) |
| `auth/userinfo` | `api/resource/User` |
| `workspace/sidebar` | `api/method/frappe.desk.desktop.get_workspace_sidebar_items` |
| `workspace/page` | `api/method/frappe.desk.desktop.get_desktop_page` |
| `doc/:doctype[/:name]` | `api/resource/:doctype[/:name]` |
| `records/count` | `api/method/frappe.client.get_count` |
| `records/value` | `api/method/frappe.client.get_value` |
| `records/list` | `api/method/frappe.client.get_list` |
| `records/meta` | `api/method/frappe.client.get_meta` |
| `search/link` | `api/method/frappe.desk.search.search_link` |
| `reports/run` | `api/method/frappe.desk.query_report.run` |
| `upload` | `api/method/upload_file` |
| `exec` | `api/method/<X-Method header>` (catch-all for `callMethod()`) |
| `files/:rest` | `files/:rest` (pass-through) |

The proxy also:
- Strips the `Domain` attribute from `Set-Cookie` headers so Frappe's cookies stick to the Petal origin (`HttpOnly`/`SameSite`/`Secure` are preserved)
- Translates `X-CSRF-Token` → `X-Frappe-CSRF-Token`
- Routes each hostname to its own backend when `PETAL_TENANTS` is set (unknown hosts get 404)

**Overriding or extending the path map** — add `pathMap` to `petal.config.ts`. Your entries are merged over the built-in table and take priority:

```ts
pathMap: {
  "auth/csrf": "api/method/my_app.api.get_csrf_token",
  "notifications/list": "api/method/my_app.notifications.list",
}
```

Custom path mappings belong in `petal.config.ts` and are picked up automatically at startup.

---

## Auth Configuration

```ts
overrides: {
  auth: {
    redirectAfterLogin:  "/dashboard",
    redirectAfterLogout: "/login",

    before_login: async ({ email }) => {
      if (email.endsWith("@blocked.com")) return false   // cancel login
    },
    after_login: async (user) => {
      analytics.identify(user.email)
    },
    before_logout: async () => {
      await flushPendingChanges()
    },
    after_logout: async () => {
      localStorage.clear()
    },

    // Replace the login page entirely
    loginComponent: () => import("./src/pages/CustomLogin"),
  },
},
```

### `FrappeUser` shape

```ts
interface FrappeUser {
  name:        string      // Frappe username (usually email)
  email:       string
  full_name:   string
  first_name:  string
  username:    string
  user_image?: string      // relative path to avatar
  user_type:   string      // "System User" | "Website User"
  roles:       string[]
  time_zone?:  string
}
```

---

## Theme

Theme is controlled per-app via `overrides.theme` in your `petal.hooks.ts`:

```ts
overrides: {
  theme: {
    primaryColor: "#0ea5e9",
    borderRadius: "0.25rem",
  },
},
```

Multiple apps can provide theme patches. Petal merges them in registration order; last app wins on conflicts. Values are injected as CSS custom properties on `<html>` at boot, so Tailwind utilities that reference `hsl(var(--primary))` respond automatically.

---

## CORS & Frappe Backend Setup

Petal runs on a different origin than Frappe. Configure Frappe to accept credentialed cross-origin requests.

### 1. Edit site config

```json
// ~/frappe-bench/sites/<site>/site_config.json
{
  "allow_cors": "http://localhost:3000",
  "cors_allow_credentials": 1
}
```

For production, set `allow_cors` to your deployed Petal URL (e.g. `https://app.example.com`).

### 2. CSRF setup

Frappe validates a CSRF token on all non-GET requests. Petal fetches and caches this token automatically via `initCSRF()` after login.

**Default — nothing to configure.** The proxy fetches `/app` with the user's session cookie and reads `frappe.csrf_token` from the page. This works on any Frappe site.

**Option A — expose a CSRF endpoint (saves one HTML fetch per login)**

Add a whitelisted method to your Frappe app:

```python
# my_app/api.py
import frappe

@frappe.whitelist()
def get_csrf_token():
    return frappe.sessions.get_csrf_token()
```

Then override the `auth/csrf` proxy path in `petal.config.ts` — no file edits in core required:

```ts
const config: PetalConfig = {
  apps: [...],
  pathMap: {
    "auth/csrf": "api/method/my_app.api.get_csrf_token",
  },
}
```

**Option B — disable CSRF validation (development only)**

Add `ignore_csrf` to `site_config.json`. Takes effect immediately — no bench restart needed.

```json
{
  "allow_cors": "http://localhost:3000",
  "cors_allow_credentials": 1,
  "ignore_csrf": 1
}
```

> Do not use `ignore_csrf` in production.

### 3. Restart Frappe

```bash
cd ~/frappe-bench
bench restart
```

### 4. Verify

Successful boot in browser console:

```
[Petal] Found 8 workspaces in Frappe
[Petal] Loaded app: billing-fe v1.0.0
[Petal] Shell ready
```

---

## Testing

```bash
pnpm test            # all unit tests (Vitest)
pnpm test:watch      # watch mode
pnpm test:coverage   # with V8 coverage → coverage/
pnpm ci              # typecheck + tests, as CI runs them
```

Tests live next to the code as `*.test.ts` (Node) and `*.test.tsx` (jsdom + Testing Library). Pure logic — CSV, import mapping, kanban/calendar/gantt geometry, timeline, the Frappe client, proxy paths, tenants, realtime — sits in `lib/` modules so it can be tested without a Frappe server.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Sidebar is empty | CORS not configured or Frappe not running | Check `site_config.json`, run `bench restart` |
| Login redirect loop | Wrong `FRAPPE_BACKEND_URL` | Check `.env.local`, restart `petal start` |
| `Failed to fetch dynamically imported module` | Dev server not running or wrong port | Run `petal dev` inside your app directory; check `devUrl` in `petal.config.ts` |
| App fails to load (red banner) | Wrong `url`/`devUrl`, or `on_init` threw | Check network tab; verify URLs; check console for the thrown error |
| CSS not applied | `petal.hooks.css` not uploaded alongside `.js`, or `injectStylesheet` not called | Ensure both files are in the same CDN directory; check `on_init` calls `injectStylesheet()` |
| Old bundle served after deploy | CDN cache | Bump `version` in `petal.config.ts` — Petal appends `?v=<version>` automatically |
| `petal app add` says "not in petal core dir" | Not inside a petal project | Run from anywhere inside your petal monorepo — petal walks up to find `packages/core` |
| `petal dev` shows wrong port | vite.config.ts `preview.port` missing | Add `preview: { port: 5174 }` to your `vite.config.ts` or use `-p` flag |
| Custom form override not loading | Wrong `devUrl` port, or bundle not rebuilt | Run `petal dev`, hard-refresh (`Cmd+Shift+R`) |
| Workspace page shows "Workspace unavailable" | POST to `get_desktop_page` failing with CSRF 400 | Add `"ignore_csrf": 1` to `site_config.json` (dev) or expose a CSRF endpoint (prod) |
| POST requests return HTTP 400 | CSRF token missing or invalid | Check `initCSRF()` is wired, or add `"ignore_csrf": 1` to `site_config.json` |
| Edited `petal.config.ts` but changes not taking effect | Config is baked at startup | Restart `petal start` after editing `petal.config.ts` |
| App still loads after removing from `petal.config.ts` | Old `.petal/config.json` cached from previous startup | Restart `petal start` to regenerate `.petal/config.json` |

---

## Documentation

- [Architecture](docs/architecture.md) — how Petal discovers Frappe apps, custom app loading, config priority chain
- [Building a Custom App](docs/custom-app-guide.md) — scaffold, hooks reference, Tailwind, deployment

## License

MIT — see [LICENSE](LICENSE).
