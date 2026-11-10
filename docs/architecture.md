# Petal — App-Agnostic Frontend Architecture

Petal automatically discovers and supports **any installed Frappe app** (ERPNext, HRMS, CRM, custom apps) through two complementary mechanisms:

1. **Frappe workspace discovery** — sidebar items come from Frappe's Workspace doctype, so whatever apps are installed on the Frappe instance appear automatically.
2. **Petal custom apps** — independent Vite ESM bundles registered by URL, loaded at runtime via browser `import()`.

---

## Workspace Discovery

On boot Petal fetches `/api/resource/Workspace` from the configured Frappe backend and converts each workspace into a sidebar section. This means:

- ERPNext, HRMS, Frappe CRM, and any other installed Frappe app surface in the sidebar with zero Petal configuration.
- If workspaces are not configured, Petal falls back to module DocTypes (`/api/resource/DocType?module=CRM` etc.).

```
Frappe API
  └─ /api/resource/Workspace
       ├─ CRM → Leads, Opportunities, Customers
       ├─ Sales → Orders, Invoices, Delivery Notes
       ├─ HR → Employees, Attendance, Payroll
       └─ (any other installed app workspaces)
```

No Petal configuration is required for this to work — it is fully automatic.

---

## Custom App Architecture

Custom apps extend the shell with new pages, form overrides, sidebar items, and field behaviours. They are:

- **Decoupled** — built and deployed independently of the Petal host.
- **URL-registered** — Petal fetches the compiled bundle from any URL at runtime.
- **Source-private** — only the minified `dist/` bundle is shared; source TypeScript stays on the developer's machine.

```
Developer machine
  └─ my-app/src/        ← TypeScript source (never shared)
       pnpm build
  └─ dist/
       petal.hooks.js   ← minified ESM bundle  ─┐
       petal.hooks.css  ← compiled Tailwind CSS  ┤─ uploaded to CDN / S3
                                                  │
Petal shell (browser)                             │
  /api/config → petal.apps.json                   │
  import("https://cdn.example.com/…/petal.hooks.js") ←─┘
  <link href="…/petal.hooks.css">   (injected by on_init)
```

### App registry — `petal.apps.json`

Apps are registered in `petal.apps.json` in the petal core directory. This file is:

- **Gitignored** — instance-specific, not committed to the repo.
- **Read at request time** — the `/api/config` Next.js route reads it fresh on every request, so adding or removing an app requires only a browser refresh, not a server restart or rebuild.

```json
[
  {
    "name": "billing-fe",
    "version": "1.0.0",
    "url": "https://cdn.example.com/billing-fe/petal.hooks.js",
    "devUrl": "http://localhost:5175/petal.hooks.js"
  }
]
```

In production (`PETAL_APPS` env var is used instead when the file is absent — see [Deployment](README.md#deployment)).

### Load sequence per custom app

```
1. browser import(url) — fetches petal.hooks.js
2. on_init() — sync setup: CSS injection, icon registration, theme patch
3. [Petal checks Frappe session — unauthenticated → /login]
4. on_boot() — async setup: fetch user data, workspace items, etc.
5. Shell renders with merged sidebar + routes from all apps
```

### Hooks the shell calls

| Hook | When | Typical use |
|---|---|---|
| `on_init` | Immediately after bundle loads, before auth | Inject CSS, register icons, patch theme |
| `on_boot` | After Frappe session confirmed | Fetch user-specific data, build dynamic sidebar |
| `on_app_error` | When the shell catches an unhandled error | Log, report to error tracker |

`on_boot` hooks from all registered apps run **in parallel** via `Promise.allSettled` — one app's slow or failing boot does not block others.

### Form slot hooks

Beyond full form replacement (`form_overrides`), apps can inject UI *alongside* the standard Frappe form via `form_slots`:

| Slot | Position |
|---|---|
| `before` | Above the form |
| `toolbar` | Inside the form toolbar |
| `after` | Below the form |

Slots from multiple apps are all rendered in registration order. This lets multiple apps contribute to the same DocType's form view without competing for ownership.

---

## Config priority chain

```
petal.apps.json on disk   ← local dev (file-based, no rebuild)
        ↓  absent
PETAL_APPS env var        ← Docker / CI
        ↓  absent
no custom apps loaded
```

This means the exact same Docker image works with any set of custom apps — just set `PETAL_APPS` in the environment.

---

## Comparison: Frappe Desk vs Petal

| Feature | Frappe Desk | Petal |
|---|---|---|
| Frontend stack | Frappe JS (custom) | React 19 + Next.js 16 |
| App discovery | Hardcoded in Frappe | Dynamic — Frappe Workspace API |
| Custom apps | Frappe hooks/JS | Independent Vite bundles, any CDN |
| Styling | Frappe theme | Tailwind CSS (per-app isolation) |
| State management | Frappe + custom JS | Zustand |
| Type safety | None | Full TypeScript via `@petal/sdk` |
| Form overrides | Frappe customisation | React components, any complexity |
| Source privacy | N/A | Minified bundle only — source stays on developer machine |
| Deployment | Frappe bench | Docker / any Node host |
