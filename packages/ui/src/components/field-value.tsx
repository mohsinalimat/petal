import { cn } from "../lib/utils"

const STAR_PATH =
  "M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.562.562 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"

export interface FieldValueProps {
  /** Raw value from Frappe (string, number, array, etc.) */
  value: unknown
  /** Frappe fieldtype string, e.g. "Date", "Check", "Currency" */
  fieldtype: string
  /** ISO 4217 currency code, e.g. "USD", "EUR", "INR". Used for Currency fields. */
  currency?: string
  className?: string
}

/**
 * Read-only formatted display for any Frappe field value.
 * Handles Check, Date, Datetime, Currency, Float, Int, Percent, Color, Password, Rating,
 * Image, Code, and multi-line text types. Falls back to a plain text span for everything else.
 *
 * @example
 * <FieldValue value={doc.status} fieldtype="Select" />
 */
export function FieldValue({ value, fieldtype, currency = "USD", className }: FieldValueProps) {
  if (value == null || value === "") {
    return (
      <span className={cn("text-xs italic text-muted-foreground/40", className)}>—</span>
    )
  }

  switch (fieldtype) {
    case "Check": {
      const checked = Number(value) === 1
      return (
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-xs font-medium",
            checked ? "text-green-600 dark:text-green-400" : "text-muted-foreground",
            className,
          )}
        >
          <span
            className={cn(
              "flex h-4 w-4 items-center justify-center rounded",
              checked ? "bg-green-100 dark:bg-green-900/30" : "bg-muted",
            )}
          >
            {checked ? (
              <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} aria-hidden="true">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            ) : (
              <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
                <path strokeLinecap="round" d="M18 6L6 18M6 6l12 12" />
              </svg>
            )}
          </span>
          {checked ? "Yes" : "No"}
        </span>
      )
    }

    case "Date": {
      if (typeof value !== "string") return <span className={cn("text-sm", className)}>{String(value)}</span>
      const parts = value.split("-").map(Number)
      const d = new Date(parts[0]!, (parts[1]! - 1), parts[2]!)
      return (
        <span className={cn("text-sm", className)}>
          {isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}
        </span>
      )
    }

    case "Datetime": {
      if (typeof value !== "string") return <span className={cn("text-sm", className)}>{String(value)}</span>
      const d = new Date(value.replace(" ", "T"))
      return (
        <span className={cn("text-sm", className)}>
          {isNaN(d.getTime()) ? value : d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
        </span>
      )
    }

    case "Currency": {
      const n = parseFloat(String(value))
      return (
        <span className={cn("text-sm", className)}>
          {isNaN(n)
            ? String(value)
            : n.toLocaleString(undefined, { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      )
    }

    case "Float": {
      const n = parseFloat(String(value))
      return (
        <span className={cn("text-sm", className)}>
          {isNaN(n)
            ? String(value)
            : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      )
    }

    case "Int":
    case "Percent": {
      const n = parseFloat(String(value))
      return (
        <span className={cn("text-sm", className)}>
          {isNaN(n) ? String(value) : n.toLocaleString()}
        </span>
      )
    }

    case "Color":
      return (
        <span className={cn("flex items-center gap-2", className)}>
          <span
            className="h-4 w-4 shrink-0 rounded-full border border-border/60"
            style={{ backgroundColor: String(value) }}
            aria-hidden="true"
          />
          <span className="font-mono text-xs text-muted-foreground">{String(value)}</span>
        </span>
      )

    case "Image":
      return typeof value === "string" && value ? (
        <img
          src={value}
          alt=""
          className={cn("max-h-32 max-w-[180px] rounded-lg border border-border bg-muted/20 object-contain", className)}
        />
      ) : (
        <span className={cn("text-xs italic text-muted-foreground/40", className)}>—</span>
      )

    case "Code": {
      const raw = String(value)
      let parsed: unknown
      try {
        parsed = JSON.parse(raw)
      } catch {
        parsed = null
      }
      const isList = Array.isArray(parsed) && parsed.length > 0 && parsed.every((r) => r !== null && typeof r === "object" && !Array.isArray(r))
      const isSingle = !Array.isArray(parsed) && parsed !== null && typeof parsed === "object"
      if (isList || isSingle) {
        const rows = isList ? (parsed as Record<string, unknown>[]) : [parsed as Record<string, unknown>]
        const keys = Array.from(new Set(rows.flatMap((r) => Object.keys(r))))
        return (
          <div className={cn("w-full overflow-x-auto rounded-lg border border-border/40", className)}>
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-border/40 bg-muted/50">
                  {keys.map((k) => (
                    <th key={k} className="whitespace-nowrap px-3 py-2 font-semibold uppercase tracking-wide text-muted-foreground">
                      {k}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={i} className={i % 2 === 0 ? "bg-background" : "bg-muted/20"}>
                    {keys.map((k) => (
                      <td key={k} className="whitespace-nowrap px-3 py-2 text-foreground/80">
                        {row[k] == null ? <span className="italic text-muted-foreground/40">—</span> : String(row[k])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
      return (
        <pre className={cn("max-h-64 w-full overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border/40 bg-muted/40 p-3 font-mono text-xs", className)}>
          {raw}
        </pre>
      )
    }

    case "Password":
      return (
        <span className={cn("text-xs tracking-widest text-muted-foreground", className)}>
          ••••••••
        </span>
      )

    case "Rating": {
      const n = Number(value) || 0
      return (
        <span className={cn("flex gap-0.5", className)} aria-label={`${n} stars`}>
          {[1, 2, 3, 4, 5].map((s) => (
            <svg
              key={s}
              className={cn("h-4 w-4", s <= n ? "text-yellow-400" : "text-muted-foreground/20")}
              fill={s <= n ? "currentColor" : "none"}
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d={STAR_PATH} />
            </svg>
          ))}
        </span>
      )
    }

    case "Small Text":
    case "Text":
    case "Long Text":
    case "Text Editor":
      return (
        <span className={cn("whitespace-pre-wrap text-sm leading-relaxed", className)}>
          {String(value)}
        </span>
      )

    default:
      return <span className={cn("text-sm", className)}>{String(value)}</span>
  }
}
