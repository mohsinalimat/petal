import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { BulkEditDialog, bulkEditableFields } from "./bulk-edit-dialog"

const fields = [
  { fieldname: "status", fieldtype: "Select", label: "Status", options: "Open\nClosed" },
  { fieldname: "qty", fieldtype: "Int", label: "Qty" },
  { fieldname: "active", fieldtype: "Check", label: "Active" },
  { fieldname: "total", fieldtype: "Currency", label: "Total", read_only: 1 as const },
  { fieldname: "items", fieldtype: "Table", label: "Items" },
]

describe("bulkEditableFields", () => {
  it("drops read-only and non-scalar fields and sorts by label", () => {
    expect(bulkEditableFields(fields).map((f) => f.fieldname)).toEqual(["active", "qty", "status"])
  })
})

describe("BulkEditDialog", () => {
  it("renders nothing when closed", () => {
    const { container } = render(<BulkEditDialog open={false} count={2} fields={fields} onApply={vi.fn()} onClose={vi.fn()} />)
    expect(container.innerHTML).toBe("")
  })

  it("coerces numeric values and closes after applying", async () => {
    const onApply = vi.fn().mockResolvedValue(undefined)
    const onClose = vi.fn()
    render(<BulkEditDialog open count={3} fields={fields} onApply={onApply} onClose={onClose} />)
    expect(screen.getByText("Edit 3 records")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Field"), { target: { value: "qty" } })
    fireEvent.change(screen.getByLabelText("New value"), { target: { value: "7" } })
    fireEvent.click(screen.getByRole("button", { name: "Update" }))
    await waitFor(() => expect(onApply).toHaveBeenCalledWith("qty", 7))
    expect(onClose).toHaveBeenCalled()
  })

  it("sends 1/0 for Check fields", async () => {
    const onApply = vi.fn().mockResolvedValue(undefined)
    render(<BulkEditDialog open count={1} fields={fields} onApply={onApply} onClose={vi.fn()} />)
    // "active" is first alphabetically
    fireEvent.click(screen.getByLabelText("New value"))
    fireEvent.click(screen.getByRole("button", { name: "Update" }))
    await waitFor(() => expect(onApply).toHaveBeenCalledWith("active", 1))
  })

  it("shows the error and stays open when the update fails", async () => {
    const onClose = vi.fn()
    render(<BulkEditDialog open count={1} fields={fields} onApply={vi.fn().mockRejectedValue(new Error("Locked"))} onClose={onClose} />)
    fireEvent.click(screen.getByRole("button", { name: "Update" }))
    expect((await screen.findByRole("alert")).textContent).toBe("Locked")
    expect(onClose).not.toHaveBeenCalled()
  })
})
