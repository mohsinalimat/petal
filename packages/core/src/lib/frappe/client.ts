import type { FrappeDocument, FrappeListParams, FrappeUser, FrappeClientConfig } from "@petal/sdk"
import { FrappeAPI } from "@/lib/frappe/api-config"

const DEFAULT_TTL_MS = 30_000 // 30 seconds

export type WorkflowTransition = {
  action: string
  next_state: string
  state?: string
  allowed?: string
  allow_self_approval?: 0 | 1
}

/** Shape of frappe.desk.form.load.get_docinfo — see @petal/ui DocInfo for the fields Petal renders. */
export type DocInfoResponse = Record<string, unknown>

interface CacheEntry {
  data: unknown
  expiresAt: number
}

export class FrappeClient {
  private baseUrl: string
  private config: FrappeClientConfig
  private cache = new Map<string, CacheEntry>()
  /** Deduplicates concurrent identical GET requests — same URL shares one in-flight Promise. */
  private inflight = new Map<string, Promise<unknown>>()
  private csrfToken: string | null = null
  private csrfFetchPromise: Promise<void> | null = null
  /** Requests wait on this before sending, so config applied later (app overrides) still covers them. */
  private gate: Promise<unknown> | null = null

  constructor(baseUrl: string, config?: FrappeClientConfig) {
    this.baseUrl = baseUrl.replace(/\/$/, "")
    this.config = config ?? {}
  }

  applyConfig(config: FrappeClientConfig): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Hold every request until `ready` settles (resolved or rejected), e.g.
   * until custom apps have loaded and their `overrides.frappeClient` has been
   * applied. Lets the UI render early without requests escaping the config.
   */
  waitFor(ready: Promise<unknown>): void {
    const settled = ready.then(() => undefined, () => undefined)
    this.gate = settled
    void settled.then(() => { if (this.gate === settled) this.gate = null })
  }

