import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { GET, POST } from "./route"

const BACKEND = "http://backend.internal:8000"

type FetchCall = { url: string; init: RequestInit }
let calls: FetchCall[]
let upstream: () => Response | Promise<Response>

beforeEach(() => {
  vi.stubEnv("FRAPPE_BACKEND_URL", BACKEND)
  vi.stubEnv("PETAL_TENANTS", "")
  calls = []
  upstream = () => new Response("{}", { status: 200, headers: { "content-type": "application/json" } })
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init })
    return upstream()
  }))
  vi.spyOn(console, "error").mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

function ctx(path: string) {
  return { params: Promise.resolve({ path: path.split("/") }) }
}

async function bodyBytes(body: RequestInit["body"]): Promise<Uint8Array> {
  return new Uint8Array(await new Response(body as BodyInit).arrayBuffer())
}

describe("API proxy — request bodies", () => {
  it("forwards binary uploads byte-for-byte", async () => {
    // Every byte value, including sequences that are invalid UTF-8.
    const payload = new Uint8Array(4096)
    for (let i = 0; i < payload.length; i++) payload[i] = (i * 37 + 11) % 256
    const req = new NextRequest("http://petal.test/api/v1/upload", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x" },
      body: payload,
    })

    await POST(req, ctx("upload"))

    expect(calls).toHaveLength(1)
    expect(calls[0]!.url).toBe(`${BACKEND}/api/method/upload_file`)
    expect(await bodyBytes(calls[0]!.init.body)).toEqual(payload)
  })

  it("forwards binary bodies on /exec unchanged", async () => {
    const payload = new Uint8Array([0xff, 0xfe, 0x00, 0xc3, 0x28, 0x80])
    const req = new NextRequest("http://petal.test/api/v1/exec", {
      method: "POST",
      headers: { "x-method": "frappe.client.get_list" },
      body: payload,
    })

    await POST(req, ctx("exec"))

    expect(await bodyBytes(calls[0]!.init.body)).toEqual(payload)
  })
})

describe("API proxy — response headers", () => {
  it("drops content-encoding and content-length after fetch has decoded the body", async () => {
    const json = '{"message":"hello"}'
    upstream = () => new Response(json, {
      status: 200,
      headers: { "content-type": "application/json", "content-encoding": "gzip", "content-length": "44" },
    })

    const res = await GET(new NextRequest("http://petal.test/api/v1/auth/me"), ctx("auth/me"))

    expect(res.headers.get("content-encoding")).toBeNull()
    expect(res.headers.get("content-length")).not.toBe("44")
    expect(await res.text()).toBe(json)
  })

  it("does the same for /assets pass-through", async () => {
    upstream = () => new Response("body{}", { headers: { "content-type": "text/css", "content-encoding": "br" } })

    const res = await GET(new NextRequest("http://petal.test/api/v1/assets/x.css"), ctx("assets/x.css"))

    expect(res.headers.get("content-encoding")).toBeNull()
    expect(await res.text()).toBe("body{}")
  })
})

describe("API proxy — /exec method names", () => {
  it.each(["../../private/secret", "frappe.client/../../x", "a?b=1", "a#b", "a b", "%2e%2e"])(
    "rejects %j without calling the backend",
    async (method) => {
      const req = new NextRequest("http://petal.test/api/v1/exec", { method: "POST", headers: { "x-method": method }, body: "{}" })

      const res = await POST(req, ctx("exec"))

      expect(res.status).toBe(400)
      expect(calls).toHaveLength(0)
    },
  )

  it("accepts dotted Python method paths", async () => {
    const req = new NextRequest("http://petal.test/api/v1/exec", {
      method: "POST",
      headers: { "x-method": "erpnext.accounts.doctype.sales_invoice.sales_invoice.make_delivery_note" },
      body: "{}",
    })

    const res = await POST(req, ctx("exec"))

    expect(res.status).toBe(200)
    expect(calls[0]!.url).toBe(`${BACKEND}/api/method/erpnext.accounts.doctype.sales_invoice.sales_invoice.make_delivery_note`)
  })
})

describe("API proxy — upstream failures", () => {
  it("returns 502 without leaking the backend address or error cause", async () => {
    upstream = () => { throw Object.assign(new TypeError("fetch failed"), { cause: new Error("connect ECONNREFUSED 10.0.0.5:8000") }) }

    const res = await GET(new NextRequest("http://petal.test/api/v1/doc/User"), ctx("doc/User"))
    const text = await res.text()

    expect(res.status).toBe(502)
    expect(text).not.toMatch(/ECONNREFUSED|10\.0\.0\.5|backend\.internal/)
  })
})
