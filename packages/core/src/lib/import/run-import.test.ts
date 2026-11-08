import { describe, it, expect, vi } from "vitest"
import { runImport } from "./run-import"

const docs = (n: number) => Array.from({ length: n }, (_, i) => ({ doctype: "Task", subject: `T${i + 1}` }))

type Fn = ReturnType<typeof vi.fn>

function api(overrides: { insertMany?: Fn; insertOne?: Fn; update?: Fn } = {}) {
  return {
    insertMany: vi.fn().mockResolvedValue([]),
    insertOne: vi.fn().mockResolvedValue({}),
    update: vi.fn().mockResolvedValue({}),
    ...overrides,
  }
}

describe("runImport — insert", () => {
  it("inserts in batches and reports progress", async () => {
    const a = api()
    const progress = vi.fn()
    const res = await runImport(docs(5), "insert", a, progress, 2)
    expect(a.insertMany).toHaveBeenCalledTimes(3)
    expect(a.insertMany.mock.calls[2]![0]).toHaveLength(1)
    expect(progress.mock.calls.map((c) => c[0])).toEqual([2, 4, 5])
    expect(res).toEqual({ succeeded: 5, failed: [] })
  })

  it("retries a failed batch row-by-row and reports the exact bad rows", async () => {
    const a = api({
      insertMany: vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new Error("batch failed")),
      insertOne: vi.fn(async (d: Record<string, unknown>) => { if (d.subject === "T4") throw new Error("Duplicate T4") }),
    })
    const res = await runImport(docs(4), "insert", a, undefined, 2)
    expect(a.insertOne).toHaveBeenCalledTimes(2)
    expect(res).toEqual({ succeeded: 3, failed: [{ row: 4, message: "Duplicate T4" }] })
  })
})

describe("runImport — update", () => {
  it("updates by name without sending doctype/name as values", async () => {
    const a = api()
    const res = await runImport([{ doctype: "Task", name: "T-1", status: "Closed" }], "update", a)
    expect(a.update).toHaveBeenCalledWith("Task", "T-1", { status: "Closed" })
    expect(res.succeeded).toBe(1)
  })

  it("fails rows without an ID and rows the server rejects, continuing with the rest", async () => {
    const a = api({ update: vi.fn().mockRejectedValueOnce(new Error("Not found")).mockResolvedValue({}) })
    const res = await runImport(
      [{ doctype: "Task", name: "X" }, { doctype: "Task" }, { doctype: "Task", name: "T-3" }],
      "update", a,
    )
    expect(res.succeeded).toBe(1)
    expect(res.failed).toEqual([{ row: 1, message: "Not found" }, { row: 2, message: expect.stringMatching(/ID is empty/) }])
  })
})
