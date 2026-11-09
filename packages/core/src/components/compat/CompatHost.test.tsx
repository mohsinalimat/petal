/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it, vi, beforeAll } from "vitest"
import { act, fireEvent, render, screen } from "@testing-library/react"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))

const calls: Array<{ method: string; args: any }> = []
let w: any

beforeAll(async () => {
  const compat = await import("@/lib/frappe-compat")
  await compat.ensureCompat({
    transport: async (method, args) => {
      calls.push({ method, args })
      if (method === "frappe.sessions.get") return { status: 200, data: { message: { sysdefaults: { currency: "INR" }, user: { name: "Administrator", roles: ["Administrator"], defaults: {} } } } }
      if (method === "frappe.desk.search.search_link") return { status: 200, data: { message: [{ value: "ACME", description: "Acme Corp" }] } }
      if (method === "bad.method") return { status: 417, data: { exc_type: "ValidationError", _server_messages: JSON.stringify([JSON.stringify({ message: "Credit limit crossed", indicator: "red", raise_exception: 1 })]) } }
      return { status: 200, data: { message: { ok: 1 } } }
    },
    navigate: () => {},
    toast: () => {},
    autoBundles: false,
    fetchText: async () => "{}",
  })
  w = window as any
})

async function renderHost() {
  const { CompatHost } = await import("./CompatHost")
  return render(<CompatHost />)
}

describe("CompatHost", () => {
  it("shows frappe.msgprint and stacks messages in one dialog", async () => {
    await renderHost()
    act(() => { w.frappe.msgprint("First <b>message</b>"); w.frappe.msgprint({ message: "Second", title: "Heads up", indicator: "orange" }) })
    expect(screen.getByRole("dialog", { name: "Heads up" })).toBeTruthy()
    expect(screen.getByText("message").tagName).toBe("B")
    expect(screen.getByText("Second")).toBeTruthy()
    act(() => w.frappe.hide_msgprint())
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("strips scripts and handlers from server HTML", async () => {
    await renderHost()
    act(() => { w.frappe.msgprint('<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script><a href="javascript:alert(1)">x</a>ok') })
    const dialog = screen.getByRole("dialog")
    expect(dialog.querySelector("script")).toBeNull()
    expect(dialog.querySelector("img")?.getAttribute("onerror")).toBeNull()
    expect(dialog.querySelector("a")?.getAttribute("href")).toBeNull()
    act(() => w.frappe.hide_msgprint())
  })

  it("frappe.confirm runs the callback on Yes and the reject handler on No", async () => {
    await renderHost()
    const yes = vi.fn()
    const no = vi.fn()
    act(() => { w.frappe.confirm("Delete <b>it</b>?", yes, no) })
    fireEvent.click(screen.getByRole("button", { name: "Yes" }))
    expect(yes).toHaveBeenCalledOnce()
    expect(no).not.toHaveBeenCalled()
    act(() => { w.frappe.confirm("Again?", yes, no) })
    fireEvent.click(screen.getByRole("button", { name: "No" }))
    expect(no).toHaveBeenCalledOnce()
  })

  it("frappe.ui.Dialog: fields, onchange, depends_on, validation and primary action", async () => {
    await renderHost()
    const onPrimary = vi.fn()
    const onQtyChange = vi.fn()
    let d: any
    act(() => {
      d = new w.frappe.ui.Dialog({
        title: "Update Items",
        fields: [
          { fieldname: "qty", fieldtype: "Float", label: "Qty", reqd: 1, onchange(this: any) { onQtyChange(this.get_value()) } },
          { fieldname: "note", fieldtype: "Data", label: "Note", depends_on: "eval:doc.qty > 5" },
          { fieldname: "preview", fieldtype: "HTML", options: "<p class='pv'>Preview</p>" },
        ],
        primary_action_label: "Apply",
        primary_action: onPrimary,
      })
      d.show()
    })
    expect(screen.getByRole("dialog", { name: "Update Items" })).toBeTruthy()
    expect(screen.queryByText("Note")).toBeNull()

    // Required field blocks the primary action.
    fireEvent.click(screen.getByRole("button", { name: "Apply" }))
    expect(onPrimary).not.toHaveBeenCalled()
    expect(screen.getByRole("dialog", { name: "Missing Values Required" })).toBeTruthy()
    act(() => w.frappe.hide_msgprint())

    await act(async () => { await d.set_value("qty", 7) })
    expect(onQtyChange).toHaveBeenCalledWith(7)
    expect(screen.getByText("Note")).toBeTruthy()

    // Scripts write into HTML fields with jQuery; the live element is shown.
    act(() => { d.fields_dict.preview.$wrapper.html("<p>Totals: 700</p>") })
    expect(screen.getByText("Totals: 700")).toBeTruthy()

    fireEvent.click(screen.getByRole("button", { name: "Apply" }))
    expect(onPrimary).toHaveBeenCalledWith({ qty: 7 })
    act(() => d.hide())
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("server validation errors (417 + _server_messages) open a message and fail the call", async () => {
    await renderHost()
    const onError = vi.fn()
    let rejected = false
    await act(async () => {
      await w.frappe.call({ method: "bad.method", error: onError }).then(() => {}, () => { rejected = true })
    })
    expect(rejected).toBe(true)
    expect(onError).toHaveBeenCalled()
    expect(screen.getByText("Credit limit crossed")).toBeTruthy()
    act(() => w.frappe.hide_msgprint())
  })

  it("frappe.call sends nested args as JSON strings, like Desk", async () => {
    calls.length = 0
    await w.frappe.call({ method: "x.y", args: { doc: { a: 1 }, list: [1, 2], s: "t" } })
    expect(calls[0]).toEqual({ method: "x.y", args: { doc: '{"a":1}', list: "[1,2]", s: "t" } })
  })
})
