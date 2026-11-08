// API Playground request model: validation, code snippets and history.

export type PlaygroundRequest =
  | { kind: "method"; method: string; args: string }
  | { kind: "get_doc"; doctype: string; name: string }
  | { kind: "get_list"; doctype: string; fields: string; filters: string; limit: number }

export type HistoryEntry = PlaygroundRequest & { at: number; ok: boolean; ms: number }

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

const METHOD_RE = /^[A-Za-z_][\w]*(\.[A-Za-z_][\w]*)+$/

/** Parse a JSON object argument. Empty input means `{}`. */
export function parseJsonObject(text: string): Parsed<Record<string, unknown>> {
  if (!text.trim()) return { ok: true, value: {} }
  try {
    const v = JSON.parse(text) as unknown
    if (v === null || typeof v !== "object" || Array.isArray(v)) return { ok: false, error: "Arguments must be a JSON object, e.g. {\"doctype\": \"User\"}" }
    return { ok: true, value: v as Record<string, unknown> }
  } catch (e) {
    return { ok: false, error: `Invalid JSON: ${(e as Error).message}` }
  }
}

export function parseJsonArray(text: string, label: string): Parsed<unknown[]> {
  if (!text.trim()) return { ok: true, value: [] }
  try {
    const v = JSON.parse(text) as unknown
    if (!Array.isArray(v)) return { ok: false, error: `${label} must be a JSON array` }
    return { ok: true, value: v }
  } catch (e) {
    return { ok: false, error: `${label}: invalid JSON (${(e as Error).message})` }
  }
}

/** Returns an error message, or null when the request can be sent. */
export function validateRequest(req: PlaygroundRequest): string | null {
  switch (req.kind) {
    case "method":
    {
      if (!METHOD_RE.test(req.method.trim())) return "Method must be a dotted path, e.g. frappe.client.get_count"
      const args = parseJsonObject(req.args)
      return args.ok ? null : args.error
    }
    case "get_doc":
      if (!req.doctype.trim()) return "DocType is required"
      if (!req.name.trim()) return "Document name is required"
      return null
    case "get_list": {
      if (!req.doctype.trim()) return "DocType is required"
      const f = parseJsonArray(req.fields, "Fields")
      if (!f.ok) return f.error
      const flt = parseJsonArray(req.filters, "Filters")
      if (!flt.ok) return flt.error
      if (!Number.isInteger(req.limit) || req.limit < 1 || req.limit > 500) return "Limit must be between 1 and 500"
      return null
    }
  }
}

/** JS snippet using Petal's Frappe client, for pasting into a custom app. */
export function toClientSnippet(req: PlaygroundRequest): string {
  switch (req.kind) {
    case "method": {
      const args = parseJsonObject(req.args)
      const argStr = args.ok && Object.keys(args.value).length ? `, ${JSON.stringify(args.value, null, 2)}` : ""
      return `await frappe.callMethod(${JSON.stringify(req.method.trim())}${argStr})`
    }
    case "get_doc":
      return `await frappe.getDoc(${JSON.stringify(req.doctype)}, ${JSON.stringify(req.name)})`
    case "get_list": {
      const fields = parseJsonArray(req.fields, "")
      const filters = parseJsonArray(req.filters, "")
      return `await frappe.getList(${JSON.stringify({
        doctype: req.doctype,
        fields: fields.ok && fields.value.length ? fields.value : ["name"],
        filters: filters.ok ? filters.value : [],
        limit: req.limit,
      }, null, 2)})`
    }
  }
}

/** curl against Frappe directly with API-key auth (for scripts outside the browser). */
export function toCurlSnippet(req: PlaygroundRequest, backendUrl: string): string {
  const base = backendUrl.replace(/\/$/, "")
  const auth = `-H "Authorization: token <api_key>:<api_secret>"`
  switch (req.kind) {
    case "method": {
      const args = parseJsonObject(req.args)
      const body = args.ok ? JSON.stringify(args.value) : "{}"
      return `curl -X POST "${base}/api/method/${req.method.trim()}" \\\n  ${auth} \\\n  -H "Content-Type: application/json" \\\n  -d '${body.replace(/'/g, "'\\''")}'`
    }
    case "get_doc":
      return `curl "${base}/api/resource/${encodeURIComponent(req.doctype)}/${encodeURIComponent(req.name)}" \\\n  ${auth}`
    case "get_list": {
      const qs = new URLSearchParams({
        fields: req.fields.trim() || '["name"]',
        filters: req.filters.trim() || "[]",
        limit_page_length: String(req.limit),
      })
      return `curl "${base}/api/resource/${encodeURIComponent(req.doctype)}?${qs}" \\\n  ${auth}`
    }
  }
}

function sameRequest(a: PlaygroundRequest, b: PlaygroundRequest): boolean {
  const strip = ({ at: _a, ok: _o, ms: _m, ...r }: Partial<HistoryEntry> & PlaygroundRequest) => r
  return JSON.stringify(strip(a as HistoryEntry)) === JSON.stringify(strip(b as HistoryEntry))
}

/** Prepend `entry`, dropping an identical earlier request and capping length. */
export function pushHistory(history: HistoryEntry[], entry: HistoryEntry, max = 20): HistoryEntry[] {
  return [entry, ...history.filter((h) => !sameRequest(h, entry))].slice(0, max)
}

export function describeRequest(req: PlaygroundRequest): string {
  switch (req.kind) {
    case "method": return req.method
    case "get_doc": return `GET ${req.doctype}/${req.name}`
    case "get_list": return `LIST ${req.doctype}`
  }
}
