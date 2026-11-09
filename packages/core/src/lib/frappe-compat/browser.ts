/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Browser wiring for the Frappe-compatible runtime: Petal's API client as the
 * transport, Petal toasts, realtime, uploads and Next.js navigation.
 */
import type { FrappeCompatConfig } from "@petal/sdk"
import { getFrappeClient } from "@/hooks/useFrappe"
import { getRealtimeClient } from "@/hooks/useRealtime"
import { toast } from "@/store/toast-store"
import { ensureCompat } from "./index"

type Navigate = (path: string, opts?: { replace?: boolean }) => void

let navigateImpl: Navigate = (path) => { if (typeof window !== "undefined") window.location.assign(path) }

/** CompatHost registers Next's router here so scripts' set_route stays client-side. */
export function setCompatNavigator(fn: Navigate) {
  navigateImpl = fn
}

export function startCompat(config: FrappeCompatConfig) {
  const client = getFrappeClient()
  return ensureCompat({
    transport: (method, args) => client.rawCall(method, args),
    // Desk's boot data comes from the desk page (frappe.sessions.get isn't whitelisted)
    boot: () => client.getBoot(),
    navigate: (path, opts) => navigateImpl(path, opts),
    toast: (variant, title, detail) => toast[variant](title, detail),
    realtimeOn: async (event, cb) => {
      const rt = await getRealtimeClient()
      return rt ? rt.on(event, cb) : () => {}
    },
    upload: async (file, meta: any) => {
      const url = await client.uploadFile(file, {
        ...(meta.doctype ? { doctype: meta.doctype } : {}),
        ...(meta.docname ? { docname: meta.docname } : {}),
        ...(meta.fieldname ? { fieldname: meta.fieldname } : {}),
        is_private: meta.is_private ? 1 : 0,
      })
      return { file_url: url, file_name: file.name, name: url }
    },
    bundles: config.bundles ?? [],
    autoBundles: config.autoBundles !== false,
  })
}
