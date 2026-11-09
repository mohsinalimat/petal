# Building a Petal Custom App

This guide covers everything you need to build, develop, and deploy a custom app for a Petal frontend installation.

## What is a custom app?

A Petal custom app is a **Vite ESM library** that exports one default object (`PetalHooks`). The compiled bundle is hosted on any URL — a CDN, S3, your own server, or localhost in development. The Petal shell fetches it at runtime with a browser `import()` and merges your hooks into the shell.

You can:
- Add sidebar items and custom pages
- Override the built-in form or list view for any Frappe DocType
- Add dynamic field behaviour (hide/show/read-only based on document values)
- Patch the sidebar of any installed Frappe app
- Inject CSS, register icons, set up per-app auth callbacks

Your TypeScript source never leaves your machine — clients only receive the minified bundle.

---

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | 18 or 20 |
| pnpm | 8+ |
| `@petal/cli` | latest |

Install the CLI globally if not already available:

```bash
npm install -g @petal/cli
# or
pnpm add -g @petal/cli
```

---

## Scaffold

```bash
petal create my-app
```

Interactive prompts:

| Prompt | Notes |
|---|---|
| App name | Lowercase, hyphens only |
| Description | Shown in `petal app list` |
| Dev server port | Pick a unique port per app (default 5174) |
| Local petal checkout? | `yes` → SDK reference uses `file:`, `no` → uses `"latest"` from npm |

The scaffold auto-registers your app in `petal.apps.json` if a Petal host directory is found nearby (up to 10 parent directories). If not, it prints the manual registration command.

### Generated structure

```
my-app/
├── src/
│   ├── hooks/
│   │   ├── lifecycle.ts        # on_init (CSS injection), on_boot
│   │   ├── sidebar.ts          # sidebar_items, sidebar_order
│   │   └── forms/
│   │       └── index.ts        # form_field_behaviors
│   ├── pages/
│   │   └── Home.tsx            # starter page component
│   ├── utils/
│   │   └── api.ts              # frappe.getList, getDoc, callMethod, …
│   └── styles.css              # @tailwind base/components/utilities
├── petal.hooks.ts              # entry point — assembles all hooks
├── vite.config.ts
├── tailwind.config.ts
├── postcss.config.js
├── tsconfig.json
└── package.json
```

---

## Development workflow

```bash
cd my-app
pnpm install
petal dev
```

`petal dev` runs two processes in parallel:

- `vite build --watch` — rebuilds on every file save
- `vite preview --host` — serves the bundle on your configured port

```
  ◆ petal dev — my-app → http://localhost:5174/petal.hooks.js

  Watching for changes. Shell at http://localhost:3000 reloads automatically after each rebuild.

  ✓ rebuilt in 340ms → shell reloaded
```

After each build, `petal dev` pings the Petal shell's HMR endpoint and the browser reloads automatically. No manual hard-refresh needed.

### Shell URL

If Petal Core runs on a non-default port, pass `--shell`:

```bash
petal dev --shell http://localhost:4000
```

### Explicit bundle port

```bash
petal dev -p 5180
```

Port is also auto-detected from `vite.config.ts`'s `preview.port` field — set it there to avoid typing `-p` every time.

---

## App entry point

**`petal.hooks.ts`** — the Vite build entry. Export a default `PetalHooks` object:

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
    { path: "/my-app/detail", component: () => import("./src/pages/Detail") },
  ],
}

export default hooks
```

---

## Hooks reference

### Sidebar

```ts
// src/hooks/sidebar.ts
import type { PetalHooks } from "@petal/sdk"

export const sidebar: Pick<PetalHooks, "sidebar_items" | "sidebar_order"> = {
  sidebar_items: [
    {
      label: "My App",
      path: "/my-app",
      icon: "dashboard",           // built-in name, SVG string, or () => ReactNode
      children: [
        { label: "Reports", path: "/my-app/reports" },
        { label: "Settings", path: "/my-app/settings" },
      ],
    },
  ],
  // Order top-level sidebar items by label or path.
  // Items not listed appear after the ordered set.
  sidebar_order: ["My App", "Home"],
}
```

**Built-in icon names:** `"home"`, `"accounting"`, `"buying"`, `"selling"`, `"stock"`, `"assets"`, `"hr"`, `"payroll"`, `"crm"`, `"project"`, `"support"`, `"quality"`, `"website"`, `"users"`, `"settings"`, `"integration"`, `"file"`, `"tool"`, `"dashboard"`.

**Use a custom icon** — pass a render function directly in `sidebar_items`:

```ts
icon: () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
  <path d="M12 2L2 7l10 5 10-5-10-5Z" />
