import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent } from "@testing-library/react"
import { DatePicker } from "./date-picker"
import { DateTimePicker } from "./datetime-picker"

describe("date pickers inside a clipping container (child table)", () => {
  it("DatePicker renders its calendar outside the overflow-hidden parent and still selects", () => {
    const onChange = vi.fn()
    const { container } = render(
      <div style={{ overflow: "hidden" }} data-testid="clip">
        <DatePicker value="2026-11-10" onChange={onChange} />
      </div>,
    )
    fireEvent.click(screen.getByRole("button", { expanded: false }))
    const panel = screen.getByRole("dialog", { name: "Date picker" })
    expect(container.contains(panel)).toBe(false)
    expect(panel.style.position).toBe("fixed")

    // mousedown inside the portalled panel must not count as an outside click
    const day = screen.getByRole("button", { name: "15 November 2026" })
    fireEvent.mouseDown(day)
    fireEvent.click(day)
    expect(onChange).toHaveBeenCalledWith("2026-11-15")
  })

  it("DateTimePicker closes on a real outside click", () => {
    render(<DateTimePicker value="2026-11-10 09:30:00" onChange={() => {}} />)
    fireEvent.click(screen.getByRole("button", { expanded: false }))
    expect(screen.getByRole("dialog", { name: "Date and time picker" })).toBeTruthy()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole("dialog", { name: "Date and time picker" })).toBeNull()
  })
})
