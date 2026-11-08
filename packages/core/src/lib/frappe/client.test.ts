import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { FrappeClient } from "./client"

type Call = { url: string; init: RequestInit }
let calls: Call[]
let responses: Array<() => Response>

function json(body: unknown, status = 200) {
  return () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

beforeEach(() => {
  calls = []
  responses = []
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    const next = responses.shift()
    if (!next) throw new Error(`unexpected fetch ${url}`)
    return next()
  }))
})
afterEach(() => vi.unstubAllGlobals())

const body = (i = 0) => JSON.parse(String(calls[i]!.init.body)) as Record<string, unknown>
const header = (i: number, h: string) => (calls[i]!.init.headers as Record<string, string>)[h]

describe("FrappeClient requests", () => {
  it("unwraps data/message and strips a trailing slash from the base URL", async () => {
    const c = new FrappeClient("/api/v1/")
    responses.push(json({ data: { name: "U1" } }), json({ message: 42 }))
    expect(await c.getDoc("User", "U1")).toEqual({ name: "U1" })
    expect(await c.callMethod("frappe.client.get_count", { doctype: "User" })).toBe(42)
    expect(calls[0]!.url).toBe("/api/v1/doc/User/U1")
    expect(calls[1]!.url).toBe("/api/v1/exec")
    expect(header(1, "X-Method")).toBe("frappe.client.get_count")
  })

  it("caches GETs for 30s and de-duplicates concurrent identical requests", async () => {
    const c = new FrappeClient("/api/v1")
    responses.push(json({ data: { a: 1 } }))
    const [a, b] = await Promise.all([c.getDoc("X", "1"), c.getDoc("X", "1")])
    expect(a).toEqual(b)
    await c.getDoc("X", "1")
    expect(calls).toHaveLength(1)
  })

  it("invalidates cached entries by pattern and after writes", async () => {
    const c = new FrappeClient("/api/v1")
    responses.push(json({ data: { v: 1 } }), json({ data: { name: "1" } }), json({ data: { v: 2 } }))
    await c.getDoc("X", "1")
    await c.saveDoc({ doctype: "X", name: "1" })
    expect(await c.getDoc("X", "1")).toEqual({ v: 2 })
    expect(calls).toHaveLength(3)
  })

  it("never caches POSTs", async () => {
    const c = new FrappeClient("/api/v1")
    responses.push(json({ message: 1 }), json({ message: 2 }))
    await c.callMethod("m.x")
    expect(await c.callMethod("m.x")).toBe(2)
  })

  it("encodes list params", async () => {
    const c = new FrappeClient("/api/v1")
    responses.push(json({ data: [] }))
    await c.getList({ doctype: "ToDo", fields: ["name", "status"], filters: [["status", "=", "Open"]] as never, limit: 5, order_by: "modified desc" })
    const u = new URL(calls[0]!.url, "http://x")
    expect(u.pathname).toBe("/api/v1/doc/ToDo")
    expect(JSON.parse(u.searchParams.get("fields")!)).toEqual(["name", "status"])
    expect(u.searchParams.get("limit")).toBe("5")
    expect(u.searchParams.get("order_by")).toBe("modified desc")
    expect(u.searchParams.has("or_filters")).toBe(false)
  })

  it("uses POST for new docs and PUT for existing ones", async () => {
    const c = new FrappeClient("/api/v1")
    responses.push(json({ data: { name: "N1" } }), json({ data: { name: "N1" } }))
    await c.saveDoc({ doctype: "Note", title: "a" })
    await c.saveDoc({ doctype: "Note", name: "N1", title: "b" })
    expect([calls[0]!.init.method, calls[0]!.url]).toEqual(["POST", "/api/v1/doc/Note"])
    expect([calls[1]!.init.method, calls[1]!.url]).toEqual(["PUT", "/api/v1/doc/Note/N1"])
  })
})

describe("FrappeClient errors", () => {
  it("extracts the user-facing message from _server_messages", async () => {
    const c = new FrappeClient("/api/v1")
    const inner = JSON.stringify({ message: "<details><summary>Name is required</summary>trace</details>" })
    responses.push(json({ _server_messages: JSON.stringify([inner]) }, 417))
    await expect(c.callMethod("x.y")).rejects.toThrow("Name is required")
  })

  it("falls back to the exception text, then the status line", async () => {
    const c = new FrappeClient("/api/v1")
    responses.push(json({ exception: "frappe.exceptions.PermissionError: Not allowed" }, 403))
    await expect(c.callMethod("x.y")).rejects.toThrow("Not allowed")
    responses.push(() => new Response("oops", { status: 500, statusText: "Server Error" }))
    await expect(c.callMethod("x.y")).rejects.toThrow("500 Server Error (/exec)")
  })
})

