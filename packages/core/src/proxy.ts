import { NextResponse, type NextRequest } from "next/server"
import { appOrigins, parseAppsEnv } from "@/lib/config/env-config"
import { backendFor } from "@/lib/config/tenants"

// Origins allowed to load remote app bundles (petal.hooks.js/.css), computed
// at server start in next.config.js from petal.config.ts + petal.apps.json.
const APP_ORIGINS = (process.env.PETAL_APP_ORIGINS ?? "").trim()

// PETAL_APPS / PETAL_TENANTS are read at runtime (they're not in next.config's
// `env`), so apps registered via the container environment are trusted
// without a rebuild.
function runtimeOrigins(req: NextRequest): string | null {
  const backend = backendFor(req.headers, process.env)
  if (!backend) return null
  const apps = backend.apps ?? parseAppsEnv(process.env.PETAL_APPS) ?? []
  return appOrigins(apps).join(" ")
}

function deskOrigin(): string | null {
  try { return process.env.NEXT_PUBLIC_PETAL_DESK_URL ? new URL(process.env.NEXT_PUBLIC_PETAL_DESK_URL).origin : null } catch { return null }
}

function randomNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  let binary = ""
  bytes.forEach((b) => (binary += String.fromCharCode(b)))
  return btoa(binary)
}

export function proxy(req: NextRequest) {
  const runtime = runtimeOrigins(req)
  if (runtime === null) {
    return new NextResponse("Unknown tenant", { status: 404, headers: { "Content-Type": "text/plain" } })
  }
  const nonce = randomNonce()

  const scriptSrc = [
    "'self'",
    `'nonce-${nonce}'`,
    // Frappe DocType "depends_on"/"read_only_depends_on" expressions are
    // evaluated via `new Function(...)` (see SectionBlock.tsx) — this mirrors
    // Frappe Desk's own client-side behavior for the same metadata.
    "'unsafe-eval'",
    APP_ORIGINS,
    runtime,
  ]
    .filter(Boolean)
    .join(" ")

  const csp = [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    // Inline `style="…"` attributes are pervasive (Tailwind + CSS custom
    // properties for theming); auditing them all to nonce/hash is out of scope.
    "style-src 'self' 'unsafe-inline'",
    // Image fields (Item.image, User.user_image, …) may hold any external URL,
    // as Desk allows — images can't execute, so any https/http source is fine.
    "img-src 'self' data: blob: https: http:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    // Desk embeds (frappe_compat.desk.embed) may frame only Desk's own origin.
    `frame-src ${["'self'", deskOrigin()].filter(Boolean).join(" ")}`,
    "frame-ancestors 'none'",
    "form-action 'self'",
  ].join("; ")

  // The print preview (PrintModal) frames Frappe's print page from this same
  // origin, so it must allow same-origin framing. Print formats are
  // user-authored HTML: no scripts run inside it (printing is driven from the
  // parent via contentWindow.print()).
  if (req.nextUrl.pathname === "/api/v1/printview") {
    const res = NextResponse.next()
    res.headers.set("Content-Security-Policy", [
      "default-src 'self'",
      "script-src 'none'",
      // Print Settings / Print Style may @import web fonts (e.g. Google Fonts)
      "style-src 'self' 'unsafe-inline' https:",
      "img-src 'self' data: blob: https: http:",
      "font-src 'self' data: https:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'none'",
      "frame-ancestors 'self'",
    ].join("; "))
    res.headers.set("X-Frame-Options", "SAMEORIGIN")
    res.headers.set("X-Content-Type-Options", "nosniff")
    res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
    return res
  }

  const requestHeaders = new Headers(req.headers)
  requestHeaders.set("x-nonce", nonce)

  const res = NextResponse.next({ request: { headers: requestHeaders } })
  res.headers.set("Content-Security-Policy", csp)
  res.headers.set("X-Frame-Options", "DENY")
  res.headers.set("X-Content-Type-Options", "nosniff")
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin")
  return res
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
}
