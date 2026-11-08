import { existsSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import prompts from "prompts"
import pc from "picocolors"
import { findPetalCoreDir, validateAppName, validateBundleUrl } from "../lib/apps-config"
import type { PetalAppMeta } from "@petal/sdk"

const APPS_FILE = "petal.apps.json"
// petal.apps.json is re-read on every request; only the CSP's allowed origins are fixed at startup.
const RELOAD_HINT = "  Refresh the browser to apply. Restart petal start if the bundle is served from a new origin.\n"

function readApps(coreDir: string): PetalAppMeta[] {
  const filePath = join(coreDir, APPS_FILE)
  if (!existsSync(filePath)) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"))
  } catch {
    console.error(pc.red(`\n  ✖ ${APPS_FILE} contains invalid JSON. Fix it manually before continuing.\n`))
    process.exit(1)
  }
  if (!Array.isArray(parsed)) {
    console.error(pc.red(`\n  ✖ ${APPS_FILE} must be a JSON array. Fix it manually before continuing.\n`))
    process.exit(1)
  }
  return parsed as PetalAppMeta[]
}

function writeApps(coreDir: string, apps: PetalAppMeta[]): void {
  writeFileSync(join(coreDir, APPS_FILE), JSON.stringify(apps, null, 2) + "\n")
}

function getCoreDir(): string {
  const coreDir = findPetalCoreDir()
  if (!coreDir) {
    console.error(pc.red("\n  ✖ Could not find a Petal core directory. Run from inside your petal monorepo.\n"))
    process.exit(1)
  }
  return coreDir
}

export async function listApps(): Promise<void> {
  const coreDir = getCoreDir()
  const apps = readApps(coreDir)

  if (apps.length === 0) {
    console.log(pc.dim("\n  No apps registered in petal.apps.json\n"))
    console.log(pc.dim("  Run: petal app add\n"))
    return
  }

  console.log(`\n  ${pc.bold("Registered apps")} ${pc.dim("(" + join(coreDir, APPS_FILE) + ")")}\n`)
  for (const app of apps) {
    console.log(`  ${pc.green("●")} ${pc.bold(app.name)} ${pc.dim("v" + app.version)}`)
    if (app.devUrl) console.log(`      ${pc.dim("dev:")}  ${pc.cyan(app.devUrl)}`)
    console.log(`      ${pc.dim("prod:")} ${pc.cyan(app.url)}`)
  }
  console.log()
}

export async function addApp(): Promise<void> {
  const coreDir = getCoreDir()
  const apps = readApps(coreDir)

  const answers = await prompts(
    [
      {
        type: "text",
        name: "name",
        message: "App name:",
        validate: (v: string) => validateAppName(v, apps.map((a) => a.name)),
      },
      {
        type: "text",
        name: "version",
        message: "Version:",
        initial: "0.1.0",
      },
      {
        type: "text",
        name: "devUrl",
        message: "Dev server URL (leave blank if none):",
        initial: "",
        validate: (v: string) => validateBundleUrl(v, true),
      },
      {
        type: "text",
        name: "url",
        message: "Production bundle URL:",
        validate: (v: string) => validateBundleUrl(v),
      },
    ],
    { onCancel: () => process.exit(0) },
  )

  const newApp: PetalAppMeta = {
    name: answers.name as string,
    version: answers.version as string,
    url: answers.url as string,
    ...((answers.devUrl as string) ? { devUrl: answers.devUrl as string } : {}),
  }

  apps.push(newApp)
  writeApps(coreDir, apps)

  console.log(`\n  ${pc.green("✓")} Registered ${pc.bold(answers.name as string)} in petal.apps.json`)
  console.log(pc.dim(RELOAD_HINT))
}

export async function updateApp(name: string): Promise<void> {
  const coreDir = getCoreDir()
  const apps = readApps(coreDir)
  const idx = apps.findIndex((a) => a.name === name)

  if (idx === -1) {
    console.error(pc.red(`\n  ✖ App "${name}" not found in petal.apps.json\n`))
    process.exit(1)
  }

  const existing = apps[idx]!

  const answers = await prompts(
    [
      {
        type: "text",
        name: "version",
        message: "Version:",
        initial: existing.version,
      },
      {
        type: "text",
        name: "devUrl",
        message: "Dev server URL (leave blank to remove):",
        initial: existing.devUrl ?? "",
        validate: (v: string) => validateBundleUrl(v, true),
      },
      {
        type: "text",
        name: "url",
        message: "Production bundle URL:",
        initial: existing.url,
        validate: (v: string) => validateBundleUrl(v),
      },
    ],
    { onCancel: () => process.exit(0) },
  )

  apps[idx] = {
    name,
    version: answers.version as string,
    url: answers.url as string,
    ...((answers.devUrl as string) ? { devUrl: answers.devUrl as string } : {}),
  }
  writeApps(coreDir, apps)

  console.log(`\n  ${pc.green("✓")} Updated ${pc.bold(name)} in petal.apps.json`)
  console.log(pc.dim(RELOAD_HINT))
}

export async function removeApp(name: string): Promise<void> {
  const coreDir = getCoreDir()
  const apps = readApps(coreDir)
  const idx = apps.findIndex((a) => a.name === name)

  if (idx === -1) {
    console.error(pc.red(`\n  ✖ App "${name}" not found in petal.apps.json\n`))
    process.exit(1)
  }

  const { confirm } = await prompts(
    {
      type: "confirm",
      name: "confirm",
      message: `Remove "${name}"?`,
      initial: false,
    },
    { onCancel: () => process.exit(0) },
  )

  if (!confirm) { console.log(pc.dim("  Aborted.\n")); return }

  apps.splice(idx, 1)
  writeApps(coreDir, apps)

  console.log(`\n  ${pc.green("✓")} Removed ${pc.bold(name)} from petal.apps.json`)
  console.log(pc.dim(RELOAD_HINT))
}