  /** Remove all cache entries whose key contains `pattern`. */
  invalidate(pattern?: string): void {
    if (!pattern) {
      this.cache.clear()
      return
    }
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) this.cache.delete(key)
    }
  }

  private request<T>(path: string, options?: RequestInit): Promise<T> {
    const method = (options?.method ?? "GET").toUpperCase()
    const isRead = method === "GET"
    const cacheKey = isRead ? path : null

    if (cacheKey) {
      const hit = this.cache.get(cacheKey)
      if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data as T)

      const flying = this.inflight.get(cacheKey) as Promise<T> | undefined
      if (flying) return flying
    }

    const promise = this._doFetch<T>(path, options, cacheKey)
    if (cacheKey) {
      this.inflight.set(cacheKey, promise)
      void promise.finally(() => this.inflight.delete(cacheKey)).catch(() => {})
    }
    return promise
  }

  private async _doFetch<T>(path: string, options: RequestInit | undefined, cacheKey: string | null): Promise<T> {
    if (this.gate) await this.gate
    const method = (options?.method ?? "GET").toUpperCase()

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }

    const csrfToken = this.getCSRFToken()
    if (csrfToken && method !== "GET") {
      headers["X-CSRF-Token"] = csrfToken
    }

    let requestOptions: RequestInit & { path: string } = {
      path,
      credentials: "include",
      ...options,
      headers: { ...headers, ...(options?.headers as Record<string, string> | undefined) },
    }

    if (this.config.beforeRequest) {
      requestOptions = await this.config.beforeRequest(requestOptions)
    }

    const { path: finalPath, ...fetchOptions } = requestOptions

    const res = await fetch(`${this.baseUrl}${finalPath}`, fetchOptions)
    if (!res.ok) {
      let msg = `${res.status} ${res.statusText} (${path})`
      try {
        const errBody = await res.json() as Record<string, unknown>
        if (typeof errBody._server_messages === "string") {
          const outer = JSON.parse(errBody._server_messages) as unknown[]
          const first = outer[0]
          const msgObj = (typeof first === "string" ? JSON.parse(first) : first) as { message?: string }
          if (msgObj?.message) msg = FrappeClient.stripFrappeHtml(msgObj.message)
        } else if (typeof errBody.exception === "string") {
          const colon = errBody.exception.indexOf(": ")
          msg = colon >= 0 ? errBody.exception.slice(colon + 2) : errBody.exception
        }
      } catch {}
      throw new Error(msg)
    }

    let json = await res.json()

    if (this.config.afterRequest) {
      json = await this.config.afterRequest(json)
    }

    const data = json.data ?? json.message ?? json

    if (cacheKey) {
      this.cache.set(cacheKey, { data, expiresAt: Date.now() + DEFAULT_TTL_MS })
    }

    return data as T
  }

  private static stripFrappeHtml(html: string): string {
    if (!/<[^>]+>/.test(html)) return html
    if (typeof document !== "undefined") {
      const el = document.createElement("div")
      el.innerHTML = html
      // Frappe wraps messages in <details><summary>user msg</summary>technical detail</details>
      // Use the summary as the concise, user-facing message
      const summary = el.querySelector("summary")
      if (summary) return summary.textContent?.trim() ?? ""
      return el.textContent?.trim() ?? ""
    }
    return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
  }

  private getCSRFToken(): string {
    if (this.csrfToken) return this.csrfToken
    // fallback: some Frappe setups expose csrf_token as a cookie
    if (typeof document === "undefined") return ""
    const raw = document.cookie
      .split("; ")
      .find((r) => r.startsWith("csrf_token="))
      ?.split("=")
      .slice(1)
      .join("=") ?? ""
    try {
      return decodeURIComponent(raw)
    } catch {
      return raw
    }
  }

  /**
   * Call a whitelisted method and return Frappe's raw response — `message`,
   * `docs`, `_server_messages`, `exc` — with the HTTP status, never throwing on
   * an error status. Used by the Frappe-compatible form runtime, which needs
   * the full Desk response shape. Not cached.
   */
  async rawCall(method: string, args: Record<string, unknown>): Promise<{ status: number; data: Record<string, unknown> | null }> {
    if (this.gate) await this.gate
    if (!this.csrfToken) await this.initCSRF()
    const headers: Record<string, string> = { "Content-Type": "application/json", "X-Method": method, Accept: "application/json" }
    const csrfToken = this.getCSRFToken()
    if (csrfToken) headers["X-CSRF-Token"] = csrfToken
    let requestOptions: RequestInit & { path: string } = {
      path: "/exec", method: "POST", credentials: "include", headers, body: JSON.stringify(args),
    }
    if (this.config.beforeRequest) requestOptions = await this.config.beforeRequest(requestOptions)
    const { path, ...fetchOptions } = requestOptions
    const res = await fetch(`${this.baseUrl}${path}`, fetchOptions)
    let data: Record<string, unknown> | null = null
    try { data = (await res.json()) as Record<string, unknown> } catch { data = null }
    if (data && res.ok && this.config.afterRequest) data = (await this.config.afterRequest(data)) as Record<string, unknown>
    return { status: res.status, data }
  }

  /** Desk's boot data (frappe.boot) for the signed-in session; see BOOT_PATH. */
  async getBoot(): Promise<Record<string, unknown>> {
    if (this.gate) await this.gate
    const res = await fetch(`${this.baseUrl}/auth/boot`, { method: "GET", credentials: "include", headers: { Accept: "application/json" }, cache: "no-store" })
    if (!res.ok) throw new Error(res.status === 401 ? "Not logged in" : `Could not load the session (${res.status})`)
    const json = (await res.json()) as { message?: Record<string, unknown> }
    if (!json.message || typeof json.message !== "object") throw new Error("Could not load the session")
    return json.message
  }

  async initCSRF(): Promise<void> {
    if (this.csrfToken) return
    if (!this.csrfFetchPromise) {
      this.csrfFetchPromise = (async () => {
        try {
          const res = await fetch(`${this.baseUrl}/auth/csrf`, {
            method: "GET",
            credentials: "include",
            headers: { Accept: "application/json" },
          })
          if (res.ok) {
            const json = await res.json() as { data?: string; message?: string }
            const token = json.data ?? json.message ?? null
            if (typeof token === "string" && token) this.csrfToken = token
          }
        } catch {
          // Non-fatal: ignore_csrf fallback will handle it
        } finally {
          this.csrfFetchPromise = null
        }
      })()
    }
    return this.csrfFetchPromise
  }

  async login(usr: string, pwd: string): Promise<void> {
    this.csrfToken = null
    await this.request(FrappeAPI.ENDPOINTS.AUTH.LOGIN, {
      method: "POST",
      body: JSON.stringify({ usr, pwd }),
    })
    void this.initCSRF()
  }

  async logout(): Promise<void> {
    await this.request(FrappeAPI.ENDPOINTS.AUTH.LOGOUT, { method: "POST" })
  }

  async getLoggedInUser(): Promise<FrappeUser> {
    const username = await this.request<string>(FrappeAPI.ENDPOINTS.AUTH.GET_LOGGED_IN_USER)
    // Frappe returns "Guest" for unauthenticated sessions
    if (!username || username === "Guest") throw new Error("Not authenticated")
    const doc = await this.request<Record<string, unknown>>(
      `${FrappeAPI.ENDPOINTS.RESOURCE.BASE}/User/${username}`
    )
    return {
      name: doc.name as string,
      email: doc.email as string,
      full_name: doc.full_name as string,
      first_name: doc.first_name as string,
      username: doc.username as string,
      user_type: doc.user_type as string,
      roles: ((doc.roles as Array<{ role: string }>) ?? []).map((r) => r.role),
      ...(doc.user_image ? { user_image: doc.user_image as string } : {}),
      ...(doc.time_zone  ? { time_zone:  doc.time_zone  as string } : {}),
      ...(doc.desk_theme ? { desk_theme: doc.desk_theme as string } : {}),
    }
  }

  async getDoc<T extends FrappeDocument>(doctype: string, name: string): Promise<T> {
    const path = `${FrappeAPI.ENDPOINTS.RESOURCE.BASE}/${doctype}/${name}`
    return this.request<T>(path)
  }

  async getList<T extends FrappeDocument>(params: FrappeListParams): Promise<T[]> {
    const qs = new URLSearchParams({
      fields: JSON.stringify(params.fields ?? ["name"]),
      filters: JSON.stringify(params.filters ?? []),
      ...(params.or_filters?.length ? { or_filters: JSON.stringify(params.or_filters) } : {}),
      limit: String(params.limit ?? 20),
      limit_start: String(params.limit_start ?? 0),
      ...(params.order_by ? { order_by: params.order_by } : {}),
    })
    const path = `${FrappeAPI.ENDPOINTS.RESOURCE.BASE}/${params.doctype}?${qs}`
    return this.request<T[]>(path)
  }

  async saveDoc<T extends FrappeDocument>(doc: Partial<T> & { doctype: string }): Promise<T> {
    const isNew = !doc.name
    const path = isNew
      ? `${FrappeAPI.ENDPOINTS.RESOURCE.BASE}/${doc.doctype}`
      : `${FrappeAPI.ENDPOINTS.RESOURCE.BASE}/${doc.doctype}/${doc.name}`
    const result = await this.request<T>(path, { method: isNew ? "POST" : "PUT", body: JSON.stringify(doc) })
    this.invalidate(doc.doctype)
    return result
  }

  async deleteDoc(doctype: string, name: string): Promise<void> {
    const path = `${FrappeAPI.ENDPOINTS.RESOURCE.BASE}/${doctype}/${name}`
    await this.request<void>(path, { method: "DELETE" })
    this.invalidate(doctype)
  }

  async callMethod<T>(method: string, args?: Record<string, unknown>, options?: { cache?: boolean }): Promise<T> {
    const fetchOptions: RequestInit = {
      method: "POST",
      headers: { "X-Method": method },
      ...(args ? { body: JSON.stringify(args) } : {}),
    }

    if (!options?.cache) {
      return this.request<T>("/exec", fetchOptions)
    }

    const cacheKey = `exec:${method}:${JSON.stringify(args ?? {})}`

    const hit = this.cache.get(cacheKey)
    if (hit && hit.expiresAt > Date.now()) return Promise.resolve(hit.data as T)

    const flying = this.inflight.get(cacheKey) as Promise<T> | undefined
    if (flying) return flying

    const promise = this._doFetch<T>("/exec", fetchOptions, cacheKey)
    this.inflight.set(cacheKey, promise)
    void promise.finally(() => this.inflight.delete(cacheKey)).catch(() => {})
    return promise
  }

  /** Set one or more fields on a saved document without loading/saving the full doc. */
  async setValue<T extends FrappeDocument>(doctype: string, name: string, values: Record<string, unknown>): Promise<T> {
    const result = await this.callMethod<T>("frappe.client.set_value", { doctype, name, fieldname: values })
    this.invalidate(doctype)
    return result
  }

  /** Comments, versions, attachments, assignments and activity logs for a document. */
  async getDocInfo(doctype: string, name: string): Promise<DocInfoResponse> {
    // get_docinfo writes to frappe.response["docinfo"] rather than returning a value
    const res = await this.callMethod<Record<string, unknown>>("frappe.desk.form.load.get_docinfo", { doctype, name })
    return ((res?.docinfo ?? res) ?? {}) as DocInfoResponse
  }

  async addComment(doctype: string, name: string, html: string, user: { email: string; fullName: string }): Promise<void> {
    await this.callMethod("frappe.desk.form.utils.add_comment", {
      reference_doctype: doctype,
      reference_name: name,
      content: html,
      comment_email: user.email,
      comment_by: user.fullName,
    })
  }

  async deleteComment(commentName: string): Promise<void> {
    await this.callMethod("frappe.client.delete", { doctype: "Comment", name: commentName })
  }

  async assign(doctype: string, name: string, users: string[]): Promise<void> {
    await this.callMethod("frappe.desk.form.assign_to.add", { doctype, name, assign_to: JSON.stringify(users) })
  }

  async unassign(doctype: string, name: string, user: string): Promise<void> {
    await this.callMethod("frappe.desk.form.assign_to.remove", { doctype, name, assign_to: user })
  }

  async removeAttachment(doctype: string, name: string, fileId: string): Promise<void> {
    await this.callMethod("frappe.desk.form.utils.remove_attach", { fid: fileId, dt: doctype, dn: name })
  }

  /**
   * Bulk update / submit / cancel. Frappe runs ≤20 docs inline and queues larger
   * batches as a background job, so a large batch may still be in flight when this resolves.
   * Returns the names that failed (inline runs only).
   */
  async bulkAction(
    doctype: string,
    names: string[],
    action: "update" | "submit" | "cancel",
    data?: Record<string, unknown>,
  ): Promise<string[]> {
    const failed = await this.callMethod<string[] | null>(
      "frappe.desk.doctype.bulk_update.bulk_update.submit_cancel_or_update_docs",
      { doctype, docnames: JSON.stringify(names), action, data: JSON.stringify(data ?? {}) },
    )
    this.invalidate(doctype)
    return Array.isArray(failed) ? failed : []
  }

  /** Insert many documents in one transaction — any failure rolls back the whole batch. */
  async insertMany(docs: Array<Record<string, unknown> & { doctype: string }>): Promise<string[]> {
    const names = await this.callMethod<string[]>("frappe.client.insert_many", { docs: JSON.stringify(docs) })
    const first = docs[0]
    if (first) this.invalidate(first.doctype)
    return names
  }

  async getWorkflowTransitions(doc: Record<string, unknown>): Promise<WorkflowTransition[]> {
    const res = await this.callMethod<WorkflowTransition[]>("frappe.model.workflow.get_transitions", { doc: JSON.stringify(doc) })
    return Array.isArray(res) ? res : []
  }

  async applyWorkflow<T extends FrappeDocument>(doc: Record<string, unknown>, action: string): Promise<T> {
    const res = await this.callMethod<T>("frappe.model.workflow.apply_workflow", { doc: JSON.stringify(doc), action })
    if (typeof doc.doctype === "string") this.invalidate(doc.doctype)
    return res
  }

  async uploadFile(file: File, meta?: { doctype?: string; docname?: string; fieldname?: string; is_private?: 0 | 1 }): Promise<string> {
    const form = new FormData()
    form.append("file", file)
    form.append("is_private", String(meta?.is_private ?? 0))
    if (meta?.doctype)  form.append("doctype",  meta.doctype)
    if (meta?.docname)  form.append("docname",  meta.docname)
    if (meta?.fieldname) form.append("fieldname", meta.fieldname)

    // Must NOT set Content-Type — browser sets it with the multipart boundary
    const headers: Record<string, string> = {}
    const csrf = this.getCSRFToken()
    if (csrf) headers["X-CSRF-Token"] = csrf

    const res = await fetch(`${this.baseUrl}/upload`, {
      method: "POST",
      credentials: "include",
      headers,
      body: form,
    })

    if (!res.ok) {
      throw new Error(`Upload failed: ${res.status} ${res.statusText}`)
    }

    const json = await res.json() as { message?: { file_url?: string }; file_url?: string }
    const url = json.message?.file_url ?? json.file_url
    if (!url) throw new Error("Upload succeeded but server returned no file URL")
    return url
  }
}
