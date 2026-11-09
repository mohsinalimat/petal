import { type NextRequest, NextResponse } from "next/server"
import { getRuntimeConfig } from "@/lib/config/runtime-config"
import { backendFor } from "@/lib/config/tenants"
import {
  BOOT_PATH, CSRF_PATH, EXACT_MAP, extractBootJson, extractCsrfToken, rewritePrintHtml, stripCookieDomain, translatePath,
} from "@/lib/frappe/proxy-paths"

/** Single-tenant backend, or the tenant's when PETAL_TENANTS is set (null = unknown host). */
function getBackend(req: NextRequest): { frappeUrl: string; frappeSiteHost: string; pathMap?: Record<string, string> } | null {
  const b = backendFor(req.headers, process.env)
  if (!b) return null
  return { frappeUrl: b.frappeUrl, frappeSiteHost: b.siteHost, ...(b.pathMap ? { pathMap: b.pathMap } : {}) }
}

const DROP_REQUEST_HEADERS = new Set([
  "host", "content-length", "connection", "transfer-encoding",
])
const DROP_RESPONSE_HEADERS = new Set([
  "connection", "transfer-encoding", "keep-alive",
])

async function buildResponse(frappeRes: Response): Promise<NextResponse> {
  const resHeaders = new Headers()
  frappeRes.headers.forEach((value, key) => {
    if (!DROP_RESPONSE_HEADERS.has(key.toLowerCase())) {
      resHeaders.set(key, value)
    }
  })

  const rawCookies: string[] =
    typeof (frappeRes.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie === "function"
      ? (frappeRes.headers as Headers & { getSetCookie: () => string[] }).getSetCookie()
      : (frappeRes.headers.get("set-cookie") ?? "").split(/,(?=[^ ])/).filter(Boolean)

  resHeaders.delete("set-cookie")
  rawCookies.forEach((cookie) => {
    // Only strip Domain: Frappe's cookie is scoped to its own origin, but the
    // browser only ever talks to this proxy's origin, so a foreign Domain
    // attribute would cause the browser to silently drop the cookie.
    // HttpOnly/SameSite/Secure are preserved as Frappe set them.
    resHeaders.append("Set-Cookie", stripCookieDomain(cookie))
  })

  const resBody = await frappeRes.arrayBuffer()
  return new NextResponse(resBody, { status: frappeRes.status, headers: resHeaders })
}

function getEffectivePathMap(req: NextRequest): Record<string, string> {
  const overrides = getRuntimeConfig().pathMap ?? {}
  return { ...EXACT_MAP, ...overrides, ...(getBackend(req)?.pathMap ?? {}) }
}

async function proxy(
  req: NextRequest,
  { params }: { params: { path: string[] } },
): Promise<NextResponse> {
  const backend = getBackend(req)
  if (!backend) return NextResponse.json({ error: "Unknown tenant" }, { status: 404 })
  const { frappeUrl, frappeSiteHost } = backend
  const neutralPath = params.path.join("/")
  const search = req.nextUrl.search

  const reqHeaders: Record<string, string> = {}
  req.headers.forEach((value, key) => {
    if (!DROP_REQUEST_HEADERS.has(key.toLowerCase())) {
      reqHeaders[key] = value
    }
  })
  reqHeaders["host"] = frappeSiteHost

  // Translate neutral CSRF header → what Frappe expects server-side
  if (reqHeaders["x-csrf-token"]) {
    reqHeaders["x-frappe-csrf-token"] = reqHeaders["x-csrf-token"]
    delete reqHeaders["x-csrf-token"]
  }

  const isReadOnly = req.method === "GET" || req.method === "HEAD"
  const bodyText: string | null = isReadOnly ? null : await req.text()

  // /printview — proxy Frappe's full print page, rewriting asset paths so
  // they resolve through this same proxy instead of the hidden Frappe origin.
  if (neutralPath === "printview") {
    const target = `${frappeUrl}/printview${search}`
    try {
      const frappeRes = await fetch(target, {
        headers: reqHeaders,
        redirect: "manual",
        cache: "no-store",
      })
      const html = rewritePrintHtml(await frappeRes.text())
      return new NextResponse(html, {
        status: frappeRes.status,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      })
    } catch (err) {
      console.error("[Petal Proxy] printview failed →", String(err))
      return NextResponse.json({ error: "Request failed" }, { status: 502 })
    }
  }

  if (neutralPath.startsWith("assets/")) {
    const target = `${frappeUrl}/${neutralPath}${search}`
    try {
      const frappeRes = await fetch(target, { headers: reqHeaders, redirect: "manual", cache: "no-store" })
      return buildResponse(frappeRes)
    } catch {
      return new NextResponse(null, { status: 502 })
    }
  }

  // auth/csrf — unless a pathMap entry names a method that returns the token,
  // scrape it from the desk boot page, which every Frappe version renders.
  if (neutralPath === CSRF_PATH && !getEffectivePathMap(req)[CSRF_PATH]) {
    try {
      const frappeRes = await fetch(`${frappeUrl}/app`, {
        headers: { cookie: reqHeaders["cookie"] ?? "", host: frappeSiteHost, accept: "text/html" },
        redirect: "manual",
        cache: "no-store",
      })
      const token = frappeRes.ok ? extractCsrfToken(await frappeRes.text()) : null
      return token
        ? NextResponse.json({ message: token })
        : NextResponse.json({ error: "No CSRF token — session is not logged in" }, { status: 401 })
    } catch (err) {
      console.error("[Petal Proxy] csrf fetch failed →", String(err))
      return NextResponse.json({ error: "Request failed" }, { status: 502 })
    }
  }

  // auth/boot — Desk's boot data, read from the desk page as Desk itself does
  // (frappe.sessions.get isn't whitelisted). For the Frappe-compatible runtime.
  if (neutralPath === BOOT_PATH) {
    try {
      const frappeRes = await fetch(`${frappeUrl}/app`, {
        headers: { cookie: reqHeaders["cookie"] ?? "", host: frappeSiteHost, accept: "text/html" },
        redirect: "manual",
        cache: "no-store",
      })
      const boot = frappeRes.ok ? extractBootJson(await frappeRes.text()) : null
      if (!boot) return NextResponse.json({ error: "No boot data — session is not logged in" }, { status: 401 })
      return new NextResponse(`{"message":${boot}}`, {
        status: 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      })
    } catch (err) {
      console.error("[Petal Proxy] boot fetch failed →", String(err))
      return NextResponse.json({ error: "Request failed" }, { status: 502 })
    }
  }

  // /exec — method name is in X-Method header, never in the URL
  if (neutralPath === "exec") {
    const method = req.headers.get("x-method")
    if (!method) return NextResponse.json({ error: "Missing X-Method header" }, { status: 400 })
    delete reqHeaders["x-method"]
    const target = `${frappeUrl}/api/method/${method}${search}`
    try {
      const frappeRes = await fetch(target, {
        method: "POST",
        headers: reqHeaders,
        redirect: "manual",
        cache: "no-store",
        body: bodyText ?? null,
      })
      return buildResponse(frappeRes)
    } catch (err) {
      console.error("[Petal Proxy] exec failed →", { method, cause: String(err) })
      return NextResponse.json({ error: "Request failed" }, { status: 502 })
    }
  }

  const frappe_path = translatePath(neutralPath, getEffectivePathMap(req))
  const target = `${frappeUrl}/${frappe_path}${search}`

  try {
    const fetchInit: RequestInit = {
      method: req.method,
      headers: reqHeaders,
      redirect: "manual",
      cache: "no-store",
    }
    if (!isReadOnly) fetchInit.body = bodyText

    const frappeRes = await fetch(target, fetchInit)
    return buildResponse(frappeRes)

  } catch (err) {
    const cause = err instanceof Error
      ? ((err as Error & { cause?: unknown }).cause ?? err.message)
      : String(err)
    console.error("[Petal Proxy] fetch failed →", { target, host: frappeSiteHost, cause })
    return NextResponse.json(
      { error: "Request failed", cause: String(cause) },
      { status: 502 },
    )
  }
}

export async function GET(req: NextRequest, ctx: { params: { path: string[] } }) { return proxy(req, ctx) }
export async function POST(req: NextRequest, ctx: { params: { path: string[] } }) { return proxy(req, ctx) }
export async function PUT(req: NextRequest, ctx: { params: { path: string[] } }) { return proxy(req, ctx) }
export async function DELETE(req: NextRequest, ctx: { params: { path: string[] } }) { return proxy(req, ctx) }
export async function PATCH(req: NextRequest, ctx: { params: { path: string[] } }) { return proxy(req, ctx) }
