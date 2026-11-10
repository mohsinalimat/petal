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
// fetch() transparently decodes gzip/br/deflate bodies but keeps the upstream
// Content-Encoding and Content-Length headers. Forwarding them would make the
// browser try to decode an already-decoded body (ERR_CONTENT_DECODING_FAILED)
// whenever the backend — e.g. nginx in a bench production setup — compresses.
const DROP_RESPONSE_HEADERS = new Set([
  "connection", "transfer-encoding", "keep-alive", "content-encoding", "content-length",
])

/** Whitelisted Python method path, e.g. "frappe.client.get_list". Anything else could escape /api/method/. */
const METHOD_NAME = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/

/** Client-facing 502: details stay in server logs, never in the response (they reveal internal hosts). */
function badGateway(): NextResponse {
  return NextResponse.json({ error: "The backend could not be reached" }, { status: 502 })
}

const NULL_BODY_STATUSES = new Set([101, 204, 205, 304])

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

  // 304 (browser revalidating a cached image/asset), 204 etc. must not carry a
  // body — the Response constructor throws on one, which turned every cache
  // revalidation of /files/* into a 500 and a broken <img>.
  if (NULL_BODY_STATUSES.has(frappeRes.status)) {
    return new NextResponse(null, { status: frappeRes.status, headers: resHeaders })
  }
  const resBody = await frappeRes.arrayBuffer()
  return new NextResponse(resBody, { status: frappeRes.status, headers: resHeaders })
}

/** Network errors from fetch() keep the useful part (ECONNREFUSED host:port) in `cause`. */
function describeError(err: unknown): string {
  if (!(err instanceof Error)) return String(err)
  const cause = (err as Error & { cause?: unknown }).cause
  return cause ? `${err.message}: ${String(cause)}` : err.message
}

function getEffectivePathMap(req: NextRequest): Record<string, string> {
  const overrides = getRuntimeConfig().pathMap ?? {}
  return { ...EXACT_MAP, ...overrides, ...(getBackend(req)?.pathMap ?? {}) }
}

type RouteCtx = { params: Promise<{ path: string[] }> }

async function proxy(req: NextRequest, ctx: RouteCtx): Promise<NextResponse> {
  const params = await ctx.params
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
  // Raw bytes, never req.text(): multipart uploads carry binary data that a
  // UTF-8 decode/re-encode round trip silently corrupts.
  const body: ArrayBuffer | null = isReadOnly ? null : await req.arrayBuffer()

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
      return badGateway()
    }
  }

  if (neutralPath.startsWith("assets/")) {
    const target = `${frappeUrl}/${neutralPath}${search}`
    try {
      const frappeRes = await fetch(target, { headers: reqHeaders, redirect: "manual", cache: "no-store" })
      return buildResponse(frappeRes)
    } catch (err) {
      console.error("[Petal Proxy] asset fetch failed →", { target, cause: describeError(err) })
      return badGateway()
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
      return badGateway()
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
      return badGateway()
    }
  }

  // /exec — method name is in X-Method header, never in the URL
  if (neutralPath === "exec") {
    const method = req.headers.get("x-method")
    if (!method) return NextResponse.json({ error: "Missing X-Method header" }, { status: 400 })
    if (!METHOD_NAME.test(method)) return NextResponse.json({ error: "Invalid method name" }, { status: 400 })
    delete reqHeaders["x-method"]
    const target = `${frappeUrl}/api/method/${method}${search}`
    try {
      const frappeRes = await fetch(target, {
        method: "POST",
        headers: reqHeaders,
        redirect: "manual",
        cache: "no-store",
        body,
      })
      return buildResponse(frappeRes)
    } catch (err) {
      console.error("[Petal Proxy] exec failed →", { method, cause: describeError(err) })
      return badGateway()
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
    if (body) fetchInit.body = body

    const frappeRes = await fetch(target, fetchInit)
    // Frappe answers get_logged_user with 403 for guests. "Not logged in" is an
    // expected state for this session probe (login page, expired session), so
    // report it as the Guest user instead of a failed request in the console.
    if (neutralPath === "auth/me" && frappeRes.status === 403) {
      const upstream = await buildResponse(frappeRes)
      const res = NextResponse.json({ message: "Guest" }, { headers: { "Cache-Control": "no-store" } })
      // keep any cookie Frappe set (e.g. clearing an expired sid)
      upstream.headers.getSetCookie().forEach((c) => res.headers.append("Set-Cookie", c))
      return res
    }
    return buildResponse(frappeRes)

  } catch (err) {
    console.error("[Petal Proxy] fetch failed →", { target, host: frappeSiteHost, cause: describeError(err) })
    return badGateway()
  }
}

export async function GET(req: NextRequest, ctx: RouteCtx) { return proxy(req, ctx) }
export async function POST(req: NextRequest, ctx: RouteCtx) { return proxy(req, ctx) }
export async function PUT(req: NextRequest, ctx: RouteCtx) { return proxy(req, ctx) }
export async function DELETE(req: NextRequest, ctx: RouteCtx) { return proxy(req, ctx) }
export async function PATCH(req: NextRequest, ctx: RouteCtx) { return proxy(req, ctx) }
