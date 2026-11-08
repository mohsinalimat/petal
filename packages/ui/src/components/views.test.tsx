import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { CalendarView } from "./calendar-view"
import { GanttView } from "./gantt-view"
import { ViewSwitcher } from "./view-switcher"

describe("ViewSwitcher", () => {
  it("hides itself when only one view is available", () => {
    const { container } = render(<ViewSwitcher active="list" views={["list"]} onChange={vi.fn()} />)
    expect(container.innerHTML).toBe("")
  })

  it("marks the active view and reports changes", () => {
    const onChange = vi.fn()
    render(<ViewSwitcher active="list" views={["list", "kanban", "calendar"]} onChange={onChange} />)
    expect(screen.getByRole("tab", { name: "List" }).getAttribute("aria-selected")).toBe("true")
    fireEvent.click(screen.getByRole("tab", { name: "Kanban" }))
    fireEvent.click(screen.getByRole("tab", { name: "List" }))
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith("kanban")
  })
})

describe("CalendarView", () => {
  const events = [{ name: "EV-1", title: "Board meeting", start: "2026-11-10", end: "2026-11-11", row: {} }]

  it("shows the month, places events and opens them", () => {
    const onEventClick = vi.fn()
    const { container } = render(
      <CalendarView year={2026} month={10} events={events} onNavigate={vi.fn()} onEventClick={onEventClick} />,
    )
    expect(screen.getByRole("heading").textContent).toMatch(/2026/)
    const day10 = container.querySelector('[data-day="2026-11-10"]')!
    const day11 = container.querySelector('[data-day="2026-11-11"]')!
    expect(day10.textContent).toContain("Board meeting")
    expect(day11.textContent).toContain("Board meeting")
    fireEvent.click(day10.querySelector("button")!)
    expect(onEventClick).toHaveBeenCalledWith("EV-1")
  })

  it("navigates between months across year boundaries", () => {
    const onNavigate = vi.fn()
    render(<CalendarView year={2026} month={11} events={[]} onNavigate={onNavigate} onEventClick={vi.fn()} />)
    fireEvent.click(screen.getByLabelText("Next month"))
    expect(onNavigate).toHaveBeenCalledWith(2027, 0)
    fireEvent.click(screen.getByLabelText("Previous month"))
    expect(onNavigate).toHaveBeenLastCalledWith(2026, 10)
  })

  it("reports clicks on empty day space", () => {
    const onDayClick = vi.fn()
    const { container } = render(
      <CalendarView year={2026} month={10} events={[]} onNavigate={vi.fn()} onEventClick={vi.fn()} onDayClick={onDayClick} />,
    )
    fireEvent.click(container.querySelector('[data-day="2026-11-20"]')!)
    expect(onDayClick).toHaveBeenCalledWith("2026-11-20")
  })
})

describe("GanttView", () => {
  it("shows an empty state when nothing is plottable", () => {
    render(<GanttView rows={[{ name: "x" }]} startField="s" endField="e" titleField="name" onBarClick={vi.fn()} />)
    expect(screen.getByText(/No records have a start date/)).toBeTruthy()
  })

  it("positions bars by day width and opens them", () => {
    const onBarClick = vi.fn()
    render(
      <GanttView
        rows={[{ name: "T1", s: "2026-01-01", e: "2026-01-03" }, { name: "T2", s: "2026-01-05", e: "2026-01-05" }]}
        startField="s" endField="e" titleField="name" dayWidth={10} onBarClick={onBarClick}
      />,
    )
    const bar = screen.getByTestId("bar-T2")
    expect(bar.style.left).toBe("50px") // 5 days after the padded start (Dec 31)
    expect(bar.style.width).toBe("8px") // 1 day − 2px gap
    fireEvent.click(bar)
    expect(onBarClick).toHaveBeenCalledWith("T2")
  })
})