</svg>
```

You can also pass a raw SVG string and Petal will render it inline:

```ts
icon: "<svg viewBox='0 0 24 24'>…</svg>"
```

**Override any sidebar item** (including Frappe workspace items):

```ts
sidebar_item_overrides: {
  "Buying": { hidden: true },
  "Support": { badge: () => <span className="text-red-500 text-xs">3</span> },
  "/workspace/Selling": { label: "Sales", icon: "selling" },
},
```

---

### Routes and pages

```ts
routes: [
  { path: "/my-app",         component: () => import("./src/pages/Home") },
  { path: "/my-app/reports", component: () => import("./src/pages/Reports"), layout: "fullscreen" },
  { path: "/my-app/print",   component: () => import("./src/pages/Print"),   layout: "blank" },
],
```

| `layout` | Renders |
|---|---|
| `"default"` (or omitted) | Sidebar + navbar + your page |
| `"fullscreen"` | Navbar + your page (no sidebar) |
| `"blank"` | Your page only (no shell chrome) |

---

### Form field behaviours

Dynamic field visibility / read-only — called on every document value change:

```ts
// src/hooks/forms/index.ts
import type { PetalHooks } from "@petal/sdk"

export const forms: Pick<PetalHooks, "form_field_behaviors"> = {
  form_field_behaviors: {
    "Sales Order": (doc) => {
      // Show contact_person only when customer_type is Company
      if (doc.customer_type === "Company") {
        return { contact_person: { hidden: false, read_only: false } }
      }
      return { contact_person: { hidden: true } }
    },
    "Payment Entry": (doc) => {
      if (doc.payment_type === "Internal Transfer") {
        return {
          party:      { hidden: true },
          party_name: { hidden: true },
        }
      }
      return {}
    },
  },
}
```

`FieldBehavior` properties:

| Property | Type | Effect |
|---|---|---|
| `hidden` | `boolean` | Hides/shows the field row |
| `read_only` | `boolean` | Makes the field non-editable |
| `label_style` | `Record<string, string>` | Inline CSS on the label |
| `input_style` | `Record<string, string>` | Inline CSS on the input |

---

### Form overrides

Replace the entire built-in form for a DocType:

```ts
form_overrides: {
  "Sales Invoice": () => import("./src/overrides/SalesInvoiceForm"),
},
```

Your component receives `{ docname: string }`:

```tsx
// src/overrides/SalesInvoiceForm.tsx
import { frappe } from "../utils/api"
import { useEffect, useState } from "react"

