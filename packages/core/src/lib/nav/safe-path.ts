const BASE = "http://petal.invalid"

/**
 * Returns `value` as a same-origin path ("/list/Item?x=1") when it is safe to
 * navigate to, otherwise null. Used for redirect targets that arrive in the URL
 * (e.g. `?returnTo=`), which an attacker controls: absolute URLs, protocol-
 * relative "//host", backslash tricks ("/\host") and non-http schemes are all
 * rejected, so a crafted link can't send the user off-site after an action.
 */
export function safeInternalPath(value: string | null | undefined): string | null {
  if (!value) return null
  // Browsers strip tabs/newlines inside URLs and treat "\" like "/", so
  // "/\tevil.com" or "/\\evil.com" would otherwise become "//evil.com".
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return null
  if (!value.startsWith("/") || value.startsWith("//")) return null
  let url: URL
  try {
    url = new URL(value, BASE)
  } catch {
    return null
  }
  if (url.origin !== BASE) return null
  return url.pathname + url.search + url.hash
}
