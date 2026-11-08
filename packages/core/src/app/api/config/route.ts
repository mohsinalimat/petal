import { type NextRequest, NextResponse } from "next/server"
import { getRequestConfig } from "@/lib/config/runtime-config"

export const dynamic = "force-dynamic"

export async function GET(request: NextRequest) {
  const cfg = getRequestConfig(request.headers)
  if (!cfg) return NextResponse.json({ error: "Unknown tenant" }, { status: 404 })
  // `site` is the Frappe site name — the realtime client joins its socket.io namespace.
  return NextResponse.json({ apps: cfg.apps, site: cfg.site })
}
