/**
 * Loads the Frappe-compatible runtime on first use, so forms of apps without
 * frappe_compat never download it (jQuery, moment, the frappe namespace).
 */
export type Runtime = typeof import("@/lib/frappe-compat")
  & Pick<typeof import("@/lib/frappe-compat/browser"), "startCompat">
  & Pick<typeof import("@/lib/frappe-compat/request"), "waitForPending">
let runtime: Runtime | null = null
export async function loadRuntime(): Promise<Runtime> {
  if (runtime) return runtime
  const [core, browser, request] = await Promise.all([
    import("@/lib/frappe-compat"), import("@/lib/frappe-compat/browser"), import("@/lib/frappe-compat/request"),
  ])
  runtime = { ...core, startCompat: browser.startCompat, waitForPending: request.waitForPending }
  return runtime
}

/** The runtime if it has loaded (always, once a Form exists). */
export function loadedRuntime(): Runtime | null {
  return runtime
}
