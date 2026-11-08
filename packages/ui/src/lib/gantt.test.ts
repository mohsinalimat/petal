import { describe, it, expect } from "vitest"
import { addDays, buildBars, buildTicks, daysBetween, shiftDates } from "./gantt"

describe("daysBetween / addDays", () => {
  it("counts whole days, including across DST changes", () => {
    expect(daysBetween(new Date(2026, 2, 1), new Date(2026, 3, 1))).toBe(31)
    expect(daysBetween(new Date(2026, 9, 20), new Date(2026, 10, 10))).toBe(21)
    expect(daysBetween(new Date(2026, 0, 2), new Date(2026, 0, 1))).toBe(-1)
  })

  it("adds days across month ends", () => {
    expect(addDays(new Date(2026, 0, 30), 3).getDate()).toBe(2)
  })
})

describe("buildBars", () => {
  const rows = [
    { name: "T2", title: "Build", s: "2026-01-05", e: "2026-01-09", p: 50 },
    { name: "T1", title: "Plan", s: "2026-01-01", e: "2026-01-02", p: 140 },
    { name: "T3", title: "", s: "2026-01-10", e: "2026-01-03", p: "x" },
    { name: "T4", title: "Undated", s: null, e: "2026-01-03" },
  ]

  it("returns no range when nothing has a start date", () => {
    expect(buildBars([{ name: "x" }], "s", "e", "title")).toEqual({ bars: [], range: null })
  })

  it("sorts by start, pads the range by a day each side, and drops undated rows", () => {
    const { bars, range } = buildBars(rows, "s", "e", "title", "p")
    expect(bars.map((b) => b.name)).toEqual(["T1", "T2", "T3"])
    expect(range!.start.getDate()).toBe(31) // 2025-12-31
    expect(range!.days).toBe(12) // Dec 31 → Jan 10 inclusive + 1 padding day
  })

  it("computes offsets and inclusive durations, collapsing end-before-start", () => {
    const { bars } = buildBars(rows, "s", "e", "title", "p")
    expect(bars.map((b) => [b.offsetDays, b.durationDays])).toEqual([[1, 2], [5, 5], [10, 1]])
    expect(bars[2]!.title).toBe("T3")
  })

  it("clamps progress to 0–100 and nulls non-numbers", () => {
    const { bars } = buildBars(rows, "s", "e", "title", "p")
    expect(bars.map((b) => b.progress)).toEqual([100, 50, null])
    expect(buildBars(rows, "s", "e", "title").bars[0]!.progress).toBeNull()
  })
})

describe("buildTicks / shiftDates", () => {
  it("uses daily ticks for short ranges and coarser ones for long ranges", () => {
    expect(buildTicks({ start: new Date(2026, 0, 1), days: 10 })).toHaveLength(10)
    expect(buildTicks({ start: new Date(2026, 0, 1), days: 70 }).map((t) => t.offsetDays).slice(0, 3)).toEqual([0, 7, 14])
    expect(buildTicks({ start: new Date(2026, 0, 1), days: 365 })[1]!.offsetDays).toBe(30)
  })

  it("shifts both dates", () => {
    expect(shiftDates("2026-01-30", "2026-02-02", 3)).toEqual({ start: "2026-02-02", end: "2026-02-05" })
  })
})
