"use client"

import Link from "next/link"
import { ApiPlayground } from "./ApiPlayground"

const DOC_LINKS = [
  { href: "/petal-docs#custom-apps", title: "Getting Started", desc: "Build and register a Petal custom app" },
  { href: "/petal-docs#hooks-reference", title: "Hooks Reference", desc: "Every PetalHooks extension point" },
  { href: "/petal-docs#frappe-client", title: "Frappe Client API", desc: "getDoc, getList, callMethod and friends" },
]

export default function DeveloperPage() {
  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-1">Developer Center</h1>
        <p className="text-muted-foreground">Build and extend Petal applications</p>
      </section>

      <section aria-labelledby="playground-heading" className="space-y-3">
        <div>
          <h2 id="playground-heading" className="text-lg font-semibold text-foreground">API Playground</h2>
          <p className="text-sm text-muted-foreground">
            Calls run as you, through Petal&apos;s proxy — the same path custom apps use.
          </p>
        </div>
        <ApiPlayground />
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border border-border bg-card rounded-xl p-5 sm:p-6">
          <h2 className="text-base font-semibold mb-3 text-foreground">Documentation</h2>
          <div className="space-y-2">
            {DOC_LINKS.map((l) => (
              <Link key={l.href} href={l.href} className="block p-3 bg-primary/5 rounded-lg hover:bg-primary/10 transition-colors">
                <span className="block font-medium text-primary">{l.title}</span>
                <span className="block text-sm text-muted-foreground">{l.desc}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="border border-border bg-card rounded-xl p-5 sm:p-6">
          <h2 className="text-base font-semibold mb-3 text-foreground">Quick Links</h2>
          <div className="space-y-2">
            <Link href="/settings" className="block p-3 bg-accent/40 rounded-lg hover:bg-accent transition-colors">
              <span className="block font-medium text-foreground">Settings</span>
              <span className="block text-sm text-muted-foreground">Configure your applications</span>
            </Link>
            <Link href="/apps" className="block p-3 bg-accent/40 rounded-lg hover:bg-accent transition-colors">
              <span className="block font-medium text-foreground">Installed Apps</span>
              <span className="block text-sm text-muted-foreground">Custom apps loaded into this shell</span>
            </Link>
            {process.env.NEXT_PUBLIC_FRAPPE_BACKEND_URL && (
              <a
                href={process.env.NEXT_PUBLIC_FRAPPE_BACKEND_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="block p-3 bg-accent/40 rounded-lg hover:bg-accent transition-colors"
              >
                <span className="block font-medium text-foreground">Frappe Backend</span>
                <span className="block text-sm text-muted-foreground">Open your Frappe instance</span>
              </a>
            )}
          </div>
        </div>
      </section>

      <section className="border border-border bg-card rounded-xl p-5 sm:p-6">
        <h2 className="text-base font-semibold mb-3 text-foreground">Create Your First App</h2>
        <pre className="bg-muted/40 border border-border p-4 rounded-lg overflow-x-auto text-sm text-foreground">
{`petal create my-app     # scaffold + auto-register
cd my-app && petal dev  # build, watch and serve

// src/hooks.ts
import type { PetalHooks } from "@petal/sdk"

const hooks: PetalHooks = {
  sidebar_items: [{ label: "My App", path: "/my-app", icon: "dashboard" }],
  routes: [{ path: "/my-app", component: () => import("./pages/Home") }],
}

export default hooks`}
        </pre>
      </section>
    </div>
  )
}