describe("CSRF", () => {
  it("fetches the token once and sends it on writes only", async () => {
    const c = new FrappeClient("/api/v1")
    responses.push(json({ message: "tok123" }))
    await Promise.all([c.initCSRF(), c.initCSRF()])
    expect(calls.filter((x) => x.url.endsWith("/auth/csrf"))).toHaveLength(1)
    responses.push(json({ data: {} }), json({ message: null }))
    await c.getDoc("X", "1")
    await c.callMethod("a.b")
    expect(header(1, "X-CSRF-Token")).toBeUndefined()
    expect(header(2, "X-CSRF-Token")).toBe("tok123")
  })

  it("survives a failed CSRF fetch", async () => {
    const c = new FrappeClient("/api/v1")
    responses.push(json({ error: "no" }, 401))
    await expect(c.initCSRF()).resolves.toBeUndefined()
  })
})

describe("new API helpers", () => {
  it("setValue sends a fieldname dict and invalidates the doctype", async () => {
    const c = new FrappeClient("/api/v1")
    responses.push(json({ data: { v: 1 } }), json({ message: {} }), json({ data: { v: 2 } }))
    await c.getDoc("Task", "T1")
    await c.setValue("Task", "T1", { status: "Closed" })
    expect(body(1)).toEqual({ doctype: "Task", name: "T1", fieldname: { status: "Closed" } })
    expect(header(1, "X-Method")).toBe("frappe.client.set_value")
    expect(await c.getDoc("Task", "T1")).toEqual({ v: 2 })
  })

  it("getDocInfo reads the top-level docinfo key", async () => {
    const c = new FrappeClient("/api/v1")
    responses.push(json({ docinfo: { comments: [{ name: "C1" }] } }))
    expect(await c.getDocInfo("Task", "T1")).toEqual({ comments: [{ name: "C1" }] })
  })

  it("bulkAction JSON-encodes names and data and returns failures", async () => {
    const c = new FrappeClient("/api/v1")
    responses.push(json({ message: ["T2"] }), json({ message: null }))
    expect(await c.bulkAction("Task", ["T1", "T2"], "update", { status: "Open" })).toEqual(["T2"])
    expect(body(0)).toEqual({ doctype: "Task", docnames: '["T1","T2"]', action: "update", data: '{"status":"Open"}' })
    expect(await c.bulkAction("Task", ["T1"], "submit")).toEqual([])
  })

  it("insertMany, workflow and assignment calls hit the right methods", async () => {
    const c = new FrappeClient("/api/v1")
    responses.push(json({ message: ["A"] }), json({ message: [{ action: "Approve", next_state: "Approved" }] }), json({ message: { name: "D" } }), json({ message: null }), json({ message: null }))
    await c.insertMany([{ doctype: "Task", subject: "x" }])
    expect(await c.getWorkflowTransitions({ doctype: "Leave", name: "L1" })).toHaveLength(1)
    await c.applyWorkflow({ doctype: "Leave", name: "L1" }, "Approve")
    await c.assign("Task", "T1", ["a@x.com"])
    await c.unassign("Task", "T1", "a@x.com")
    expect(calls.map((x, i) => header(i, "X-Method"))).toEqual([
      "frappe.client.insert_many",
      "frappe.model.workflow.get_transitions",
      "frappe.model.workflow.apply_workflow",
      "frappe.desk.form.assign_to.add",
      "frappe.desk.form.assign_to.remove",
    ])
    expect(body(2)).toEqual({ doc: '{"doctype":"Leave","name":"L1"}', action: "Approve" })
    expect(body(3).assign_to).toBe('["a@x.com"]')
  })
})

describe("auth", () => {
  it("rejects Guest sessions", async () => {
    const c = new FrappeClient("/api/v1")
    responses.push(json({ message: "Guest" }))
    await expect(c.getLoggedInUser()).rejects.toThrow("Not authenticated")
  })

  it("maps the User doc and its roles", async () => {
    const c = new FrappeClient("/api/v1")
    responses.push(json({ message: "a@x.com" }), json({ data: { name: "a@x.com", email: "a@x.com", full_name: "A", roles: [{ role: "System Manager" }] } }))
    expect(await c.getLoggedInUser()).toMatchObject({ name: "a@x.com", roles: ["System Manager"] })
  })
})

describe("waitFor gate", () => {
  it("holds requests until the gate settles, then applies config set in the meantime", async () => {
    const c = new FrappeClient("/api/v1")
    let release!: () => void
    const ready = new Promise<void>((r) => { release = r })
    c.waitFor(ready)
    responses.push(json({ message: 1 }))
    const pending = c.callMethod("a.b")
    await Promise.resolve()
    expect(calls).toHaveLength(0)
    c.applyConfig({ beforeRequest: async (o) => ({ ...o, headers: { ...(o.headers as Record<string, string>), "X-App": "billing" } }) })
    release()
    await pending
    expect(calls).toHaveLength(1)
    expect(header(0, "X-App")).toBe("billing")
  })

  it("releases requests even when the gate rejects", async () => {
    const c = new FrappeClient("/api/v1")
    c.waitFor(Promise.reject(new Error("apps failed")))
    responses.push(json({ message: 2 }))
    await expect(c.callMethod("a.b")).resolves.toBe(2)
  })
})
