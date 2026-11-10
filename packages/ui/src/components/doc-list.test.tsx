import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"

const download = vi.fn()
vi.mock("../lib/csv", async (orig) => ({ ...(await orig<typeof import("../lib/csv")>()), downloadText: (...a: unknown[]) => download(...a) }))

import { DocList, EXPORT_LIMIT } from "./doc-list"
import type { DocListMeta, DocListFetchParams } from "./doc-list"

const meta: DocListMeta = {
  name: "Task",
  fields: [
    { fieldname: "subject", fieldtype: "Data", label: "Subject", in_list_view: 1 },
    { fieldname: "status", fieldtype: "Select", label: "Status", options: "Open\nClosed", in_list_view: 1 },
  ],
}
const rows = [
  { name: "T-1", subject: "One", status: "Open", modified: "2026-11-01 10:00:00", docstatus: 0 },
  { name: "T-2", subject: "Two", status: "Closed", modified: "2026-11-01 11:00:00", docstatus: 0 },
]

function setup(extra: Partial<React.ComponentProps<typeof DocList>> = {}) {
  const onFetchData = vi.fn(async (_p: DocListFetchParams) => ({ rows, total: rows.length }))
  render(<DocList doctype="Task" meta={meta} onFetchData={onFetchData} onRowClick={vi.fn()} onNewClick={vi.fn()} {...extra} />)
  return { onFetchData }
}

const openMenu = () => fireEvent.click(screen.getByTitle("More actions"))

beforeEach(() => download.mockReset())

describe("DocList export / bulk actions", () => {
  it("exports every filtered row to CSV", async () => {
    const { onFetchData } = setup()
    await screen.findAllByText("One")
    openMenu()
    fireEvent.click(screen.getByText("Export to CSV"))
    await waitFor(() => expect(download).toHaveBeenCalled())
    const exportCall = onFetchData.mock.calls.at(-1)![0]
    expect(exportCall.limit).toBe(EXPORT_LIMIT)
    expect(exportCall.fields).toEqual(["name", "subject", "status"])
    const [filename, csv] = download.mock.calls[0] as [string, string]
    expect(filename).toMatch(/^Task-\d{4}-\d{2}-\d{2}\.csv$/)
    expect(csv.split("\r\n")[0]).toBe("ID,Subject,Status")
  })

  it("exports only selected rows", async () => {
    const { onFetchData } = setup()
    await screen.findAllByText("One")
    fireEvent.click(screen.getAllByRole("checkbox")[1]!) // first row (desktop table)
    openMenu()
    fireEvent.click(screen.getByText("Export selected"))
    await waitFor(() => expect(download).toHaveBeenCalled())
    expect(onFetchData.mock.calls.at(-1)![0].filters).toEqual([["Task", "name", "in", ["T-1"]]])
  })

  it("bulk-edits selected rows and refetches", async () => {
    const onBulkUpdate = vi.fn().mockResolvedValue(undefined)
    const { onFetchData } = setup({ onBulkUpdate })
    await screen.findAllByText("One")
    fireEvent.click(screen.getAllByRole("checkbox")[0]!) // select all
    openMenu()
    fireEvent.click(screen.getByText("Edit selected"))
    fireEvent.change(screen.getByLabelText("Field"), { target: { value: "status" } })
    fireEvent.change(screen.getByLabelText("New value"), { target: { value: "Closed" } })
    const before = onFetchData.mock.calls.length
    fireEvent.click(screen.getByRole("button", { name: "Update" }))
    await waitFor(() => expect(onBulkUpdate).toHaveBeenCalledWith(["T-1", "T-2"], "status", "Closed"))
    await waitFor(() => expect(onFetchData.mock.calls.length).toBeGreaterThan(before))
  })

  it("offers Import when a handler is given", async () => {
    const onImportClick = vi.fn()
    setup({ onImportClick })
    await screen.findAllByText("One")
    openMenu()
    fireEvent.click(screen.getByText("Import from CSV"))
    expect(onImportClick).toHaveBeenCalled()
  })

  it("refetches when refreshSignal changes", async () => {
    const onFetchData = vi.fn(async () => ({ rows, total: 2 }))
    const props = { doctype: "Task", meta, onFetchData, onRowClick: vi.fn(), onNewClick: vi.fn() }
    const { rerender } = render(<DocList {...props} refreshSignal={0} />)
    await waitFor(() => expect(onFetchData).toHaveBeenCalledTimes(1))
    rerender(<DocList {...props} refreshSignal={1} />)
    await waitFor(() => expect(onFetchData).toHaveBeenCalledTimes(2))
  })
})

describe("DocList extension points (Frappe list view settings)", () => {
  it("fetches extra fields, applies default filters and shows the app's status indicator", async () => {
    const { onFetchData } = setup({
      extraFields: ["priority"],
      initialFilters: [["status", "=", "Open"]],
      rowIndicator: (r) => ({ label: r.status === "Open" ? "Needs Work" : "Done", color: r.status === "Open" ? "orange" : "green" }),
    })
    await screen.findAllByText("Needs Work")
    expect(screen.getAllByText("Done").length).toBeGreaterThan(0)
    const p = onFetchData.mock.calls[0]![0]
    expect(p.fields).toContain("priority")
    expect(p.filters).toContainEqual(["Task", "status", "=", "Open"])
  })

  it("custom cells, selection actions, menu actions and toolbar content", async () => {
    const onAction = vi.fn()
    const onMenu = vi.fn()
    const onSelection = vi.fn()
    setup({
      renderCell: (f, v) => (f === "status" ? <b>{`[${String(v)}]`}</b> : undefined),
      selectionActions: [{ label: "Make Payment", onClick: onAction }],
      menuActions: [{ label: "Recalculate", onClick: onMenu }],
      toolbarEnd: <button type="button">Script Button</button>,
      onSelectionChange: onSelection,
    })
    await screen.findAllByText("[Open]")
    expect(screen.getByRole("button", { name: "Script Button" })).toBeTruthy()

    openMenu()
    fireEvent.click(screen.getByText("Recalculate"))
    expect(onMenu).toHaveBeenCalled()

    // Select the first row, then run the script's action on it.
    const firstRowBox = screen.getAllByRole("checkbox")[1]!
    fireEvent.click(firstRowBox.closest("td") ?? firstRowBox)
    await waitFor(() => expect(onSelection).toHaveBeenLastCalledWith(["T-1"]))
    openMenu()
    fireEvent.click(screen.getByText("Make Payment"))
    expect(onAction).toHaveBeenCalledWith(["T-1"])
  })
})
