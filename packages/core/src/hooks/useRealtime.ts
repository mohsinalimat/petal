"use client"

import { useEffect, useRef } from "react"
import { RealtimeClient, debounce, siteNamespace } from "@/lib/realtime/realtime-client"
import type { DocUpdate, ListUpdate, RealtimeSocket } from "@/lib/realtime/realtime-client"

let client: RealtimeClient | null = null
let connecting: Promise<RealtimeClient | null> | null = null

const ENABLED = process.env.NEXT_PUBLIC_PETAL_REALTIME !== "0"

/**
 * Lazily connect to Frappe's realtime server through the same-origin
 * `/socket.io` rewrite (see next.config.js), so the session cookie is sent and
 * the CSP's `connect-src 'self'` holds. Resolves null when realtime is disabled.
 */
export function getRealtimeClient(): Promise<RealtimeClient | null> {
  if (!ENABLED || typeof window === "undefined") return Promise.resolve(null)
  if (client) return Promise.resolve(client)
  if (!connecting) {
    connecting = Promise.all([
      import("socket.io-client"),
      // Site name is per-tenant, so it comes from the server at runtime
      fetch("/api/config").then((r) => r.json() as Promise<{ site?: string }>).catch(() => ({} as { site?: string })),
    ]).then(([{ io }, cfg]) => {
      const site = cfg.site || window.location.hostname
      const socket = io(window.location.origin + siteNamespace(site), {
        path: "/socket.io",
        withCredentials: true,
        // Give up quietly if the realtime server isn't running — the UI still works without it.
        reconnectionAttempts: 5,
        transports: ["polling", "websocket"],
      })
      client = new RealtimeClient(socket as unknown as RealtimeSocket)
      return client
    }).catch((e: unknown) => {
      console.warn("[Petal] Realtime unavailable:", e)
      connecting = null
      return null
    })
  }
  return connecting
}

/** Run `onUpdate` (debounced) whenever any record of `doctype` changes. */
export function useRealtimeList(doctype: string, onUpdate: (p: ListUpdate) => void, delayMs = 400) {
  const cbRef = useRef(onUpdate)
  cbRef.current = onUpdate

  useEffect(() => {
    let unsub: (() => void) | null = null
    let cancelled = false
    const fire = debounce((p: ListUpdate) => cbRef.current(p), delayMs)
    void getRealtimeClient().then((rt) => {
      if (rt && !cancelled) unsub = rt.onListUpdate(doctype, fire)
    })
    return () => { cancelled = true; fire.cancel(); unsub?.() }
  }, [doctype, delayMs])
}

/** Run `onUpdate` whenever someone saves this document. Skipped for unsaved ("new") docs. */
export function useRealtimeDoc(doctype: string, name: string, onUpdate: (p: DocUpdate) => void) {
  const cbRef = useRef(onUpdate)
  cbRef.current = onUpdate

  useEffect(() => {
    if (!name || name === "new") return
    let unsub: (() => void) | null = null
    let cancelled = false
    void getRealtimeClient().then((rt) => {
      if (rt && !cancelled) unsub = rt.onDocUpdate(doctype, name, (p) => cbRef.current(p))
    })
    return () => { cancelled = true; unsub?.() }
  }, [doctype, name])
}
