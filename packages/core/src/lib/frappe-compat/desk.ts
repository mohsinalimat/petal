/**
 * Links into Frappe Desk for screens Petal hands off (frappe_compat.desk).
 * Desk's address comes from NEXT_PUBLIC_PETAL_DESK_URL, e.g.
 * "https://erp.example.com"; without it there is nowhere to send the user.
 */
export function deskBaseUrl(env: Record<string, string | undefined> = { NEXT_PUBLIC_PETAL_DESK_URL: process.env.NEXT_PUBLIC_PETAL_DESK_URL }): string | null {
  const raw = (env.NEXT_PUBLIC_PETAL_DESK_URL ?? "").trim()
  if (!raw) return null
  try {
    const u = new URL(raw)
    if (u.protocol !== "https:" && u.protocol !== "http:") return null
    return u.origin + u.pathname.replace(/\/+$/, "")
  } catch {
    return null
  }
}

/** Desk's route slug for a doctype ("Sales Invoice" → "sales-invoice"). */
export const deskSlug = (doctype: string) => doctype.toLowerCase().replace(/ /g, "-")

export function deskFormUrl(base: string, doctype: string, name: string): string {
  return `${base}/app/${encodeURIComponent(deskSlug(doctype))}/${name === "new" ? "new" : encodeURIComponent(name)}`
}

export function deskPageUrl(base: string, page: string): string {
  return `${base}/app/${encodeURIComponent(page)}`
}
