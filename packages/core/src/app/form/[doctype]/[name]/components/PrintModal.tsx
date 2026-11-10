"use client"
import { useState, useEffect, useRef } from "react"
import { useFrappe } from "@/hooks/useFrappe"

const NO_LETTERHEAD = ""

export function PrintModal({ doctype, name, defaultFormat, onClose }: {
  doctype: string
  name: string
  /** DocType's default print format (meta.default_print_format) */
  defaultFormat?: string
  onClose: () => void
}) {
  const frappe = useFrappe()
  const [formats, setFormats]         = useState<string[]>(["Standard"])
  const [selected, setSelected]       = useState(defaultFormat || "Standard")
  const [letterheads, setLetterheads] = useState<string[]>([])
  const [letterhead, setLetterhead]   = useState(NO_LETTERHEAD)
  const [loadingFmts, setLoadingFmts] = useState(true)
  const [loadingPage, setLoadingPage] = useState(true)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    let cancelled = false
    const formatsReq = frappe.getList({
      doctype: "Print Format",
      fields: ["name"],
      filters: [["Print Format", "doc_type", "=", doctype], ["Print Format", "disabled", "=", 0]],
      order_by: "name asc",
      limit: 100,
    }).catch(() => [])
    const letterheadsReq = frappe.getList({
      doctype: "Letter Head",
      fields: ["name", "is_default"],
      filters: [["Letter Head", "disabled", "=", 0]],
      limit: 100,
    }).catch(() => [])

    void Promise.all([formatsReq, letterheadsReq]).then(([fmts, lhs]) => {
      if (cancelled) return
      const custom = fmts.map((d) => String(d.name)).filter((n) => n !== "Standard")
      setFormats(["Standard", ...custom])
      // A default that's disabled or deleted falls back to Standard
      setSelected((cur) => (cur === "Standard" || custom.includes(cur) ? cur : "Standard"))
      setLetterheads(lhs.map((d) => String(d.name)))
      const def = lhs.find((d) => Number(d.is_default) === 1)
      if (def) setLetterhead(String(def.name))
      setLoadingFmts(false)
    })
    return () => { cancelled = true }
  }, [doctype, frappe])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    document.addEventListener("keydown", h)
    return () => document.removeEventListener("keydown", h)
  }, [onClose])

  function handlePrint() {
    const win = iframeRef.current?.contentWindow
    if (win) { win.focus(); win.print() }
  }

  const qs = new URLSearchParams({ doctype, name, format: selected, no_letterhead: letterhead ? "0" : "1" })
  if (letterhead) qs.set("letterhead", letterhead)
  // Wait for the format list so the preview doesn't load Standard first, then the default
  const iframeSrc = loadingFmts ? null : `/api/v1/printview?${qs}`
  const pdfHref = `/api/v1/print/pdf?${qs}`

  return (
    <div className="fixed inset-0 z-[800] flex flex-col bg-background">
      <div className="flex items-center justify-between gap-4 px-6 py-3 border-b border-border bg-background shrink-0 shadow-sm">
        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          <svg className="w-4 h-4 text-muted-foreground shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.056 48.056 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659"/>
          </svg>
          <span className="text-sm font-semibold text-foreground truncate">{name}</span>
          <span className="text-muted-foreground/30">·</span>
          {loadingFmts ? (
            <div className="h-8 w-32 rounded-lg bg-muted animate-pulse" />
          ) : (
            <div className="relative">
              <select
                aria-label="Print format"
                value={selected}
                onChange={(e) => { setSelected(e.target.value); setLoadingPage(true) }}
                className="h-8 pl-3 pr-7 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 appearance-none cursor-pointer"
              >
                {formats.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M19 9l-7 7-7-7"/>
              </svg>
            </div>
          )}
          {!loadingFmts && letterheads.length > 0 && (
            <div className="relative">
              <select
                aria-label="Letter head"
                value={letterhead}
                onChange={(e) => { setLetterhead(e.target.value); setLoadingPage(true) }}
                className="h-8 pl-3 pr-7 rounded-lg border border-border bg-background text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary/50 appearance-none cursor-pointer"
              >
                <option value={NO_LETTERHEAD}>No letter head</option>
                {letterheads.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
              <svg className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" d="M19 9l-7 7-7-7"/>
              </svg>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <a
            href={pdfHref}
            target="_blank"
            rel="noopener"
            aria-disabled={loadingFmts}
            className={`h-8 px-3 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center gap-1.5 ${loadingFmts ? "pointer-events-none opacity-60" : ""}`}
          >
            PDF
          </a>
          <button
            onClick={handlePrint}
            disabled={loadingPage}
            className="h-8 px-4 rounded-lg bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 disabled:opacity-60 transition-colors flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.056 48.056 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659"/>
            </svg>
            Print
          </button>
          <button
            onClick={onClose}
            className="h-8 px-3 rounded-lg border border-border text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex items-center gap-1.5"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12"/>
            </svg>
            Close
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden bg-muted/40 p-6 flex items-start justify-center relative">
        {loadingPage && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="flex flex-col items-center gap-3">
              <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <span className="text-xs text-muted-foreground">Loading preview…</span>
            </div>
          </div>
        )}
        <div className="w-full max-w-4xl h-full">
          {iframeSrc && <iframe
            ref={iframeRef}
            key={iframeSrc}
            src={iframeSrc}
            onLoad={() => setLoadingPage(false)}
            className={`w-full h-full bg-white shadow-2xl rounded-lg border border-border/60 transition-opacity duration-300 ${loadingPage ? "opacity-0" : "opacity-100"}`}
            title="Print Preview"
          />}
        </div>
      </div>
    </div>
  )
}
