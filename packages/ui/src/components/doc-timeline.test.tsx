import { describe, it, expect, vi } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { DocTimeline } from "./doc-timeline"
import type { TimelineItem } from "../lib/timeline"

const items: TimelineItem[] = [
  { kind: "comment", id: "C1", user: "me@x.com", at: "2026-11-01 10:00:00", text: "Mine" },
  { kind: "comment", id: "C2", user: "other@x.com", at: "2026-11-01 09:00:00", text: "Theirs" },
  { kind: "change", id: "V1", user: "other@x.com", at: "2026-11-01 08:00:00", changes: [{ fieldname: "qty", from: 1, to: 2 }], rowsAdded: 1, rowsRemoved: 0 },
]

describe("DocTimeline", () => {
  it("renders comments, field changes with labels, and row counts", () => {
    render(<DocTimeline items={items} fieldLabel={(f) => (f === "qty" ? "Quantity" : f)} onAddComment={vi.fn()} />)
    expect(screen.getByText("Mine")).toBeTruthy()
    expect(screen.getByText("Quantity")).toBeTruthy()
    expect(screen.getByText("Added 1 row")).toBeTruthy()
  })

  it("posts a trimmed comment and clears the box", async () => {
    const onAddComment = vi.fn().mockResolvedValue(undefined)
    render(<DocTimeline items={[]} onAddComment={onAddComment} />)
    const box = screen.getByLabelText("Add a comment") as HTMLTextAreaElement
    fireEvent.change(box, { target: { value: "  hello  " } })
    fireEvent.click(screen.getByRole("button", { name: "Comment" }))
    await waitFor(() => expect(onAddComment).toHaveBeenCalledWith("hello"))
    await waitFor(() => expect(box.value).toBe(""))
  })

  it("only offers delete on the current user's comments", () => {
    render(<DocTimeline items={items} currentUser="me@x.com" onAddComment={vi.fn()} onDeleteComment={vi.fn()} />)
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(1)
  })

  it("lists attachments and assignments and supports assigning", async () => {
    const onAssign = vi.fn().mockResolvedValue(undefined)
    render(
      <DocTimeline
        items={[]}
        attachments={[{ name: "F1", file_name: "quote.pdf", file_url: "/files/quote.pdf", is_private: 1 }]}
        assignments={[{ name: "TD1", owner: "sam@x.com" }]}
        onAddComment={vi.fn()}
        onAssign={onAssign}
        onUnassign={vi.fn()}
      />,
    )
    expect(screen.getByText("quote.pdf").getAttribute("href")).toBe("/files/quote.pdf")
    expect(screen.getByText("sam@x.com")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Assign to user"), { target: { value: "kim@x.com" } })
    fireEvent.click(screen.getByRole("button", { name: "Add" }))
    await waitFor(() => expect(onAssign).toHaveBeenCalledWith("kim@x.com"))
  })

  it("surfaces comment errors", async () => {
    render(<DocTimeline items={[]} onAddComment={vi.fn().mockRejectedValue(new Error("No permission"))} />)
    fireEvent.change(screen.getByLabelText("Add a comment"), { target: { value: "x" } })
    fireEvent.click(screen.getByRole("button", { name: "Comment" }))
    expect((await screen.findByRole("alert")).textContent).toBe("No permission")
  })
})
