// Runs a data import against Frappe with per-row error reporting.
//
// Inserts go in batches through frappe.client.insert_many (one transaction per
// batch). When a batch fails, Frappe rolls the whole batch back and only reports
// the first error, so the batch is retried row-by-row to pinpoint bad rows while
// still importing the good ones.

import { chunk } from "@petal/ui"
import type { ImportMode, ImportResult } from "@petal/ui"

export type ImportApi = {
  insertMany: (docs: Array<Record<string, unknown> & { doctype: string }>) => Promise<unknown>
  insertOne: (doc: Record<string, unknown> & { doctype: string }) => Promise<unknown>
  update: (doctype: string, name: string, values: Record<string, unknown>) => Promise<unknown>
}

export const BATCH_SIZE = 50

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export async function runImport(
  docs: Record<string, unknown>[],
  mode: ImportMode,
  api: ImportApi,
  onProgress: (done: number) => void = () => {},
  batchSize = BATCH_SIZE,
): Promise<ImportResult> {
  const result: ImportResult = { succeeded: 0, failed: [] }
  let done = 0

  if (mode === "update") {
    for (let i = 0; i < docs.length; i++) {
      const { doctype, name, ...values } = docs[i]!
      try {
        if (!name) throw new Error("ID is empty — can't match an existing record")
        await api.update(String(doctype), String(name), values)
        result.succeeded++
      } catch (e) {
        result.failed.push({ row: i + 1, message: message(e) })
      }
      onProgress(++done)
    }
    return result
  }

  const batches = chunk(docs.map((d, i) => ({ d, row: i + 1 })), batchSize)
  for (const batch of batches) {
    try {
      await api.insertMany(batch.map((b) => b.d as Record<string, unknown> & { doctype: string }))
      result.succeeded += batch.length
      done += batch.length
      onProgress(done)
    } catch {
      for (const { d, row } of batch) {
        try {
          await api.insertOne(d as Record<string, unknown> & { doctype: string })
          result.succeeded++
        } catch (e) {
          result.failed.push({ row, message: message(e) })
        }
        onProgress(++done)
      }
    }
  }
  return result
}
