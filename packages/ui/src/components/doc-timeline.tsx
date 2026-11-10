"use client"

import * as React from "react"
import { useRef, useState } from "react"
import { cn } from "../lib/utils"
import { relativeTime } from "../lib/timeline"
import type { DocInfoAssignment, DocInfoAttachment, TimelineItem } from "../lib/timeline"

export type DocTimelineProps = {
  items: TimelineItem[]
  attachments?: DocInfoAttachment[]
  assignments?: DocInfoAssignment[]
  loading?: boolean
  currentUser?: string
  /** Maps a fieldname to its label for "changed X from A to B" lines. */
  fieldLabel?: (fieldname: string) => string
  onAddComment: (text: string) => Promise<void>
  onDeleteComment?: (id: string) => Promise<void>
  onUpload?: (file: File) => Promise<void>
  onRemoveAttachment?: (id: string) => Promise<void>
  onAssign?: (user: string) => Promise<void>
  onUnassign?: (user: string) => Promise<void>
  /** Render Assigned to / Attachments beside the activity (default). Pass false
   *  when the host renders <DocSidebar> elsewhere, e.g. next to the form. */
  showSidebar?: boolean
  className?: string
}

export type DocSidebarProps = {
  attachments?: DocInfoAttachment[]
  assignments?: DocInfoAssignment[]
  onUpload?: (file: File) => Promise<void>
  onRemoveAttachment?: (id: string) => Promise<void>
  onAssign?: (user: string) => Promise<void>
  onUnassign?: (user: string) => Promise<void>
  /** Extra sections appended below Attachments (e.g. document info). */
  children?: React.ReactNode
  className?: string
}

function fmt(v: unknown): string {
  if (v == null || v === "") return "empty"
  const s = typeof v === "object" ? JSON.stringify(v) : String(v)
  return s.length > 60 ? `${s.slice(0, 57)}…` : s
}

