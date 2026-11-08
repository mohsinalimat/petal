import { describe, it, expect } from "vitest"
import { buildMonthGrid, dateFields, dateKey, eventsByDay, gridRange, parseDateKey, shiftMonth, toEvents } from "./calendar"

describe("dateKey / parseDateKey", () => {
  it("formats local dates without timezone shifts", () => {
    expect(dateKey(new Date(2026, 0, 5))).toBe("2026-01-05")
  })

  it("parses dates and datetimes, rejecting other values", () => {
    expect(dateKey(parseDateKey("2026-11-08 23:59:00")!)).toBe("2026-11-08")
    expect(parseDateKey("")).toBeNull()
    expect(parseDateKey(null)).toBeNull()
    expect(parseDateKey("08/11/2026")).toBeNull()
  })
})

describe("buildMonthGrid", () => {
  // November 2026 starts on a Sunday
  it("returns 42 days starting on the configured weekday", () => {
    const sun = buildMonthGrid(2026, 10, 0)
    expect(sun).toHaveLength(42)
    expect(sun[0]!.key).toBe("2026-11-01")
    const mon = buildMonthGrid(2026, 10, 1)
    expect(mon[0]!.key).toBe("2026-10-26")
    expect(mon[0]!.date.getDay()).toBe(1)
  })

  it("flags in-month days and today", () => {
    const grid = buildMonthGrid(2026, 10, 1, new Date(2026, 10, 8))
    expect(grid.filter((d) => d.inMonth)).toHaveLength(30)
    expect(grid.find((d) => d.isToday)!.key).toBe("2026-11-08")
  })

  it("gives the visible range", () => {
    expect(gridRange(buildMonthGrid(2026, 10, 0))).toEqual({ from: "2026-11-01", to: "2026-12-12" })
  })
})

describe("toEvents / eventsByDay", () => {
  const rows = [
    { name: "E1", subject: "Kickoff", starts: "2026-11-02", ends: "2026-11-04" },
    { name: "E2", subject: "", starts: "2026-11-03 10:00:00", ends: null },
    { name: "E3", subject: "Backwards", starts: "2026-11-10", ends: "2026-11-09" },
    { name: "E4", subject: "No date", starts: null },
  ]

  it("skips rows without a start, falls back to name for title, and orders reversed ranges", () => {
    const evs = toEvents(rows, "starts", "ends", "subject")
    expect(evs.map((e) => [e.name, e.title, e.start, e.end])).toEqual([
      ["E1", "Kickoff", "2026-11-02", "2026-11-04"],
      ["E2", "E2", "2026-11-03", "2026-11-03"],
      ["E3", "Backwards", "2026-11-09", "2026-11-10"],
    ])
  })

  it("places multi-day events on every day they span", () => {
    const grid = buildMonthGrid(2026, 10, 0)
    const map = eventsByDay(toEvents(rows, "starts", "ends", "subject"), grid)
    expect(map.get("2026-11-02")!.map((e) => e.name)).toEqual(["E1"])
    expect(map.get("2026-11-03")!.map((e) => e.name)).toEqual(["E1", "E2"])
    expect(map.get("2026-11-05")).toEqual([])
  })

  it("treats a null end field as single-day", () => {
    expect(toEvents(rows.slice(0, 1), "starts", null, "subject")[0]!.end).toBe("2026-11-02")
  })
})

describe("shiftMonth / dateFields", () => {
  it("wraps across years", () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 })
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 })
  })

  it("keeps only Date and Datetime fields", () => {
    expect(dateFields([{ fieldtype: "Date" }, { fieldtype: "Data" }, { fieldtype: "Datetime" }, { fieldtype: "Time" }])).toHaveLength(2)
  })
})
