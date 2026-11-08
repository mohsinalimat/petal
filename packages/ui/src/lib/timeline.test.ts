import { describe, it, expect } from "vitest"
import { buildTimeline, htmlToText, parseVersion, relativeTime, textToCommentHtml } from "./timeline"

describe("htmlToText / textToCommentHtml", () => {
  it("strips tags, keeps line breaks and decodes entities", () => {
    expect(htmlToText("<p>Hi <b>there</b></p><p>a &amp; b &lt;3</p>")).toBe("Hi there\na & b <3")
    expect(htmlToText("x<br>y")).toBe("x\ny")
  })

  it("escapes HTML in user comments so they can't inject markup", () => {
    expect(textToCommentHtml("<script>x</script>\n\nok")).toBe("<p>&lt;script&gt;x&lt;/script&gt;</p><p><br></p><p>ok</p>")
  })

  it("round-trips plain text", () => {
    expect(htmlToText(textToCommentHtml("a < b & c\nnext"))).toBe("a < b & c\nnext")
  })
})

describe("parseVersion", () => {
  it("reads changed fields and row counts from JSON strings", () => {
    expect(parseVersion('{"changed":[["status","Open","Closed"],[1,2,3]],"added":[["items",{}]],"removed":[]}'))
      .toEqual({ changes: [{ fieldname: "status", from: "Open", to: "Closed" }], rowsAdded: 1, rowsRemoved: 0 })
  })

  it("accepts objects and tolerates bad JSON", () => {
    expect(parseVersion({ changed: [["a", 1, 2]] }).changes).toHaveLength(1)
    expect(parseVersion("{oops")).toEqual({ changes: [], rowsAdded: 0, rowsRemoved: 0 })
  })
})

describe("buildTimeline", () => {
  it("merges comments, versions, logs, emails and creation newest-first", () => {
    const items = buildTimeline(
      {
        comments: [
          { name: "C1", owner: "a@x.com", creation: "2026-11-02 10:00:00", content: "<p>Looks good</p>", comment_type: "Comment" },
          { name: "C2", owner: "a@x.com", creation: "2026-11-02 11:00:00", content: "liked", comment_type: "Like" },
        ],
        versions: [
          { name: "V1", owner: "b@x.com", creation: "2026-11-03 09:00:00", data: '{"changed":[["qty",1,2]]}' },
          { name: "V2", owner: "b@x.com", creation: "2026-11-03 09:30:00", data: '{"changed":[]}' },
        ],
        info_logs: [{ name: "L1", owner: "c@x.com", creation: "2026-11-04 08:00:00", content: "submitted this document" }],
        communications: [{ name: "M1", sender: "d@x.com", creation: "2026-11-01 12:00:00", subject: "Quote", content: "<p>Hi</p>" }],
      },
      { owner: "a@x.com", creation: "2026-11-01 09:00:00" },
    )
    expect(items.map((i) => `${i.kind}:${i.id}`)).toEqual([
      "activity:L1", "change:V1", "comment:C1", "email:M1", "created:__created__",
    ])
    expect(items[2]).toMatchObject({ text: "Looks good", user: "a@x.com" })
  })

  it("works with empty docinfo", () => {
    expect(buildTimeline({})).toEqual([])
  })
})

describe("relativeTime", () => {
  const now = new Date(2026, 10, 8, 12, 0, 0)
  const ago = (ms: number) => {
    const d = new Date(now.getTime() - ms)
    const p = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  }

  it.each([
    [10_000, "just now"],
    [5 * 60_000, "5 min ago"],
    [60 * 60_000, "1 hour ago"],
    [3 * 3_600_000, "3 hours ago"],
    [2 * 86_400_000, "2 days ago"],
  ])("%d ms → %s", (ms, label) => expect(relativeTime(ago(ms), now)).toBe(label))

  it("falls back to a date for old items and returns unparseable input unchanged", () => {
    expect(relativeTime(ago(90 * 86_400_000), now)).toMatch(/2026/)
    expect(relativeTime("not a date", now)).toBe("not a date")
  })
})
