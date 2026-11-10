"use client"

import { useLayoutEffect, useState, type ReactNode, type RefObject } from "react"
import { createPortal } from "react-dom"

const GAP = 8
const EDGE = 8

export interface AnchoredPopoverProps {
  /** Element the popover is attached to (usually the trigger button). */
  anchorRef: RefObject<HTMLElement | null>
  /** Ref to the popover element, for outside-click checks. */
  panelRef: RefObject<HTMLDivElement | null>
  children: ReactNode
  className?: string
  role?: string
  "aria-label"?: string
}

/**
 * Renders its children in a portal on document.body with fixed positioning
 * below (or, if there's no room, above) the anchor. Escapes any
 * `overflow: hidden/auto` ancestor — e.g. a child-table grid — that would
 * otherwise clip an absolutely-positioned dropdown.
 */
export function AnchoredPopover({ anchorRef, panelRef, children, className, ...rest }: AnchoredPopoverProps) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    function place() {
      const anchor = anchorRef.current
      const panel = panelRef.current
      if (!anchor || !panel) return
      const a = anchor.getBoundingClientRect()
      const { offsetWidth: w, offsetHeight: h } = panel
      const vw = window.innerWidth
      const vh = window.innerHeight

      let top = a.bottom + GAP
      if (top + h > vh - EDGE && a.top - GAP - h >= EDGE) top = a.top - GAP - h
      const left = Math.max(EDGE, Math.min(a.left, vw - w - EDGE))
      setPos((p) => (p && p.top === top && p.left === left ? p : { top, left }))
    }
    place()
    // capture: also catches scrolling inside the table/form containers
    window.addEventListener("scroll", place, true)
    window.addEventListener("resize", place)
    return () => {
      window.removeEventListener("scroll", place, true)
      window.removeEventListener("resize", place)
    }
  }, [anchorRef, panelRef])

  if (typeof document === "undefined") return null
  return createPortal(
    <div
      ref={panelRef}
      // Dialogs treat interaction inside this as "inside" (see DialogContent)
      data-petal-popover=""
      {...rest}
      className={className}
      style={{
        position: "fixed",
        top: pos?.top ?? 0,
        left: pos?.left ?? 0,
        // above dialogs (z-50 … z-[700]); pointer-events: modal dialogs set
        // pointer-events:none on <body>, which this portal would inherit
        zIndex: 9999,
        pointerEvents: "auto",
        // measured on first layout pass, then shown in place
        visibility: pos ? "visible" : "hidden",
      }}
    >
      {children}
    </div>,
    document.body,
  )
}
