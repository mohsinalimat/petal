import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"

let dir: string
let cwd: string

beforeEach(() => {
  cwd = process.cwd()
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "petal-rc-"))
  fs.mkdirSync(path.join(dir, ".petal"))
  fs.writeFileSync(path.join(dir, ".petal/config.json"), JSON.stringify({
    apps: [{ name: "static", version: "1", url: "https://s/x.js" }],
    pathMap: { "auth/csrf": "api/method/x.csrf" },
  }))
  process.chdir(dir)
  vi.resetModules()
  vi.spyOn(console, "error").mockImplementation(() => {})
})
afterEach(() => {
  process.chdir(cwd)
  fs.rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

const load = async () => (await import("./runtime-config")).getRuntimeConfig

describe("getRuntimeConfig", () => {
  it("uses petal.config.ts apps when petal.apps.json is absent", async () => {
    const cfg = (await load())()
    expect(cfg.apps!.map((a) => a.name)).toEqual(["static"])
    expect(cfg.pathMap).toEqual({ "auth/csrf": "api/method/x.csrf" })
  })

  it("prefers petal.apps.json and re-reads it on every call", async () => {
    const get = await load()
    const file = path.join(dir, "petal.apps.json")
    fs.writeFileSync(file, JSON.stringify([{ name: "dyn1", version: "1", url: "https://d/1.js" }]))
    expect(get().apps!.map((a) => a.name)).toEqual(["dyn1"])
    fs.writeFileSync(file, JSON.stringify([{ name: "dyn2", version: "1", url: "https://d/2.js" }]))
    expect(get().apps!.map((a) => a.name)).toEqual(["dyn2"])
  })

  it("falls back to static apps when petal.apps.json is invalid or not an array", async () => {
    const get = await load()
    const file = path.join(dir, "petal.apps.json")
    fs.writeFileSync(file, "{not json")
    expect(get().apps!.map((a) => a.name)).toEqual(["static"])
    fs.writeFileSync(file, JSON.stringify({ name: "x" }))
    expect(get().apps!.map((a) => a.name)).toEqual(["static"])
  })
})

describe("PETAL_APPS", () => {
  afterEach(() => { delete process.env.PETAL_APPS })

  it("is used when petal.apps.json is absent", async () => {
    process.env.PETAL_APPS = JSON.stringify([{ name: "env-app", version: "1", url: "https://e/x.js" }])
    expect((await load())().apps!.map((a) => a.name)).toEqual(["env-app"])
  })

  it("loses to petal.apps.json and is ignored when malformed", async () => {
    const get = await load()
    process.env.PETAL_APPS = "{broken"
    expect(get().apps!.map((a) => a.name)).toEqual(["static"])
    process.env.PETAL_APPS = JSON.stringify([{ name: "env-app", version: "1", url: "https://e/x.js" }])
    fs.writeFileSync(path.join(dir, "petal.apps.json"), JSON.stringify([{ name: "file-app", version: "1", url: "https://f/x.js" }]))
    expect(get().apps!.map((a) => a.name)).toEqual(["file-app"])
  })
})

describe("appOrigins / parseAppsEnv", () => {
  it("collects unique origins from url and devUrl, skipping invalid ones", async () => {
    const { appOrigins } = await import("./runtime-config")
    expect(appOrigins([
      { url: "https://cdn.x.com/a/petal.hooks.js", devUrl: "http://localhost:5175/petal.hooks.js" },
      { url: "https://cdn.x.com/b/petal.hooks.js" },
      { url: "not a url" },
    ])).toEqual(["https://cdn.x.com", "http://localhost:5175"])
  })

  it("parses only JSON arrays", async () => {
    const { parseAppsEnv } = await import("./runtime-config")
    expect(parseAppsEnv(undefined)).toBeNull()
    expect(parseAppsEnv("  ")).toBeNull()
    expect(parseAppsEnv('{"a":1}')).toBeNull()
    expect(parseAppsEnv('[{"name":"a"}]')).toEqual([{ name: "a" }])
  })
})

describe("getRequestConfig", () => {
  afterEach(() => { delete process.env.PETAL_TENANTS })
  const h = (host: string) => ({ get: (k: string) => (k === "host" ? host : null) })

  it("returns static apps plus the site name in single-tenant mode", async () => {
    const { getRequestConfig } = await import("./runtime-config")
    const cfg = getRequestConfig(h("localhost:3000"))!
    expect(cfg.apps!.map((a) => a.name)).toEqual(["static"])
    expect(cfg.site).toBe("localhost")
  })

  it("uses the tenant's apps and merges its pathMap, or null for unknown hosts", async () => {
    process.env.PETAL_TENANTS = JSON.stringify({
      "acme.test": { frappeUrl: "http://acme:8000", apps: [{ name: "acme-app", version: "1", url: "https://c/a.js" }], pathMap: { "x/y": "api/method/x.y" } },
    })
    const { getRequestConfig } = await import("./runtime-config")
    const cfg = getRequestConfig(h("acme.test"))!
    expect(cfg.apps!.map((a) => a.name)).toEqual(["acme-app"])
    expect(cfg.pathMap).toEqual({ "auth/csrf": "api/method/x.csrf", "x/y": "api/method/x.y" })
    expect(cfg.site).toBe("acme")
    expect(getRequestConfig(h("nope.test"))).toBeNull()
  })
})
