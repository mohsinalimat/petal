import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react"
import { KanbanBoard } from "./kanban-board"

const groupField = { fieldname: "status", fieldtype: "Select", label: "Status", options: "Open\nClosed" }
const rows = [
  { name: "T-1", subject: "First", status: "Open", priority: "High" },
  { name: "T-2", subject: "Second", status: "Closed" },
]

function setup(onMove = vi.fn().mockResolvedValue(undefined)) {
  const onCardClick = vi.fn()
  render(
    <KanbanBoard
      rows={rows}
      groupField={groupField}
      titleField="subject"
      cardFields={[{ fieldname: "priority", label: "Priority" }]}
      onCardClick={onCardClick}
      onMove={onMove}
    />,
  )
  return { onMove, onCardClick }
}

const column = (label: string) => screen.getByRole("region", { name: label })

describe("KanbanBoard", () => {
  it("renders a column per option with counts and card fields", () => {
    setup()
    expect(within(column("Open")).getByText("First")).toBeTruthy()
    expect(within(column("Open")).getByText("High")).toBeTruthy()
    expect(within(column("Closed")).getByText("Second")).toBeTruthy()
  })

  it("opens a card on click", () => {
    const { onCardClick } = setup()
    fireEvent.click(screen.getByText("First"))
    expect(onCardClick).toHaveBeenCalledWith("T-1")
  })

  it("moves a card via the Move to select and persists it", async () => {
    const { onMove } = setup()
    fireEvent.change(screen.getByLabelText("Move T-1 to"), { target: { value: "Closed" } })
    expect(within(column("Closed")).getByText("First")).toBeTruthy()
    await waitFor(() => expect(onMove).toHaveBeenCalledWith("T-1", "Closed"))
  })

  it("moves a card by drag and drop", async () => {
    const { onMove } = setup()
    const data = new Map<string, string>()
    const dataTransfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? "" }
    fireEvent.dragStart(screen.getByText("Second").closest("li")!, { dataTransfer })
    fireEvent.dragOver(column("Open"), { dataTransfer })
    fireEvent.drop(column("Open"), { dataTransfer })
    await waitFor(() => expect(onMove).toHaveBeenCalledWith("T-2", "Open"))
  })

  it("rolls the card back and shows the error when saving fails", async () => {
    setup(vi.fn().mockRejectedValue(new Error("Not permitted")))
    fireEvent.change(screen.getByLabelText("Move T-1 to"), { target: { value: "Closed" } })
    expect((await screen.findByRole("alert")).textContent).toBe("Not permitted")
    expect(within(column("Open")).getByText("First")).toBeTruthy()
  })
})
