"use client"

import type { ReactNode } from "react"
import { ChevronDown } from "lucide-react"
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "./dropdown-menu"

export interface InlineSelectProps<T extends string> {
  value: T | null
  options: readonly T[]
  onChange: (value: T) => void
  icon?: ReactNode
}

export function InlineSelect<T extends string>({
  value,
  options,
  onChange,
  icon,
}: InlineSelectProps<T>) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="inline-flex items-center gap-1 h-6 px-2 rounded-md text-[11px] font-medium
                     bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground
                     border border-transparent hover:border-border transition-colors"
        >
          {icon && <span className="opacity-60">{icon}</span>}
          {value ?? options[0]}
          <ChevronDown className="w-2.5 h-2.5 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[130px]">
        {options.map((opt) => (
          <DropdownMenuItem
            key={opt}
            onClick={() => onChange(opt)}
            className={value === opt ? "font-semibold text-primary" : ""}
          >
            {opt}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
