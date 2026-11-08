import { describe, it, expect, afterEach } from "vitest"
import fs from "fs"
import os from "os"
import path from "path"
import { findAppDirectory, findPetalCoreDir, validateAppName, validateBundleUrl } from "./apps-config"

const tmp: string[] = []
function mkdir(...parts: string[]) {
  const p = path.join(...parts)
  fs.mkdirSync(p, { recursive: true })
  return p
}
function root() {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "petal-cli-")))
  tmp.push(d)
  return d
}
afterEach(() => { for (const d of tmp.splice(0)) fs.rmSync(d, { recursive: true, force: true }) })

describe("findPetalCoreDir", () => {
  it("finds core from inside it, from the monorepo root, and from a sibling workspace", () => {
    const r = root()
    const core = mkdir(r, "petal", "packages", "core")
    fs.writeFileSync(path.join(core, "next.config.js"), "")
    expect(findPetalCoreDir(mkdir(core, "src", "app"))).toBe(core)
    expect(findPetalCoreDir(path.join(r, "petal"))).toBe(core)
    expect(findPetalCoreDir(mkdir(r, "my-app", "src"))).toBe(core)
  })

  it("returns null when there is no core directory", () => {
    expect(findPetalCoreDir(mkdir(root(), "a", "b"))).toBeNull()
  })
})

describe("findAppDirectory", () => {
  it("finds an app next to the monorepo or inside core/apps", () => {
    const r = root()
    const core = mkdir(r, "petal", "packages", "core")
    const sibling = mkdir(r, "billing-fe")
    fs.writeFileSync(path.join(sibling, "package.json"), "{}")
    expect(findAppDirectory("billing-fe", core)).toBe(sibling)
    const inner = mkdir(core, "apps", "inner")
    fs.writeFileSync(path.join(inner, "package.json"), "{}")
    expect(findAppDirectory("inner", core)).toBe(inner)
    expect(findAppDirectory("missing", core)).toBeNull()
  })
})

describe("validators", () => {
  it("accepts absolute http(s) bundle URLs only", () => {
    expect(validateBundleUrl("https://cdn.example.com/app/petal.hooks.js")).toBe(true)
    expect(validateBundleUrl("http://localhost:5175/petal.hooks.js")).toBe(true)
    expect(validateBundleUrl("")).toBe("Required")
    expect(validateBundleUrl("", true)).toBe(true)
    expect(validateBundleUrl("cdn.example.com/x.js")).toMatch(/absolute URL/)
    expect(validateBundleUrl("ftp://x/y.js")).toMatch(/http/)
  })

  it("validates app names", () => {
    expect(validateAppName("billing-fe", [])).toBe(true)
    expect(validateAppName("Billing", [])).toMatch(/lowercase/)
    expect(validateAppName("1app", [])).toMatch(/lowercase/)
    expect(validateAppName("billing-fe", ["billing-fe"])).toMatch(/already registered/)
  })
})
