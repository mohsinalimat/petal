import { create } from "zustand"
import { persist, createJSONStorage } from "zustand/middleware"
import type { FrappeUser, PetalHooks, PetalThemeOverride, SidebarItem } from "@petal/sdk"
import type { ThemeMode, ThemeName } from "@/lib/theme/theme-manager"
import { readStoredMode, readStoredName } from "@/lib/theme/theme-manager"

export type AuthStatus = "loading" | "authenticated" | "unauthenticated"

interface AuthSlice {
  user: FrappeUser | null
  authStatus: AuthStatus
  setUser: (user: FrappeUser | null) => void
  setAuthStatus: (status: AuthStatus) => void
}

interface HooksSlice {
  hooks: PetalHooks
  /** True once custom apps have loaded and their on_boot hooks ran. */
  hooksReady: boolean
  sidebarItems: SidebarItem[]
  setHooks: (hooks: PetalHooks) => void
  setSidebarItems: (items: SidebarItem[]) => void
}

interface ThemeSlice {
  appTheme: PetalThemeOverride & { primaryColor: string; borderRadius: string; fontFamily: string }
  themeMode: ThemeMode
  themeName: ThemeName
  setAppTheme: (theme: PetalThemeOverride & { primaryColor: string; borderRadius: string; fontFamily: string }) => void
  setThemeMode: (mode: ThemeMode) => void
  setThemeName: (name: ThemeName) => void
}

interface UISlice {
  sidebarOpen: boolean
  toggleSidebar: () => void
}

interface SettingsSlice {
  settings: Record<string, unknown>
  setSettings: (settings: Record<string, unknown>) => void
}

type PetalState = AuthSlice & HooksSlice & ThemeSlice & UISlice & SettingsSlice

function createAuthSlice(set: (fn: (s: PetalState) => Partial<PetalState>) => void): AuthSlice {
  return {
    user: null,
    authStatus: "loading",
    setUser: (user) => set(() => ({ user })),
    setAuthStatus: (authStatus) => set(() => ({ authStatus })),
  }
}

function createHooksSlice(set: (fn: (s: PetalState) => Partial<PetalState>) => void): HooksSlice {
  return {
    hooks: {},
    hooksReady: false,
    sidebarItems: [],
    setHooks: (hooks) => set(() => ({ hooks, hooksReady: true })),
    setSidebarItems: (sidebarItems) => set(() => ({ sidebarItems })),
  }
}

function createThemeSlice(set: (fn: (s: PetalState) => Partial<PetalState>) => void): ThemeSlice {
  return {
    appTheme: {
      primaryColor: "#16a34a",
      borderRadius: "0.5rem",
      fontFamily: "system-ui",
    },
    themeMode: readStoredMode(),
    themeName: readStoredName(),
    setAppTheme: (appTheme) => set(() => ({ appTheme })),
    setThemeMode: (themeMode) => set(() => ({ themeMode })),
    setThemeName: (themeName) => set(() => ({ themeName })),
  }
}

function createUISlice(set: (fn: (s: PetalState) => Partial<PetalState>) => void): UISlice {
  return {
    sidebarOpen: typeof window !== "undefined" ? window.innerWidth >= 768 : true,
    toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  }
}

function createSettingsSlice(set: (fn: (s: PetalState) => Partial<PetalState>) => void): SettingsSlice {
  return {
    settings: {},
    setSettings: (settings) => set(() => ({ settings })),
  }
}

export const usePetalStore = create<PetalState>()(
  persist(
    (set) => ({
      ...createAuthSlice(set),
      ...createHooksSlice(set),
      ...createThemeSlice(set),
      ...createUISlice(set),
      ...createSettingsSlice(set),
    }),
    {
      name: "petal-store",
      storage: createJSONStorage(() => sessionStorage),
      // Only persist the user slice — everything else rebuilds on boot
      partialize: (state) => ({ user: state.user }),
    }
  )
)
