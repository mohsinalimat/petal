import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { ImportWizard } from "./import-wizard"

const fields = [
  { fieldname: "customer_name", fieldtype: "Data", label: "Customer Name", reqd: 1 as const },
  { fieldname: "qty", fieldtype: "Int", label: "Qty" },
]

function upload(csv: string, name = "data.csv") {
  const file = new File([csv], name, { type: "text/csv" })
  fireEvent.change(screen.getByLabelText("CSV file"), { target: { files: [file] } })
}

describe("ImportWizard", () => {
  it("auto-maps columns, previews and imports valid rows", async () => {
    const onImport = vi.fn().mockResolvedValue({ succeeded: 2, failed: [] })
    render(<ImportWizard doctype="Order" fields={fields} onImport={onImport} />)
    upload("Customer Name,Qty\nAcme,2\nBeta,5\n")

    expect(await screen.findByText(/2 rows, 2 columns/)).toBeTruthy()
    expect((screen.getByLabelText("Field for column Qty") as HTMLSelectElement).value).toBe("qty")

    fireEvent.click(screen.getByRole("button", { name: "Import 2 rows" }))
    await waitFor(() => expect(onImport).toHaveBeenCalled())
    expect(onImport.mock.calls[0]![0]).toEqual([
      { doctype: "Order", customer_name: "Acme", qty: 2 },
      { doctype: "Order", customer_name: "Beta", qty: 5 },
    ])
    expect(onImport.mock.calls[0]![1]).toBe("insert")
    expect(await screen.findByText("2 imported")).toBeTruthy()
  })

  it("blocks import while rows have problems", async () => {
    render(<ImportWizard doctype="Order" fields={fields} onImport={vi.fn()} />)
    upload("Customer Name,Qty\n,abc\n")
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("Row 1: \"abc\" is not a whole number")
    expect(alert.textContent).toContain("Customer Name is required")
    expect((screen.getByRole("button", { name: "Import 1 row" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("only allows update mode once an ID column is mapped", async () => {
    render(<ImportWizard doctype="Order" fields={fields} onImport={vi.fn()} />)
    upload("Customer Name\nAcme\n")
    const update = (await screen.findByText(/Update existing records/)).querySelector("input")!
    expect(update.disabled).toBe(true)
  })

  it("reports an empty file", async () => {
    render(<ImportWizard doctype="Order" fields={fields} onImport={vi.fn()} />)
    upload("Customer Name\n")
    expect((await screen.findByRole("alert")).textContent).toMatch(/no data/)
  })

  it("lists failed rows from the result", async () => {
    const onImport = vi.fn().mockResolvedValue({ succeeded: 1, failed: [{ row: 2, message: "Duplicate entry" }] })
    render(<ImportWizard doctype="Order" fields={fields} onImport={onImport} />)
    upload("Customer Name\nA\nB\n")
    fireEvent.click(await screen.findByRole("button", { name: "Import 2 rows" }))
    expect(await screen.findByText("Row 2: Duplicate entry")).toBeTruthy()
  })
})
