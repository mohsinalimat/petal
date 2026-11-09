/* eslint-disable @typescript-eslint/no-explicit-any */
const g: any = typeof window !== "undefined" ? window : globalThis

let controlsLoading: Promise<void> | null = null

/** True once Desk's own form controls (controls.bundle.js) are loaded. */
export function deskControlsReady(): boolean {
  return !!g.frappe?.ui?.form?.__petal_desk_controls
}

/**
 * Load Desk's form controls (frappe.ui.form.ControlX, make_control) on demand:
 * for Desk pages and for field types Petal doesn't draw itself. ~1.6 MB, so
 * it's never part of the first form load.
 */
export function loadDeskControls(): Promise<void> {
  if (deskControlsReady()) return Promise.resolve()
  if (!controlsLoading) {
    controlsLoading = (async () => {
      const frappe = g.frappe
      await frappe.require("controls.bundle.js")
      if (typeof frappe.ui.form.ControlData?.prototype?.make_input !== "function") throw new Error("Desk controls did not load")
      frappe.ui.form.__petal_desk_controls = true
    })().catch((e) => { controlsLoading = null; throw e })
  }
  return controlsLoading
}
