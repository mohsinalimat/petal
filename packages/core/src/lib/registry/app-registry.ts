import type { PetalAppMeta, PetalConfig, PetalHooks } from "@petal/sdk"
import { mergeFormSlots } from "./compose-slots"

// Load apps from their devUrl: always in `next dev`, and in a production build
// when NEXT_PUBLIC_PETAL_USE_DEV_URLS=1 (fast local runs against app dev servers).
const isDev = process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_PETAL_USE_DEV_URLS === "1"

interface RegisteredApp {
  meta: PetalAppMeta
  hooks: PetalHooks
}

export class AppRegistry {
  private apps: Map<string, RegisteredApp> = new Map()
  private failedApps: Map<string, string> = new Map() // name → error message

  async loadFromConfig(config: PetalConfig): Promise<void> {
    const apps = config.apps ?? []
    const results = await Promise.allSettled(
      apps.map((app) => this.loadApp(app))
    )
    results.forEach((result, i) => {
      const app = apps[i]
      if (result.status === "rejected") {
        const msg = result.reason instanceof Error ? result.reason.message : String(result.reason)
        this.failedApps.set(app!.name, msg)
        console.error(`[Petal] Failed to load app "${app?.name}": ${msg}`)
      }
    })
  }

  private async loadApp(meta: PetalAppMeta): Promise<void> {
    let hooks: PetalHooks

    if (meta._hooks) {
      hooks = meta._hooks
    } else {
      const activeUrl = isDev && meta.devUrl ? meta.devUrl : meta.url
      // Cache-bust in dev so stale ESM modules are never served from browser cache
      const importUrl = isDev ? `${activeUrl}?t=${Date.now()}` : activeUrl
      const importWithTimeout = Promise.race([
        import(/* webpackIgnore: true */ importUrl),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Timed out after 15s — is the dev server running? (${activeUrl})`)), 15_000)
        ),
      ])
      const module = await importWithTimeout
      hooks = module.default ?? module
    }

    await hooks.on_init?.()

    this.apps.set(meta.name, { meta, hooks })
    console.info(`[Petal] Loaded app: ${meta.name}`)
  }

  async runBootHooks(): Promise<void> {
    const results = await Promise.allSettled(
      this.getAll().map(({ hooks }) =>
        hooks.on_boot ? hooks.on_boot() : Promise.resolve()
      )
    )
    results.forEach((result, i) => {
      const app = this.getAll()[i]
      if (result.status === "rejected") {
        console.error(`[Petal] on_boot failed for "${app?.meta.name}": ${result.reason}`)
      }
    })
  }

  getAll(): RegisteredApp[] {
    return Array.from(this.apps.values())
  }

  getFailedApps(): Map<string, string> {
    return this.failedApps
  }

  getMergedHooks(): PetalHooks {
    const all = this.getAll().map((a) => a.hooks)

    const itemOverrides: Record<string, Partial<import("@petal/sdk").SidebarItem>> = Object.assign(
      {},
      ...all.map((h) => h.sidebar_item_overrides ?? {})
    )

    const seenOrderKeys = new Set<string>()
    const mergedOrder: string[] = []
    for (const h of all) {
      for (const key of h.sidebar_order ?? []) {
        if (!seenOrderKeys.has(key)) {
          seenOrderKeys.add(key)
          mergedOrder.push(key)
        }
      }
    }

    const orderRank = new Map(mergedOrder.map((key, i) => [key, i]))
    const getRank = (item: import("@petal/sdk").SidebarItem) =>
      orderRank.get(item.label) ?? orderRank.get(item.path) ?? Infinity

    function applyOverrides(items: import("@petal/sdk").SidebarItem[]): import("@petal/sdk").SidebarItem[] {
      return items.map((item) => {
        const override = itemOverrides[item.label] ?? itemOverrides[item.path]
        const patched = override ? { ...item, ...override } : item
        if (patched.children?.length) {
          return { ...patched, children: applyOverrides(patched.children) }
        }
        return patched
      })
    }

    function filterHidden(items: import("@petal/sdk").SidebarItem[]): import("@petal/sdk").SidebarItem[] {
      return items.filter((item) => !item.hidden)
    }

    function applyOrder(items: import("@petal/sdk").SidebarItem[]): import("@petal/sdk").SidebarItem[] {
      if (mergedOrder.length === 0) return items
      return items
        .map((item, i) => ({ item, i, rank: getRank(item) }))
        .sort((a, b) => a.rank - b.rank || a.i - b.i)
        .map(({ item }) => item)
    }

    const rawSidebarItems = all.flatMap((h) => h.sidebar_items ?? [])
    const sidebarItems = applyOrder(filterHidden(applyOverrides(rawSidebarItems)))

    const mergedFormSlots: Record<string, import("@petal/sdk").FormSlotComponents[]> = {}
    for (const h of all) {
      for (const [doctype, slots] of Object.entries(h.form_slots ?? {})) {
        if (!mergedFormSlots[doctype]) mergedFormSlots[doctype] = []
        mergedFormSlots[doctype]!.push(slots)
      }
    }

    const merged: import("@petal/sdk").PetalHooks = {
      sidebar_items: sidebarItems,
      sidebar_item_overrides: itemOverrides,
      sidebar_order: mergedOrder,
      navbar_items: all.flatMap((h) => h.navbar_items ?? []),
      routes: all.flatMap((h) => h.routes ?? []),
      form_overrides: Object.assign({}, ...all.map((h) => h.form_overrides ?? {})),
      form_field_behaviors: Object.assign({}, ...all.map((h) => h.form_field_behaviors ?? {})),
      list_overrides: Object.assign({}, ...all.map((h) => h.list_overrides ?? {})),
      overrides: Object.assign({}, ...all.map((h) => h.overrides ?? {})),
    }

    if (Object.keys(mergedFormSlots).length > 0) {
      merged.form_slots = Object.fromEntries(
        Object.entries(mergedFormSlots).map(([dt, slots]) => [dt, mergeFormSlots(slots)])
      )
    }

    return merged
  }

  getMergedTheme() {
    const hooks = this.getMergedHooks()
    return {
      primaryColor: "#16a34a",
      borderRadius: "0.5rem",
      fontFamily: "system-ui",
      ...hooks.overrides?.theme,
    }
  }

  getMergedWorkspaceConfig() {
    const hooks = this.getMergedHooks()
    return {
      doctype: "Workspace",
      fields: ["name", "title", "icon"],
      ...hooks.overrides?.workspace,
    }
  }

  getMergedFrappeClientConfig() {
    const hooks = this.getMergedHooks()
    return hooks.overrides?.frappeClient ?? {}
  }

  getMergedAuthConfig() {
    const hooks = this.getMergedHooks()
    return hooks.overrides?.auth ?? {}
  }

  getMergedSettings() {
    const hooks = this.getMergedHooks()
    return hooks.overrides?.settings ?? {}
  }
}

export const appRegistry = new AppRegistry()
