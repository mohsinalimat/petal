import { describe, it, expect, vi } from "vitest"
import { RealtimeClient, debounce, siteNamespace } from "./realtime-client"
import type { RealtimeSocket } from "./realtime-client"

class FakeSocket implements RealtimeSocket {
  connected = true
  emitted: unknown[][] = []
  private handlers = new Map<string, Array<(...a: unknown[]) => void>>()
  on(ev: string, cb: (...a: unknown[]) => void) { this.handlers.set(ev, [...(this.handlers.get(ev) ?? []), cb]) }
  off() {}
  emit(...args: unknown[]) { this.emitted.push(args) }
  disconnect() { this.connected = false }
  fire(ev: string, ...args: unknown[]) { this.handlers.get(ev)?.forEach((cb) => cb(...args)) }
}

describe("RealtimeClient", () => {
  it("subscribes to a doctype room once and dispatches list updates", () => {
    const s = new FakeSocket()
    const rt = new RealtimeClient(s)
    const a = vi.fn(), b = vi.fn(), other = vi.fn()
    rt.onListUpdate("Task", a)
    rt.onListUpdate("Task", b)
    rt.onListUpdate("Note", other)
    expect(s.emitted.filter((e) => e[0] === "doctype_subscribe")).toEqual([["doctype_subscribe", "Task"], ["doctype_subscribe", "Note"]])
    s.fire("list_update", { doctype: "Task", name: "T1" })
    expect(a).toHaveBeenCalledWith({ doctype: "Task", name: "T1" })
    expect(b).toHaveBeenCalledTimes(1)
    expect(other).not.toHaveBeenCalled()
  })

  it("unsubscribes from the room only when the last listener leaves", () => {
    const s = new FakeSocket()
    const rt = new RealtimeClient(s)
    const offA = rt.onListUpdate("Task", vi.fn())
    const offB = rt.onListUpdate("Task", vi.fn())
    offA()
    expect(s.emitted.some((e) => e[0] === "doctype_unsubscribe")).toBe(false)
    offB()
    expect(s.emitted.at(-1)).toEqual(["doctype_unsubscribe", "Task"])
    offB() // idempotent
  })

  it("routes doc updates by doctype + name and opens/closes the doc", () => {
    const s = new FakeSocket()
    const rt = new RealtimeClient(s)
    const cb = vi.fn()
    const off = rt.onDocUpdate("Task", "T1", cb)
    expect(s.emitted).toEqual([["doc_subscribe", "Task", "T1"], ["doc_open", "Task", "T1"]])
    s.fire("doc_update", { doctype: "Task", name: "T2" })
    s.fire("doc_update", { doctype: "Task", name: "T1", modified: "m" })
    s.fire("doc_update", { doctype: "Task" }) // malformed
    expect(cb).toHaveBeenCalledTimes(1)
    off()
    expect(s.emitted.slice(-2)).toEqual([["doc_close", "Task", "T1"], ["doc_unsubscribe", "Task", "T1"]])
  })

  it("defers joins while disconnected and re-joins every room on (re)connect", () => {
    const s = new FakeSocket()
    s.connected = false
    const rt = new RealtimeClient(s)
    rt.onListUpdate("Task", vi.fn())
    rt.onDocUpdate("Task", "T 1/x", vi.fn())
    expect(s.emitted).toEqual([])
    s.connected = true
    s.fire("connect")
    expect(s.emitted).toEqual([["doctype_subscribe", "Task"], ["doc_subscribe", "Task", "T 1/x"], ["doc_open", "Task", "T 1/x"]])
  })

  it("close() drops listeners and disconnects", () => {
    const s = new FakeSocket()
    const rt = new RealtimeClient(s)
    const cb = vi.fn()
    rt.onListUpdate("Task", cb)
    rt.close()
    s.fire("list_update", { doctype: "Task" })
    expect(cb).not.toHaveBeenCalled()
    expect(rt.connected).toBe(false)
  })
})

describe("debounce / siteNamespace", () => {
  it("fires once with the last args after the quiet period, and can be cancelled", () => {
    vi.useFakeTimers()
    const fn = vi.fn()
    const d = debounce(fn, 100)
    d(1); d(2); d(3)
    vi.advanceTimersByTime(99)
    expect(fn).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(fn).toHaveBeenCalledTimes(1)
    expect(fn).toHaveBeenCalledWith(3)
    d(4); d.cancel()
    vi.advanceTimersByTime(200)
    expect(fn).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it("builds the per-site namespace", () => {
    expect(siteNamespace("erp.example.com")).toBe("/erp.example.com")
    expect(siteNamespace("/x")).toBe("/x")
  })
})
