/* eslint-disable @typescript-eslint/no-explicit-any */
/** The login page hands over to the shell: the setup check resolves and the desk renders. */
import { describe, expect, it, vi } from "vitest"
import { act, render, screen, waitFor } from "@testing-library/react"

let pathname = "/login"
const replace = vi.fn((p: string) => { pathname = p })
vi.mock("next/navigation", () => ({ usePathname: () => pathname, useRouter: () => ({ replace, push: replace }) }))
vi.mock("@/lib/sidebar/frappe-sidebar", () => ({ fetchFrappeSidebarItems: async () => [] }))
vi.mock("@/components/shell/Sidebar", () => ({ Sidebar: () => null }))
vi.mock("@/components/shell/Navbar", () => ({ Navbar: () => null }))

const client: any = {
  waitFor: vi.fn(), applyConfig: vi.fn(), initCSRF: async () => {}, invalidate: () => {},
  getLoggedInUser: vi.fn(async () => { throw new Error("guest") }),
  getDoc: vi.fn(async (dt: string) => dt === "Installed Applications"
    ? { installed_applications: [{ app_name: "frappe", has_setup_wizard: 1, is_setup_complete: 1 }, { app_name: "erpnext", has_setup_wizard: 1, is_setup_complete: 1 }] }
    : {}),
  getList: async () => [],
}
vi.mock("@/hooks/useFrappe", () => ({ getFrappeClient: () => client }))

describe("after login", () => {
  it("leaves 'Starting Petal' once the session and setup check are done", async () => {
    ;(globalThis as any).fetch = vi.fn(async () => ({ json: async () => ({ apps: [] }) }))
    ;(globalThis as any).EventSource = class { addEventListener() {} close() {} }
    const { PetalProvider } = await import("./petal-provider")
    const { usePetalStore } = await import("@/store/petal-store")
    const view = render(<PetalProvider><p>DESK</p></PetalProvider>)
    await waitFor(() => expect(usePetalStore.getState().authStatus).toBe("unauthenticated"))

    // What the login page does
    act(() => {
      usePetalStore.getState().setUser({ name: "Administrator", email: "admin@example.com", full_name: "Administrator", first_name: "Administrator", username: "administrator", user_type: "System User", roles: ["Administrator", "System Manager"] })
      usePetalStore.getState().setAuthStatus("authenticated")
      pathname = "/"
    })
    view.rerender(<PetalProvider><p>DESK</p></PetalProvider>)
    await waitFor(() => expect(screen.getByText("DESK")).toBeTruthy(), { timeout: 3000 })
  })
})
