import { describe, expect, it } from "vitest"
import { usePetalStore } from "./petal-store"

const u = (name: string) => ({ name, email: name, full_name: name, first_name: name, username: name, user_type: "System User", roles: [] })

describe("petal store setup state", () => {
  it("re-checks setup after logout or a different login, but not for a refresh of the same user", () => {
    const s = usePetalStore.getState()
    s.setUser(u("clerk@x.co"))
    s.setSetupState("complete")
    s.setUser(u("clerk@x.co"))
    expect(usePetalStore.getState().setupState).toBe("complete")
    s.setUser(null)
    expect(usePetalStore.getState().setupState).toBe("unknown")
    s.setSetupState("complete")
    s.setUser(u("Administrator"))
    expect(usePetalStore.getState().setupState).toBe("unknown")
  })
})