export default function SalesInvoiceForm({ docname }: { docname: string }) {
  const [doc, setDoc] = useState<SalesInvoice | null>(null)

  useEffect(() => {
    frappe.getDoc<SalesInvoice>("Sales Invoice", docname).then(setDoc)
  }, [docname])

  if (!doc) return <div>Loading…</div>
  return <div>{/* your form UI */}</div>
}
```

---

### Form slots

Inject UI **alongside** the built-in form without replacing it. Three positions are available:

| Slot | Position |
|---|---|
| `before` | Above the form |
| `after` | Below the form |
| `toolbar` | Inside the form toolbar, next to the MoreActions dropdown |

```ts
form_slots: {
  "Sales Invoice": {
    toolbar: () => import("./src/slots/InvoiceToolbar"),
    after:   () => import("./src/slots/InvoiceAuditLog"),
  },
},
```

Each slot factory returns a React component that receives `{ docname: string }`:

```tsx
// src/slots/InvoiceToolbar.tsx
export default function InvoiceToolbar({ docname }: { docname: string }) {
  return (
    <button onClick={() => sendToAccountant(docname)}
      className="px-3 py-1.5 text-sm bg-primary text-primary-foreground rounded">
      Send to Accountant
    </button>
  )
}
```

Slots from multiple apps are all rendered — registration order determines display order.

---

### List overrides

Replace the built-in list for a DocType:

```ts
list_overrides: {
  "Customer": () => import("./src/overrides/CustomerList"),
},
```

Your component receives `{ filters?: Record<string, unknown> }`.

---

### Running Frappe/ERPNext form scripts (`frappe_compat`)

Petal can run Desk client code unchanged inside its forms: each doctype's form script (`__js`), Client Scripts, and app bundles such as `erpnext.bundle.js`. Turn it on from any app:

```ts
frappe_compat: {
  enabled: true,
  bundles: ["erpnext.bundle.js"],   // names from Frappe's assets.json
  // autoBundles: true,             // also load <app>.bundle.js for every installed app (default)
  // exclude: ["My Doctype"],       // keep Petal's plain form for these
  // desk_controls: ["Data"],       // draw these field types with Desk's own control
  // desk: {                        // screens to open in Frappe Desk instead
  //   doctypes: ["Location"],
  //   pages: ["point-of-sale"],
  //   embed: false,                // true: show Desk inside Petal (needs a shared login)
  // },
}
```

With it on, forms behave like Desk: `frappe.ui.form.on` events (setup → onload → refresh → field/child events → validate/before_save → after_save, submit/cancel), `frm.set_value`, `set_query`, `add_custom_button`, `toggle_display/reqd/enable`, `set_df_property`, `frm.call`, mapped documents, `frappe.ui.Dialog`, `msgprint/confirm/prompt`, the "Get Items From" picker, and saving through `frappe.desk.form.save.savedocs`. Beyond forms, it also drives:

- **Lists:** `frappe.listview_settings` status indicators, `add_fields`, formatters, default filters and `onload` actions/buttons.
- **Reports:** script and query reports with their real filters, `onload` and `formatter`.
- **Desk pages:** `frappe.pages[...]` at `/page/<name>`.
- **Widgets:** charts (frappe-charts), `frappe.DataTable`, `frappe.ui.Tree`, the barcode scanner, and Desk's own controls for field types Petal has no input for.

Screens listed under `desk` open in Desk instead. Set `NEXT_PUBLIC_PETAL_DESK_URL` to Desk's address.

The runtime loads only for apps that turn it on, when a form, list, report or page first needs it (~170 KB gzipped, cached); Desk's controls bundle loads only when a screen uses one. See `docs/frappe-compat.md` for how it works and what isn't covered.

---

### Setup wizard slides

On a fresh site (Frappe's `Installed Applications` shows `frappe`/`erpnext` with setup pending), Petal sends System Managers to `/setup-wizard` before the desk loads. It mirrors Desk's wizard: language/region, first user, and the ERPNext organization slide (company, abbreviation, chart of accounts, fiscal year). Then it calls `frappe.desk.page.setup_wizard.setup_wizard.setup_complete`. Background setup (`trigger_site_setup_in_background`) also works: Petal follows the `setup_task` realtime events and polls the status in case realtime is down.

Apps can add their own slides. The values are merged into the `args` your Python `setup_wizard_stages` / `setup_wizard_complete` hooks receive:

```ts
setup_wizard_slides: [
  {
    name: "school",
    app: "edusuite",          // shown only while edusuite's setup is pending (needs has_setup_wizard)
    title: "Your school",
    fields: [
      { fieldname: "school_board", label: "Board", fieldtype: "Select", options: ["CBSE", "ICSE"], reqd: true },
      { fieldname: "student_capacity", label: "Students", fieldtype: "Int" },
    ],
    validate: (v) => (Number(v.student_capacity) > 100000 ? "That's a lot of students" : null),
  },
]
```

Field types: `Data`, `Select`, `Check`, `Date`, `Int`, `Password`, `Small Text`.

---

### Lifecycle hooks

```ts
// src/hooks/lifecycle.ts
import type { PetalHooks } from "@petal/sdk"
import "../styles.css"      // tells Vite to emit petal.hooks.css

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
  on_init: () => {
    injectStylesheet()
    // register icons, patch theme — no Frappe session available yet
  },
  on_boot: async () => {
    // Frappe session is confirmed here — safe to call APIs
  },
}
```

**License gating** — throw in `on_init` to block the app:

```ts
on_init: async () => {
  const ok = await checkLicense()
  if (!ok) throw new Error("License invalid or expired.")
  injectStylesheet()
},
```

Petal catches the error and shows a red banner. The rest of the shell continues working.

---

## Calling Frappe APIs

The scaffolded `src/utils/api.ts` ships a thin REST helper:

```ts
import { frappe } from "./utils/api"

// List
const orders = await frappe.getList<SalesOrder>("Sales Order", {
  fields: ["name", "customer", "grand_total"],
  filters: [["status", "=", "Draft"]],
  limit: 50,
})

// Single document
const order = await frappe.getDoc<SalesOrder>("Sales Order", "SAL-ORD-0001")

// Create
const created = await frappe.createDoc("Sales Order", {
  customer: "Acme Corp",
  items: [{ item_code: "PROD-001", qty: 5, rate: 1000 }],
})

// Update
await frappe.updateDoc("Sales Order", "SAL-ORD-0001", { status: "Closed" })