function Avatar({ user }: { user: string }) {
  const initials = user.split(/[@.\s_-]/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?"
  return (
    <span aria-hidden className="w-7 h-7 shrink-0 rounded-full bg-primary/10 text-primary text-[10px] font-semibold flex items-center justify-center">
      {initials}
    </span>
  )
}

export function DocTimeline({
  items, attachments = [], assignments = [], loading, currentUser, fieldLabel = (f) => f,
  onAddComment, onDeleteComment, onUpload, onRemoveAttachment, onAssign, onUnassign, showSidebar = true, className,
}: DocTimelineProps) {
  const [draft, setDraft] = useState("")
  const [posting, setPosting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null)
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong") } finally { setBusy(false) }
  }

  async function submitComment(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text) return
    setPosting(true); setError(null)
    try {
      await onAddComment(text)
      setDraft("")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not post comment")
    } finally {
      setPosting(false)
    }
  }

  return (
    <div className={cn(showSidebar && "grid gap-6 lg:grid-cols-[1fr_260px]", className)}>
      <section aria-label="Activity" className="space-y-4 min-w-0">
        <h2 className="text-sm font-semibold text-foreground">Activity</h2>
        <form onSubmit={submitComment} className="flex gap-2 items-start">
          {currentUser && <Avatar user={currentUser} />}
          <div className="flex-1 space-y-2">
            <textarea
              aria-label="Add a comment"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void submitComment(e) }}
              placeholder="Add a comment…"
              rows={2}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            {draft.trim() && (
              <button type="submit" disabled={posting} className="h-8 px-3 rounded-lg bg-primary text-primary-foreground text-sm font-medium disabled:opacity-60">
                {posting ? "Posting…" : "Comment"}
              </button>
            )}
          </div>
        </form>
        {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        {loading && <p className="text-sm text-muted-foreground">Loading activity…</p>}
        <ol className="space-y-3">
          {items.map((it) => (
            <li key={`${it.kind}-${it.id}`} className="flex gap-3 text-sm">
              <Avatar user={it.user} />
              <div className="min-w-0 flex-1">
                <p className="text-muted-foreground">
                  <span className="font-medium text-foreground">{it.user || "Someone"}</span>{" "}
                  {it.kind === "comment" && "commented"}
                  {it.kind === "created" && "created this document"}
                  {it.kind === "email" && <>sent an email{it.subject ? `: ${it.subject}` : ""}</>}
                  {it.kind === "activity" && it.text}
                  {it.kind === "change" && "made changes"}
                  <span className="text-muted-foreground/60"> · {relativeTime(it.at)}</span>
                </p>
                {it.kind === "comment" && (
                  <div className="mt-1 rounded-lg border border-border bg-muted/20 px-3 py-2 whitespace-pre-wrap break-words text-foreground">
                    {it.text}
                    {onDeleteComment && it.user === currentUser && (
                      <button
                        type="button"
                        onClick={() => void run(() => onDeleteComment(it.id))}
                        disabled={busy}
                        className="block mt-1 text-[11px] text-muted-foreground hover:text-red-600"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                )}
                {it.kind === "email" && it.text && (
                  <p className="mt-1 text-muted-foreground line-clamp-3 whitespace-pre-wrap">{it.text}</p>
                )}
                {it.kind === "change" && (
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {it.changes.slice(0, 6).map((c) => (
                      <li key={c.fieldname}>
                        <span className="font-medium text-foreground/80">{fieldLabel(c.fieldname)}</span>: {fmt(c.from)} → {fmt(c.to)}
                      </li>
                    ))}
                    {it.changes.length > 6 && <li>…and {it.changes.length - 6} more</li>}
                    {it.rowsAdded > 0 && <li>Added {it.rowsAdded} row{it.rowsAdded > 1 ? "s" : ""}</li>}
                    {it.rowsRemoved > 0 && <li>Removed {it.rowsRemoved} row{it.rowsRemoved > 1 ? "s" : ""}</li>}
                  </ul>
                )}
              </div>
            </li>
          ))}
        </ol>
      </section>

      {showSidebar && (
        <DocSidebar
          attachments={attachments}
          assignments={assignments}
          {...(onUpload ? { onUpload } : {})}
          {...(onRemoveAttachment ? { onRemoveAttachment } : {})}
          {...(onAssign ? { onAssign } : {})}
          {...(onUnassign ? { onUnassign } : {})}
        />
      )}
    </div>
  )
}

/** Assignments and attachments for a document — beside the timeline or the form. */
export function DocSidebar({
  attachments = [], assignments = [], onUpload, onRemoveAttachment, onAssign, onUnassign, children, className,
}: DocSidebarProps) {
  const [assignee, setAssignee] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function run(fn: () => Promise<void>) {
    setBusy(true); setError(null)
    try { await fn() } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong") } finally { setBusy(false) }
  }

  return (
      <aside className={cn("space-y-6", className)}>
        <section aria-label="Assigned to" className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Assigned to</h3>
          {assignments.length === 0 && <p className="text-xs text-muted-foreground/70">Nobody</p>}
          <ul className="space-y-1">
            {assignments.map((a) => (
              <li key={a.name} className="flex items-center gap-2 text-sm">
                <Avatar user={a.owner} />
                <span className="truncate flex-1">{a.owner}</span>
                {onUnassign && (
                  <button type="button" aria-label={`Unassign ${a.owner}`} disabled={busy} onClick={() => void run(() => onUnassign(a.owner))} className="text-muted-foreground hover:text-red-600 text-xs">✕</button>
                )}
              </li>
            ))}
          </ul>
          {onAssign && (
            <form
              onSubmit={(e) => { e.preventDefault(); const u = assignee.trim(); if (u) void run(async () => { await onAssign(u); setAssignee("") }) }}
              className="flex gap-1"
            >
              <input
                aria-label="Assign to user"
                value={assignee}
                onChange={(e) => setAssignee(e.target.value)}
                placeholder="user@example.com"
                className="flex-1 min-w-0 h-8 rounded-lg border border-border bg-background px-2 text-xs"
              />
              <button type="submit" disabled={busy || !assignee.trim()} className="h-8 px-2 rounded-lg border border-border text-xs hover:bg-accent disabled:opacity-50">Add</button>
            </form>
          )}
        </section>

        <section aria-label="Attachments" className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Attachments</h3>
          {attachments.length === 0 && <p className="text-xs text-muted-foreground/70">No files</p>}
          <ul className="space-y-1">
            {attachments.map((f) => (
              <li key={f.name} className="flex items-center gap-2 text-sm">
                <a href={f.file_url} target="_blank" rel="noopener noreferrer" className="truncate flex-1 text-primary hover:underline">
                  {f.file_name || f.file_url.split("/").pop()}
                </a>
                {f.is_private === 1 && <span className="text-[10px] text-muted-foreground">private</span>}
                {onRemoveAttachment && (
                  <button type="button" aria-label={`Remove ${f.file_name ?? f.name}`} disabled={busy} onClick={() => void run(() => onRemoveAttachment(f.name))} className="text-muted-foreground hover:text-red-600 text-xs">✕</button>
                )}
              </li>
            ))}
          </ul>
          {onUpload && (
            <>
              <input
                ref={fileRef}
                type="file"
                className="hidden"
                aria-label="Attach file"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) void run(() => onUpload(file)).finally(() => { if (fileRef.current) fileRef.current.value = "" })
                }}
              />
              <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="h-8 px-3 rounded-lg border border-border text-xs hover:bg-accent disabled:opacity-50">
                + Attach file
              </button>
            </>
          )}
        </section>
        {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        {children}
      </aside>
  )
}
