"use client"

import * as React from "react"
import { cn } from "../lib/utils"

export type DocViewKey = "list" | "kanban" | "calendar" | "gantt" | "report" | "tree"

export type ViewSwitcherProps = {
  active: DocViewKey
  /** Views to offer, in order. Views whose doctype lacks the needed fields should be omitted by the caller. */
  views: DocViewKey[]
  onChange: (view: DocViewKey) => void
  className?: string
}

const LABELS: Record<DocViewKey, string> = {
  list: "List",
  kanban: "Kanban",
  calendar: "Calendar",
  gantt: "Gantt",
  report: "Report",
  tree: "Tree",
}

/** Segmented control for switching between list/kanban/calendar/gantt views of a doctype. */
export function ViewSwitcher({ active, views, onChange, className }: ViewSwitcherProps) {
  if (views.length < 2) return null
  return (
    <div
      role="tablist"
      aria-label="Views"
      className={cn("inline-flex max-w-full overflow-x-auto rounded-lg border border-border bg-background p-0.5", className)}
    >
      {views.map((v) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={v === active}
          onClick={() => v !== active && onChange(v)}
          className={cn(
            "h-7 px-3 rounded-md text-xs font-medium whitespace-nowrap transition-colors",
            v === active ? "bg-primary/10 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-accent",
          )}
        >
          {LABELS[v]}
        </button>
      ))}
    </div>
  )
}