// Whitelisted Python method
const result = await frappe.callMethod<{ total: number }>(
  "my_frappe_app.api.get_summary",
  { year: 2025 },
)
```

---

## Styling

Your app has its own Tailwind compilation — independent of the Petal host's CSS. The stylesheet is compiled into `dist/petal.hooks.css` and injected at runtime by `on_init`.

Use Tailwind utilities freely in your components:

```tsx
export default function Home() {
  return (
    <div className="max-w-2xl mx-auto py-12 px-4">
      <h1 className="text-2xl font-bold text-foreground mb-2">My App</h1>
      <p className="text-muted-foreground">Ready to go.</p>
    </div>
  )
}
```

The color utilities (`text-foreground`, `text-primary`, `bg-muted`, etc.) reference CSS variables set by Petal's global theme, so your app's colours stay in sync with the host's theme automatically.

### CSS class isolation (`tailwindPrefix`)

If multiple custom apps share the DOM and both extend the same Tailwind utilities in conflicting ways, set a prefix in both the app's Tailwind config and in the Petal host's `petal.config.ts`:

```typescript
// my-app/tailwind.config.ts
export default {
  prefix: "myapp-",
  content: ["./src/**/*.{js,ts,jsx,tsx}", "./petal.hooks.ts"],
  // ...
}
```

```typescript
// petal.config.ts (in Petal Core)
apps: [{ name: "my-app", tailwindPrefix: "myapp-", url: "..." }]
```

Then use the prefixed classes in your components: `className="myapp-text-primary myapp-bg-muted"`.

This is optional for single-app deployments.

---

## Registering with a Petal host

### Auto-registration (recommended)

`petal create` auto-registers in `petal.apps.json` when it finds a Petal core directory nearby. No extra step needed.

### Manual registration

From the Petal core directory:

```bash
petal app add
#  App name:              my-app
#  Version:               0.1.0
#  Dev server URL:        http://localhost:5174/petal.hooks.js
#  Production bundle URL: https://cdn.example.com/my-app/petal.hooks.js
```

Refresh the browser — no server restart required.

### Manage registered apps

```bash
petal app list              # see all apps + URLs
petal app update my-app     # update version or URL
petal app remove my-app     # unregister
```

---

## Build for production

```bash
pnpm build
```

Output:

```
dist/
├── petal.hooks.js       ← minified ESM bundle
└── petal.hooks.css      ← compiled Tailwind CSS
```

Upload **both files** to the same directory on your CDN or server. They must be co-located because `on_init` derives the CSS URL from the JS URL by replacing the filename.

Then update the production URL:

```bash
# from petal core directory
petal app update my-app
# version: 1.0.0
# url: https://cdn.example.com/my-app/petal.hooks.js
```

Bump `version` on each release — Petal appends `?v=<version>` to bust the CDN cache automatically.

---

## Typecheck

```bash
pnpm typecheck      # tsc --noEmit
```

---

## Complete `vite.config.ts` reference

```ts
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "tailwindcss"
import autoprefixer from "autoprefixer"
import { resolve } from "path"

export default defineConfig({
  css: {
    postcss: { plugins: [tailwindcss(), autoprefixer()] },
  },
  plugins: [react()],
  build: {
    lib: {
      entry: resolve(__dirname, "petal.hooks.ts"),
      formats: ["es"],
      fileName: "petal.hooks",    // → petal.hooks.js + petal.hooks.css
    },
    rollupOptions: {
      // These are provided by the Petal host — do NOT bundle them
      external: ["react", "react/jsx-runtime", "react-dom", "@petal/sdk"],
    },
  },
  server:  { cors: true },
  preview: { cors: true, port: 5174 },   // petal dev reads this port
})
```

Keep `react`, `react-dom`, and `@petal/sdk` in `external` — the Petal host provides these via import maps. Bundling them would cause duplicate React instances.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Failed to fetch dynamically imported module` | Dev server not running — run `petal dev` |
| CSS not applied | Check `on_init` calls `injectStylesheet()`; verify `petal.hooks.css` was uploaded next to `.js` |
| Old bundle after deploy | Bump `version` in `petal.apps.json` |
| React errors about duplicate hooks | `react` / `react-dom` must be in `external` in vite.config.ts |
| `petal dev` picks wrong port | Add `preview: { port: 5174 }` to `vite.config.ts` |
| App blocked with red banner | `on_init` threw — check console for the error message |
| `@petal/sdk` types missing | Run `pnpm install`; check `devDependencies` has `@petal/sdk` |
| Shell doesn't reload after rebuild | Check `--shell` URL matches your Petal Core port; shell must be running in dev mode |
| CSS conflicts with another app | Add `tailwindPrefix` to your `tailwind.config.ts` and to the app entry in `petal.config.ts` |
