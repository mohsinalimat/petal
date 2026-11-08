"use client"

import * as React from "react"
import { useEffect, useMemo, useState } from "react"
import { cn } from "../lib/utils"
import { buildColumns, moveCard, UNSET_COLUMN } from "../lib/kanban"
import type { KanbanColumn, KanbanField } from "../lib/kanban"

export type KanbanBoardProps = {
  rows: Record<string, unknown>[]
  groupField: KanbanField
  titleField: string
  /** Extra fields shown on each card (fieldname + label). */
  cardFields?: { fieldname: string; label: string }[]
  onCardClick: (name: string) => void
  /** Persist a move. Reject to roll the card back. */
  onMove: (name: string, value: string) => Promise<void>
  /** Columns the user is not allowed to drop into (e.g. read-only states). */
  lockedValues?: string[]
  className?: string
}

/**
 * Drag-and-drop board. HTML5 DnD on desktop; every card also has a "Move to"
 * select so the board works on touch devices and with the keyboard.
 */
export function KanbanBoard({
  rows, groupField, titleField, cardFields = [], onCardClick, onMove, lockedValues = [], className,
}: KanbanBoardProps) {
  const initial = useMemo(() => buildColumns(rows, groupField), [rows, groupField])
  const [columns, setColumns] = useState<KanbanColumn[]>(initial)
  const [dragName, setDragName] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Set<string>>(new Set())

  useEffect(() => setColumns(initial), [initial])

  const locked = useMemo(() => new Set(lockedValues), [lockedValues])
  const targets = columns.filter((c) => c.value !== UNSET_COLUMN && !locked.has(c.value))

  async function move(name: string, toValue: string) {
    const from = columns.find((c) => c.rows.some((r) => r.name === name))
    if (!from || from.value === toValue || locked.has(toValue)) return
    const snapshot = columns
    setColumns((cols) => moveCard(cols, name, toValue, groupField.fieldname))
    setPending((p) => new Set(p).add(name))
    setError(null)
    try {
      await onMove(name, toValue === UNSET_COLUMN ? "" : toValue)
    } catch (e) {
      setColumns(snapshot)
      setError(e instanceof Error ? e.message : "Could not move card")
    } finally {
      setPending((p) => { const n = new Set(p); n.delete(name); return n })
    }
  }

  return (
    <div className={cn("space-y-2", className)}>
      {error && (
        <div role="alert" className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
          {error}
        </div>
      )}
      <div className="flex gap-3 overflow-x-auto pb-3 snap-x snap-mandatory md:snap-none">
        {columns.map((col) => (
          <section
            key={col.value}
            aria-label={col.label}
            onDragOver={(e) => { if (dragName && !locked.has(col.value)) { e.preventDefault(); setOverCol(col.value) } }}
            onDragLeave={() => setOverCol((v) => (v === col.value ? null : v))}
            onDrop={(e) => {
              e.preventDefault()
              setOverCol(null)
              const name = e.dataTransfer.getData("text/plain") || dragName
              if (name) void move(name, col.value)
            }}
            className={cn(
              "snap-start shrink-0 w-[85vw] sm:w-72 rounded-xl border bg-muted/20 flex flex-col max-h-[70vh]",
              overCol === col.value ? "border-primary bg-primary/5" : "border-border",
            )}
          >
            <header className="flex items-center justify-between px-3 py-2.5 border-b border-border/60">
              <h3 className="text-sm font-semibold text-foreground truncate">{col.label}</h3>
              <span className="text-xs tabular-nums text-muted-foreground bg-background border border-border rounded-full px-2 py-0.5">
                {col.rows.length}
              </span>
            </header>
            <ul className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[80px]">
              {col.rows.map((row) => {
                const name = String(row.name)
                return (
                  <li
                    key={name}
                    draggable
                    onDragStart={(e) => { e.dataTransfer.setData("text/plain", name); setDragName(name) }}
                    onDragEnd={() => setDragName(null)}
                    className={cn(
                      "rounded-lg border border-border bg-background p-3 shadow-sm cursor-grab active:cursor-grabbing",
                      pending.has(name) && "opacity-60",
                      dragName === name && "ring-2 ring-primary/40",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onCardClick(name)}
                      className="block w-full text-left text-sm font-medium text-foreground hover:text-primary truncate"
                    >
                      {String(row[titleField] || name)}
                    </button>
                    {titleField !== "name" && (
                      <p className="text-[11px] text-muted-foreground truncate">{name}</p>
                    )}
                    {cardFields.map((f) => row[f.fieldname] != null && row[f.fieldname] !== "" && (
                      <p key={f.fieldname} className="mt-1 text-xs text-muted-foreground truncate">
                        <span className="text-muted-foreground/70">{f.label}: </span>{String(row[f.fieldname])}
                      </p>
                    ))}
                    <label className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <span className="sr-only sm:not-sr-only">Move to</span>
                      <select
                        aria-label={`Move ${name} to`}
                        value={col.value}
                        disabled={pending.has(name)}
                        onChange={(e) => void move(name, e.target.value)}
                        className="flex-1 min-w-0 h-6 rounded border border-border bg-background px-1 text-[11px]"
                      >
                        {col.value === UNSET_COLUMN && <option value={UNSET_COLUMN}>Not set</option>}
                        {locked.has(col.value) && <option value={col.value}>{col.label}</option>}
                        {targets.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </label>
                  </li>
                )
              })}
              {col.rows.length === 0 && (
                <li className="text-xs text-muted-foreground/60 text-center py-6 select-none">No records</li>
              )}
            </ul>
          </section>
        ))}
      </div>
    </div>
  )
}
