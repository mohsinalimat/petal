import { mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import prompts from "prompts"
import pc from "picocolors"

export async function createApp(appName?: string): Promise<void> {
  const answers = await prompts(
    [
      {
        type: appName ? null : "text",
        name: "name",
        message: "App name:",
        initial: "my-petal-app",
        validate: (v: string) => (/^[a-z][a-z0-9-]*$/.test(v) ? true : "Use lowercase letters, numbers, hyphens"),
      },
      {
        type: "text",
        name: "description",
        message: "Description:",
        initial: "A Petal custom app",
      },
      {
        type: "text",
        name: "port",
        message: "Dev server port:",
        initial: "5174",
        validate: (v: string) => (/^\d{4,5}$/.test(v) ? true : "Enter a valid port number"),
      },
      {
        type: "confirm",
        name: "useLocal",
        message: "Using a local petal checkout? (uses file: SDK reference instead of npm)",
        initial: false,
      },
    ],
    { onCancel: () => process.exit(0) },
  )

  const name = appName ?? answers.name
  const port = answers.port ?? "5174"
  const dir = join(process.cwd(), name)

  const sdkRef = answers.useLocal
    ? `"file:../petal/packages/sdk"`
    : `"latest"`
  const sdkPkg = answers.useLocal ? `"file:../petal/packages/sdk"` : `"latest"`
  const uiPkg  = answers.useLocal ? `"file:../petal/packages/ui"`  : `"latest"`

  console.log(pc.green(`\n  Creating Petal app: ${pc.bold(name)}\n`))

  mkdirSync(join(dir, "src/hooks/forms"),   { recursive: true })
  mkdirSync(join(dir, "src/hooks"),         { recursive: true })
  mkdirSync(join(dir, "src/pages"),         { recursive: true })
  mkdirSync(join(dir, "src/utils"),         { recursive: true })

  // ── package.json ──────────────────────────────────────────────────────────
  writeFileSync(join(dir, "package.json"), JSON.stringify({
    name,
    version: "0.0.1",
    description: answers.description,
    type: "module",
    main: "./dist/petal.hooks.js",
    scripts: {
      build:     "vite build",
      dev:       `vite build && (vite build --watch & vite preview --port ${port} --host)`,
      serve:     `vite preview --port ${port} --host`,
      typecheck: "tsc --noEmit",
    },
    peerDependencies: {
      "@petal/sdk": "*",
      react: "^19.0.0",
      "react-dom": "^19.0.0",
    },
    devDependencies: {
      "@petal/sdk":          sdkPkg,
      "@petal/ui":           uiPkg,
      "@types/react":        "^19.0.0",
      "@types/react-dom":    "^19.0.0",
      "@types/node":         "^20.0.0",
      "@vitejs/plugin-react":"^4.0.0",
      autoprefixer:          "^10.4.0",
      tailwindcss:           "^3.4.0",
      typescript:            "^5.4.5",
      vite:                  "^5.0.0",
    },
  }, null, 2))

  // ── vite.config.ts ────────────────────────────────────────────────────────
  writeFileSync(join(dir, "vite.config.ts"),
`import { defineConfig } from "vite"
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
      fileName: "petal.hooks",
    },
    rollupOptions: {
      external: ["react", "react/jsx-runtime", "react-dom", "@petal/sdk"],
    },
  },
  server:  { cors: true },
  preview: { cors: true, port: ${port} },
})
`)

  // ── tailwind.config.ts ────────────────────────────────────────────────────
  writeFileSync(join(dir, "tailwind.config.ts"),
`import type { Config } from "tailwindcss"
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary:    "hsl(var(--primary))",
        "primary-foreground": "hsl(var(--primary-foreground))",
        muted:      "hsl(var(--muted))",
        "muted-foreground": "hsl(var(--muted-foreground))",
        border:     "hsl(var(--border))",
      },
    },
  },
  plugins: [],
}
export default config
`)

  // ── postcss.config.js ─────────────────────────────────────────────────────
  writeFileSync(join(dir, "postcss.config.js"),
`export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
}
`)

  // ── tsconfig.json ─────────────────────────────────────────────────────────
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify({
    compilerOptions: {
      target: "ES2020",
      module: "ESNext",
      moduleResolution: "bundler",
      jsx: "react-jsx",
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    },
    include: ["src", "petal.hooks.ts", "vite.config.ts", "tailwind.config.ts"],
    exclude: ["node_modules", "dist"],
  }, null, 2))

  // ── .gitignore ────────────────────────────────────────────────────────────
  writeFileSync(join(dir, ".gitignore"), "node_modules\ndist\n*.tsbuildinfo\n")

  // ── src/styles.css ────────────────────────────────────────────────────────
  writeFileSync(join(dir, "src/styles.css"),
`@tailwind base;
@tailwind components;
@tailwind utilities;
`)

  // ── src/utils/api.ts ──────────────────────────────────────────────────────
  writeFileSync(join(dir, "src/utils/api.ts"),
`function getCsrf(): string {
  const m = document.cookie.match(/csrftoken=([^;]+)/)
  return m ? m[1]! : ""
}

async function apiFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrf(), ...init.headers },
    ...init,
  })
  if (!res.ok) throw new Error(await res.text())
  const json = await res.json() as { data?: T; message?: T }
  return (json.data ?? json.message) as T
}

interface ListOptions {
  fields?: string[]
  filters?: unknown[]
  order_by?: string
  limit?: number
}

export const frappe = {
  getList<T>(doctype: string, opts: ListOptions = {}): Promise<T[]> {
    const params = new URLSearchParams({
      fields: JSON.stringify(opts.fields ?? ["name"]),
      ...(opts.filters ? { filters: JSON.stringify(opts.filters) } : {}),
      ...(opts.order_by ? { order_by: opts.order_by } : {}),
      limit_page_length: String(opts.limit ?? 20),
    })
    return apiFetch<T[]>(\`/api/resource/\${encodeURIComponent(doctype)}?\${params}\`)
  },

  getDoc<T>(doctype: string, name: string): Promise<T> {
    return apiFetch<T>(\`/api/resource/\${encodeURIComponent(doctype)}/\${encodeURIComponent(name)}\`)
  },

  createDoc<T>(doctype: string, data: Record<string, unknown>): Promise<T> {
    return apiFetch<T>(\`/api/resource/\${encodeURIComponent(doctype)}\`, {
      method: "POST", body: JSON.stringify(data),
    })
  },

  updateDoc<T>(doctype: string, name: string, data: Record<string, unknown>): Promise<T> {
    return apiFetch<T>(\`/api/resource/\${encodeURIComponent(doctype)}/\${encodeURIComponent(name)}\`, {
      method: "PUT", body: JSON.stringify(data),
    })
  },

  callMethod<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    return apiFetch<T>(\`/api/method/\${method}\`, {
      method: "POST", body: JSON.stringify(args),
    })
  },
}
`)

  // ── src/hooks/lifecycle.ts ────────────────────────────────────────────────
  writeFileSync(join(dir, "src/hooks/lifecycle.ts"),
`import type { PetalHooks } from "@petal/sdk"
import "../styles.css"

function injectStylesheet(): void {
  const scriptUrl = (document.currentScript as HTMLScriptElement | null)?.src
  if (!scriptUrl) return
  if (document.querySelector("link[data-${name}]")) return
  const link = document.createElement("link")
  link.rel = "stylesheet"
  link.href = scriptUrl.replace(/petal\\.hooks\\.js(\\?.*)?$/, "petal.hooks.css")
  link.setAttribute("data-${name}", "1")
  document.head.appendChild(link)
}

export const lifecycle: Pick<PetalHooks, "on_init" | "on_boot"> = {
  on_init: () => { injectStylesheet() },
  on_boot: async () => { /* post-auth setup */ },
}
`)

  // ── src/hooks/sidebar.ts ──────────────────────────────────────────────────
  writeFileSync(join(dir, "src/hooks/sidebar.ts"),
`import type { PetalHooks } from "@petal/sdk"

export const sidebar: Pick<PetalHooks, "sidebar_items" | "sidebar_order"> = {
  sidebar_items: [
    { label: "${name}", path: "/${name}", icon: "🌸" },
  ],
  sidebar_order: ["${name}"],
}
`)

  // ── src/hooks/forms/index.ts ──────────────────────────────────────────────
  writeFileSync(join(dir, "src/hooks/forms/index.ts"),
`import type { PetalHooks } from "@petal/sdk"

// Add form_field_behaviors here to add dynamic field logic to any Frappe DocType.
// Key = DocType name, value = function(doc) => { fieldname: FieldBehavior }
export const forms: Pick<PetalHooks, "form_field_behaviors"> = {
  form_field_behaviors: {},
}
`)

  // ── petal.hooks.ts ─────────────────────────────────────────────────────────
  writeFileSync(join(dir, "petal.hooks.ts"),
`import type { PetalHooks } from "@petal/sdk"
import { sidebar }   from "./src/hooks/sidebar"
import { forms }     from "./src/hooks/forms"
import { lifecycle } from "./src/hooks/lifecycle"

const hooks: PetalHooks = {
  ...sidebar,
  ...forms,
  ...lifecycle,
  routes: [
    { path: "/${name}", component: () => import("./src/pages/Home") },
  ],
}

export default hooks
`)

  // ── src/pages/Home.tsx ────────────────────────────────────────────────────
  writeFileSync(join(dir, "src/pages/Home.tsx"),
`export default function Home() {
  return (
    <div className="max-w-2xl mx-auto py-12 px-4">
      <h1 className="text-2xl font-bold text-foreground mb-2">${name}</h1>
      <p className="text-muted-foreground">Your custom Petal app is working.</p>
    </div>
  )
}
`)

  console.log(`  ${pc.green("✓")} Scaffolded ${pc.cyan(name)}\n`)
  console.log(pc.bold("  Next steps:\n"))
  console.log(`  ${pc.cyan("cd " + name)}`)
  console.log(`  ${pc.cyan("pnpm install")}`)
  console.log(`  ${pc.cyan("petal dev")}           ${pc.dim("# build + watch + serve on :" + port)}`)
  console.log()
  console.log(pc.dim("  Then register it in petal.config.ts:"))
  console.log(pc.dim(`  { name: "${name}", version: "0.0.1", devUrl: "http://localhost:${port}/petal.hooks.js", url: "https://..." }`))
  console.log(pc.dim("  Restart petal start after saving.\n"))
}
