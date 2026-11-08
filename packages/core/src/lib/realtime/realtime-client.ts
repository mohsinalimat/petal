// Thin wrapper around Frappe's socket.io realtime server.
//
// Frappe emits `list_update` (to doctype rooms) and `doc_update` (to doc rooms)
// after every save. Clients join those rooms with `doctype_subscribe` /
// `doc_subscribe`. This class ref-counts subscriptions so many components can
// listen to the same doctype, and re-joins rooms after a reconnect.

export interface RealtimeSocket {
  connected: boolean
  on(event: string, cb: (...args: unknown[]) => void): unknown
  off(event: string, cb?: (...args: unknown[]) => void): unknown
  emit(event: string, ...args: unknown[]): unknown
  disconnect(): unknown
}

export type ListUpdate = { doctype: string; name?: string; user?: string; modified?: string }
export type DocUpdate = { doctype: string; name: string; modified?: string; user?: string }

type Handler<T> = (payload: T) => void

export class RealtimeClient {
  private socket: RealtimeSocket
  private listHandlers = new Map<string, Set<Handler<ListUpdate>>>()
  private docHandlers = new Map<string, Set<Handler<DocUpdate>>>()

  constructor(socket: RealtimeSocket) {
    this.socket = socket
    socket.on("connect", () => this.resubscribe())
    socket.on("list_update", (p) => this.dispatchList(p as ListUpdate))
    socket.on("doc_update", (p) => this.dispatchDoc(p as DocUpdate))
  }

  get connected(): boolean {
    return this.socket.connected
  }

  /** Call `cb` whenever any record of `doctype` is created, saved or deleted. Returns an unsubscribe fn. */
  onListUpdate(doctype: string, cb: Handler<ListUpdate>): () => void {
    let set = this.listHandlers.get(doctype)
    if (!set) {
      set = new Set()
      this.listHandlers.set(doctype, set)
      if (this.socket.connected) this.socket.emit("doctype_subscribe", doctype)
    }
    set.add(cb)
    return () => {
      const s = this.listHandlers.get(doctype)
      if (!s) return
      s.delete(cb)
      if (s.size === 0) {
        this.listHandlers.delete(doctype)
        if (this.socket.connected) this.socket.emit("doctype_unsubscribe", doctype)
      }
    }
  }

  /** Call `cb` whenever the document is saved by anyone. Returns an unsubscribe fn. */
  onDocUpdate(doctype: string, name: string, cb: Handler<DocUpdate>): () => void {
    const key = docKey(doctype, name)
    let set = this.docHandlers.get(key)
    if (!set) {
      set = new Set()
      this.docHandlers.set(key, set)
      if (this.socket.connected) {
        this.socket.emit("doc_subscribe", doctype, name)
        this.socket.emit("doc_open", doctype, name)
      }
    }
    set.add(cb)
    return () => {
      const s = this.docHandlers.get(key)
      if (!s) return
      s.delete(cb)
      if (s.size === 0) {
        this.docHandlers.delete(key)
        if (this.socket.connected) {
          this.socket.emit("doc_close", doctype, name)
          this.socket.emit("doc_unsubscribe", doctype, name)
        }
      }
    }
  }

  close(): void {
    this.listHandlers.clear()
    this.docHandlers.clear()
    this.socket.disconnect()
  }

  private resubscribe() {
    for (const doctype of this.listHandlers.keys()) this.socket.emit("doctype_subscribe", doctype)
    for (const key of this.docHandlers.keys()) {
      const [doctype, name] = splitDocKey(key)
      this.socket.emit("doc_subscribe", doctype, name)
      this.socket.emit("doc_open", doctype, name)
    }
  }

  private dispatchList(p: ListUpdate) {
    if (!p?.doctype) return
    this.listHandlers.get(p.doctype)?.forEach((cb) => cb(p))
  }

  private dispatchDoc(p: DocUpdate) {
    if (!p?.doctype || !p.name) return
    this.docHandlers.get(docKey(p.doctype, p.name))?.forEach((cb) => cb(p))
  }
}

const SEP = "\u0000"
function docKey(doctype: string, name: string) { return `${doctype}${SEP}${name}` }
function splitDocKey(key: string): [string, string] {
  const i = key.indexOf(SEP)
  return [key.slice(0, i), key.slice(i + 1)]
}

/** Trailing-edge debounce — collapses bursts of realtime events into one refetch. */
export function debounce<A extends unknown[]>(fn: (...args: A) => void, ms: number): ((...args: A) => void) & { cancel: () => void } {
  let t: ReturnType<typeof setTimeout> | null = null
  const wrapped = (...args: A) => {
    if (t) clearTimeout(t)
    t = setTimeout(() => { t = null; fn(...args) }, ms)
  }
  wrapped.cancel = () => { if (t) clearTimeout(t); t = null }
  return wrapped
}

/**
 * Socket.io namespace for a Frappe site. Frappe's realtime server mounts one
 * namespace per site, named after the site (e.g. "/erp.example.com").
 */
export function siteNamespace(siteName: string): string {
  return "/" + siteName.replace(/^\/+/, "")
}
