"use client"
/**
 * Renders HTML produced by Frappe (msgprint, intros, headlines) after removing
 * scripts, styles, SVG animations, event handlers and any URL that isn't
 * http(s), mailto, tel, relative or an inline image. Desk links are rewritten to
 * Petal routes by CompatHost's click handler.
 */
import { useMemo } from "react"
import { cn } from "@petal/ui"

const DROP = new Set([
  "script", "iframe", "frame", "frameset", "object", "embed", "applet", "link", "meta", "base", "form",
  "style", "template", "noscript", "animate", "animatemotion", "animatetransform", "set", "foreignobject",
  "handler", "listener", "math",
])
/** Attributes that carry a URL the browser may navigate to or load. */
const URL_ATTRS = new Set(["href", "src", "xlink:href", "action", "formaction", "poster", "background", "data", "srcset", "ping", "lowsrc", "dynsrc"])
const SAFE_URL = /^(?:https?:|mailto:|tel:|#|\/|\.|\?|[^:]*$)/i
const SAFE_DATA_IMG = /^data:image\/(?:png|gif|jpe?g|webp|bmp);/i

/**
 * Browsers ignore ASCII control characters and whitespace anywhere in a URL
 * scheme ("java\tscript:" runs as "javascript:"), so strip them before testing.
 */
function isSafeUrl(value: string, attr: string): boolean {
  const v = value.replace(/[\u0000-\u0020\u007f-\u00a0\u1680\u180e\u2000-\u2029\u205f\u3000\ufeff]/g, "")
  if (attr === "srcset") return v.split(",").every((part) => isSafeUrl(part.trim().split(" ")[0] ?? "", "src"))
  if (SAFE_URL.test(v)) return true
  return attr === "src" && SAFE_DATA_IMG.test(v)
}

export function sanitizeHtml(html: string): string {
  if (typeof window === "undefined" || typeof DOMParser === "undefined") return html.replace(/<[^>]*>/g, "")
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html")
  const root = doc.body.firstElementChild
  if (!root) return ""
  const walk = (el: Element) => {
    for (const child of Array.from(el.children)) {
      const tag = child.localName.toLowerCase()
      if (DROP.has(tag)) { child.remove(); continue }
      for (const attr of Array.from(child.attributes)) {
        const name = attr.name.toLowerCase()
        if (name.startsWith("on") || (name === "style" && /expression\s*\(|url\s*\(\s*['"]?\s*javascript:/i.test(attr.value))) {
          child.removeAttribute(attr.name)
        } else if ((URL_ATTRS.has(name) || name.endsWith(":href")) && !isSafeUrl(attr.value, name)) {
          child.removeAttribute(attr.name)
        }
      }
      walk(child)
    }
  }
  walk(root)
  return root.innerHTML
}

export function FrappeHtml({ html, className }: { html: string; className?: string }) {
  const clean = useMemo(() => sanitizeHtml(html ?? ""), [html])
  return <div className={cn("petal-frappe-html", className)} dangerouslySetInnerHTML={{ __html: clean }} />
}

const COLORS: Record<string, { dot: string; banner: string; pill: string }> = {
  blue: { dot: "bg-blue-500", banner: "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-200", pill: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-900" },
  green: { dot: "bg-green-500", banner: "border-green-200 bg-green-50 text-green-900 dark:border-green-900/60 dark:bg-green-950/30 dark:text-green-200", pill: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-300 dark:border-green-900" },
  red: { dot: "bg-red-500", banner: "border-red-200 bg-red-50 text-red-900 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200", pill: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-900" },
  orange: { dot: "bg-orange-500", banner: "border-orange-200 bg-orange-50 text-orange-900 dark:border-orange-900/60 dark:bg-orange-950/30 dark:text-orange-200", pill: "bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-900" },
  yellow: { dot: "bg-yellow-500", banner: "border-yellow-200 bg-yellow-50 text-yellow-900 dark:border-yellow-900/60 dark:bg-yellow-950/30 dark:text-yellow-200", pill: "bg-yellow-50 text-yellow-800 border-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-300 dark:border-yellow-900" },
  purple: { dot: "bg-purple-500", banner: "border-purple-200 bg-purple-50 text-purple-900 dark:border-purple-900/60 dark:bg-purple-950/30 dark:text-purple-200", pill: "bg-purple-50 text-purple-700 border-purple-200 dark:bg-purple-950/40 dark:text-purple-300 dark:border-purple-900" },
  gray: { dot: "bg-gray-400", banner: "border-border bg-muted/40 text-foreground", pill: "bg-muted text-muted-foreground border-border" },
}
const ALIASES: Record<string, string> = { grey: "gray", darkgrey: "gray", "light-blue": "blue", cyan: "blue", pink: "purple", black: "gray", "light-gray": "gray" }

/** Tailwind classes for a Frappe indicator colour name. */
export function indicatorClass(color: string | undefined, kind: "dot" | "banner" | "pill"): string {
  const key = ALIASES[color ?? ""] ?? color ?? "gray"
  return (COLORS[key] ?? COLORS.gray!)[kind]
}
