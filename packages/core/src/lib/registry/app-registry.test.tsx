import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { Suspense, lazy } from "react"
import type { PetalHooks } from "@petal/sdk"
import { AppRegistry } from "./app-registry"
import { composeSlotLoaders, mergeFormSlots } from "./compose-slots"

const app = (name: string, hooks: PetalHooks) => ({ name, version: "1", url: `https://cdn.test/${name}.js`, _hooks: hooks })

describe("AppRegistry", () => {
  it("runs on_init at load and on_boot later, isolating failures", async () => {
    const r = new AppRegistry()
    const init = vi.fn()
    const boot = vi.fn()
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "info").mockImplementation(() => {})
    await r.loadFromConfig({
      apps: [
        app("ok", { on_init: init, on_boot: boot }),
        app("bad", { on_init: () => { throw new Error("init boom") } }),
        app("badboot", { on_boot: () => Promise.reject(new Error("boot boom")) }),
      ],
    })
    expect(init).toHaveBeenCalled()
    expect(r.getAll().map((a) => a.meta.name)).toEqual(["ok", "badboot"])
    expect(r.getFailedApps().get("bad")).toBe("init boom")
    await r.runBootHooks()
    expect(boot).toHaveBeenCalled()
  })

  it("merges sidebar items with overrides, hidden items and ordering across apps", async () => {
    const r = new AppRegistry()
    vi.spyOn(console, "info").mockImplementation(() => {})
    await r.loadFromConfig({
      apps: [
        app("a", {
          sidebar_items: [{ label: "Alpha", path: "/a" }, { label: "Beta", path: "/b" }],
          sidebar_order: ["Gamma"],
          sidebar_item_overrides: { Beta: { hidden: true } },
        }),
        app("b", {
          sidebar_items: [{ label: "Gamma", path: "/g", children: [{ label: "Child", path: "/g/c" }] }],
          sidebar_order: ["Gamma", "Alpha"],
          sidebar_item_overrides: { "/g/c": { icon: "star" } },
        }),
      ],
    })
    const merged = r.getMergedHooks()
    expect(merged.sidebar_items!.map((i) => i.label)).toEqual(["Gamma", "Alpha"])
    expect(merged.sidebar_items![0]!.children![0]!.icon).toBe("star")
    expect(merged.sidebar_order).toEqual(["Gamma", "Alpha"])
  })

  it("concatenates routes and lets later apps override settings and theme", async () => {
    const r = new AppRegistry()
    vi.spyOn(console, "info").mockImplementation(() => {})
    const comp = () => Promise.resolve({ default: () => null })
    await r.loadFromConfig({
      apps: [
        app("a", { routes: [{ path: "/a", component: comp }], overrides: { settings: { currency: "USD" }, theme: { primaryColor: "#000" } } }),
        app("b", { routes: [{ path: "/b", component: comp }], overrides: { settings: { currency: "INR" } } }),
      ],
    })
    expect(r.getMergedHooks().routes!.map((x) => x.path)).toEqual(["/a", "/b"])
    expect(r.getMergedSettings()).toEqual({ currency: "INR" })
    expect(r.getMergedTheme().borderRadius).toBe("0.5rem")
  })

  it("renders form slots from every app, not just the first", async () => {
    const r = new AppRegistry()
    vi.spyOn(console, "info").mockImplementation(() => {})
    await r.loadFromConfig({
      apps: [
        app("a", { form_slots: { Task: { after: async () => ({ default: () => <p>from A</p> }) } } }),
        app("b", { form_slots: { Task: { after: async () => ({ default: ({ docname }) => <p>from B {docname}</p> }) } } }),
      ],
    })
    const Slot = lazy(r.getMergedHooks().form_slots!.Task!.after!)
    render(<Suspense fallback={null}><Slot docname="T-1" /></Suspense>)
    expect(await screen.findByText("from A")).toBeTruthy()
    expect(screen.getByText("from B T-1")).toBeTruthy()
  })
})

describe("compose-slots", () => {
  it("returns a single loader untouched", () => {
    const l = async () => ({ default: () => null })
    expect(composeSlotLoaders([l])).toBe(l)
  })

  it("merges positions independently", () => {
    const l = async () => ({ default: () => null })
    const merged = mergeFormSlots([{ before: l }, { toolbar: l }])
    expect(Object.keys(merged).sort()).toEqual(["before", "toolbar"])
    expect(merged.before).toBe(l)
  })
})
