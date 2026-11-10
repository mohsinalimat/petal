/**
 * Translates neutral Petal API paths → internal Frappe paths.
 * Nothing Frappe-specific ever appears in the browser's network tab.
 *
 * Neutral path scheme:
 *   auth/login           → api/method/login
 *   auth/logout          → api/method/logout
 *   auth/me              → api/method/frappe.auth.get_logged_user
 *   auth/csrf            → (handled specially — see CSRF_PATH)
 *   workspace/sidebar    → api/method/frappe.desk.desktop.get_workspace_sidebar_items
 *   doc/:doctype[/:name] → api/resource/:doctype[/:name]
 *   records/count        → api/method/frappe.client.get_count
 *   records/value        → api/method/frappe.client.get_value
 *   records/list         → api/method/frappe.client.get_list
 *   records/meta         → api/method/frappe.client.get_meta
 *   search/link          → api/method/frappe.desk.search.search_link
 *   reports/run          → api/method/frappe.desk.query_report.run
 *   upload               → api/method/upload_file
 *   print/pdf            → api/method/frappe.utils.print_format.download_pdf
 *   exec/:method         → api/method/:method  (catch-all for callMethod())
 *   files/:rest          → files/:rest  (pass-through)
 */
export const EXACT_MAP: Record<string, string> = {
  "auth/login": "api/method/login",
  "auth/logout": "api/method/logout",
  "auth/me": "api/method/frappe.auth.get_logged_user",
  "auth/userinfo": "api/resource/User",
  "workspace/sidebar": "api/method/frappe.desk.desktop.get_workspace_sidebar_items",
  "workspace/page": "api/method/frappe.desk.desktop.get_desktop_page",
  "records/count": "api/method/frappe.client.get_count",
  "records/value": "api/method/frappe.client.get_value",
  "records/list": "api/method/frappe.client.get_list",
  "records/meta": "api/method/frappe.client.get_meta",
  "search/link": "api/method/frappe.desk.search.search_link",
  "reports/run": "api/method/frappe.desk.query_report.run",
  "upload": "api/method/upload_file",
  "print/pdf": "api/method/frappe.utils.print_format.download_pdf",
}

/**
 * Neutral path for fetching the session's CSRF token. Stock Frappe has no
 * whitelisted method that returns it, so unless `pathMap["auth/csrf"]` points
 * at one, the proxy reads it from the `/app` boot page (see extractCsrfToken).
 */
export const CSRF_PATH = "auth/csrf"

/**
 * Neutral path for Desk's boot data (session, user, defaults, app versions).
 * `frappe.sessions.get` isn't whitelisted, so like Desk the proxy reads it from
 * the `/app` page (see extractBootJson). Used by the Frappe-compatible runtime.
 */
export const BOOT_PATH = "auth/boot"

export function translatePath(neutralPath: string, pathMap: Record<string, string>): string {
  const mapped = pathMap[neutralPath]
  if (mapped) return mapped
  if (neutralPath.startsWith("doc/")) return "api/resource/" + neutralPath.slice("doc/".length)
  return neutralPath
}

/**
 * Frappe renders `frappe.csrf_token = "…";` into the desk boot page for
 * logged-in sessions. Returns null for guests (token is absent or "None").
 */
export function extractCsrfToken(html: string): string | null {
  const m = /csrf_token\s*=\s*["']([^"']+)["']/.exec(html)
  const token = m?.[1]
  if (!token || token === "None" || token.includes("{{")) return null
  return token
}

/** Rewrite asset/file URLs in Frappe's /printview HTML so they load through the proxy. */
export function rewritePrintHtml(html: string): string {
  return html
    .replace(/(href|src)="\/assets\//g, '$1="/api/v1/assets/')
    .replace(/(href|src)="\/files\//g, '$1="/api/v1/files/')
    .replace(/url\(\/assets\//g, "url(/api/v1/assets/")
    // Petal renders its own toolbar, and the preview runs no scripts (CSP), so
    // hide Frappe's toolbar (.action-banner in v15+, .print-toolbar before) and
    // apply in CSS the page-break/footer layout its inline script would set.
    .replace("</body>", "<style>"
      + ".print-toolbar,.action-banner,[data-html2canvas-ignore]{display:none!important}"
      + ".page-break{display:flex;flex-direction:column}"
      + "#footer-html{order:1;margin-top:20px}#footer-html.visible-pdf{display:block!important}"
      + "</style></body>")
}

/** Remove the Domain attribute so cookies scoped to the Frappe host stick to the proxy origin. */
export function stripCookieDomain(cookie: string): string {
  return cookie.replace(/;\s*domain=[^;]*/gi, "")
}


/**
 * The `frappe.boot = {...};` object Frappe renders into the desk page
 * (www/app.html), as a JSON string. Walks the object so braces inside strings
 * don't end it early. Returns null for guests (no boot on the login page).
 */
export function extractBootJson(html: string): string | null {
  const m = /frappe\.boot\s*=\s*\{/.exec(html)
  if (!m) return null
  const start = m.index + m[0].length - 1
  let depth = 0
  let inString = false
  for (let i = start; i < html.length; i++) {
    const c = html[i]
    if (inString) {
      if (c === "\\") i++
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === "{") depth++
    else if (c === "}" && --depth === 0) return html.slice(start, i + 1)
  }
  return null
}
