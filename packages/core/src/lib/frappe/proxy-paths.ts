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
}

/**
 * Neutral path for fetching the session's CSRF token. Stock Frappe has no
 * whitelisted method that returns it, so unless `pathMap["auth/csrf"]` points
 * at one, the proxy reads it from the `/app` boot page (see extractCsrfToken).
 */
export const CSRF_PATH = "auth/csrf"

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
    // Hide Frappe's built-in toolbar — Petal renders its own
    .replace("</body>", "<style>.print-toolbar,[data-html2canvas-ignore]{display:none!important}</style></body>")
}

/** Remove the Domain attribute so cookies scoped to the Frappe host stick to the proxy origin. */
export function stripCookieDomain(cookie: string): string {
  return cookie.replace(/;\s*domain=[^;]*/gi, "")
}
