// Normalizes Frappe's `docinfo` (frappe.desk.form.load.get_docinfo) into a
// single, newest-first activity timeline.

export type DocInfoComment = { name: string; owner: string; creation: string; content?: string; comment_type?: string }
export type DocInfoVersion = { name: string; owner: string; creation: string; data: string | Record<string, unknown> }
export type DocInfoAttachment = { name: string; file_name?: string; file_url: string; is_private?: 0 | 1 }
export type DocInfoAssignment = { name: string; owner: string; description?: string; status?: string }

export type DocInfo = {
  comments?: DocInfoComment[]
  versions?: DocInfoVersion[]
  attachments?: DocInfoAttachment[]
  assignments?: DocInfoAssignment[]
  communications?: Array<{ name: string; owner?: string; sender?: string; creation: string; subject?: string; content?: string }>
  assignment_logs?: DocInfoComment[]
  attachment_logs?: DocInfoComment[]
  info_logs?: DocInfoComment[]
  workflow_logs?: DocInfoComment[]
  like_logs?: DocInfoComment[]
}

export type FieldChange = { fieldname: string; from: unknown; to: unknown }

export type TimelineItem =
  | { kind: "comment"; id: string; user: string; at: string; text: string }
  | { kind: "change"; id: string; user: string; at: string; changes: FieldChange[]; rowsAdded: number; rowsRemoved: number }
  | { kind: "activity"; id: string; user: string; at: string; text: string }
  | { kind: "email"; id: string; user: string; at: string; text: string; subject: string }
  | { kind: "created"; id: string; user: string; at: string }

/** Strip HTML to plain text (comment bodies are stored as HTML). */
export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

/** Escape plain text for submission as a Frappe comment (stored as HTML). */
export function textToCommentHtml(text: string): string {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  return esc.split("\n").map((l) => `<p>${l || "<br>"}</p>`).join("")
}

export function parseVersion(data: DocInfoVersion["data"]): { changes: FieldChange[]; rowsAdded: number; rowsRemoved: number } {
  let obj: Record<string, unknown>
  try {
    obj = typeof data === "string" ? (JSON.parse(data) as Record<string, unknown>) : data
  } catch {
    return { changes: [], rowsAdded: 0, rowsRemoved: 0 }
  }
  const changed = Array.isArray(obj.changed) ? (obj.changed as unknown[][]) : []
  return {
    changes: changed
      .filter((c) => Array.isArray(c) && typeof c[0] === "string")
      .map((c) => ({ fieldname: c[0] as string, from: c[1], to: c[2] })),
    rowsAdded: Array.isArray(obj.added) ? obj.added.length : 0,
    rowsRemoved: Array.isArray(obj.removed) ? obj.removed.length : 0,
  }
}

/** Frappe datetimes are "YYYY-MM-DD HH:MM:SS(.ffffff)"; compare lexically after normalizing. */
function sortKey(at: string): string {
  return at.replace("T", " ")
}

export function buildTimeline(
  info: DocInfo,
  doc?: { owner?: unknown; creation?: unknown },
): TimelineItem[] {
  const items: TimelineItem[] = []

  for (const c of info.comments ?? []) {
    if (c.comment_type && c.comment_type !== "Comment") continue
    items.push({ kind: "comment", id: c.name, user: c.owner, at: c.creation, text: htmlToText(c.content ?? "") })
  }
  for (const v of info.versions ?? []) {
    const parsed = parseVersion(v.data)
    if (!parsed.changes.length && !parsed.rowsAdded && !parsed.rowsRemoved) continue
    items.push({ kind: "change", id: v.name, user: v.owner, at: v.creation, ...parsed })
  }
  const logs = [
    ...(info.assignment_logs ?? []), ...(info.attachment_logs ?? []),
    ...(info.info_logs ?? []), ...(info.workflow_logs ?? []), ...(info.like_logs ?? []),
  ]
  for (const l of logs) {
    items.push({ kind: "activity", id: l.name, user: l.owner, at: l.creation, text: htmlToText(l.content ?? l.comment_type ?? "") })
  }
  for (const e of info.communications ?? []) {
    items.push({
      kind: "email", id: e.name, user: e.sender ?? e.owner ?? "", at: e.creation,
      subject: e.subject ?? "", text: htmlToText(e.content ?? ""),
    })
  }
  if (doc && typeof doc.creation === "string") {
    items.push({ kind: "created", id: "__created__", user: String(doc.owner ?? ""), at: doc.creation })
  }

  return items.sort((a, b) => (sortKey(a.at) < sortKey(b.at) ? 1 : sortKey(a.at) > sortKey(b.at) ? -1 : 0))
}

/** "3 min ago", "2 days ago", or a short date for anything older than ~30 days. */
export function relativeTime(at: string, now = new Date()): string {
  const d = new Date(at.replace(" ", "T"))
  if (isNaN(d.getTime())) return at
  const s = Math.round((now.getTime() - d.getTime()) / 1000)
  if (s < 45) return "just now"
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hour${h === 1 ? "" : "s"} ago`
  const days = Math.round(h / 24)
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
}
