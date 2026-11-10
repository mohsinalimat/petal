import { describe, expect, it, vi } from "vitest"
import {
  CHART_SOURCE_CONFIG_METHOD, evalChartSource, loadChartSource, parseCustomChartFilters, resolveSourceFilters,
} from "./chart-source"

// Verbatim shape of erpnext/accounts/dashboard_chart_source/account_balance_timeline.js
const ACCOUNT_BALANCE_TIMELINE = `
frappe.provide("frappe.dashboards.chart_sources");

frappe.dashboards.chart_sources["Account Balance Timeline"] = {
	method: "erpnext.accounts.dashboard_chart_source.account_balance_timeline.account_balance_timeline.get",
	filters: [
		{ fieldname: "company", label: __("Company"), fieldtype: "Link", options: "Company",
		  default: frappe.defaults.get_user_default("Company"), reqd: 1 },
		{ fieldname: "account", label: __("Account"), fieldtype: "Link", options: "Account", reqd: 1 },
	],
};`

describe("evalChartSource", () => {
  it("captures method and filters registered by a Desk source file", () => {
    const s = evalChartSource(ACCOUNT_BALANCE_TIMELINE, "Account Balance Timeline", { company: "Acme" })
    expect(s?.method).toBe(
      "erpnext.accounts.dashboard_chart_source.account_balance_timeline.account_balance_timeline.get",
    )
    expect(s?.filters?.map((f) => f.fieldname)).toEqual(["company", "account"])
    expect(s?.filters?.[0]?.default).toBe("Acme")
  })

  it("returns null when the file registers a different source", () => {
    expect(evalChartSource(ACCOUNT_BALANCE_TIMELINE, "Nope")).toBeNull()
  })
})

describe("filters", () => {
  it("chart filters_json override source defaults; blanks are ignored", () => {
    const s = evalChartSource(ACCOUNT_BALANCE_TIMELINE, "Account Balance Timeline", { Company: "Acme" })!
    expect(resolveSourceFilters(s, { account: "Cash - A", company: "" })).toEqual({ company: "Acme", account: "Cash - A" })
  })

  it("parses object and list forms of filters_json", () => {
    expect(parseCustomChartFilters('{"company":"X"}')).toEqual({ company: "X" })
    expect(parseCustomChartFilters('[["GL Entry","company","=","X",false]]')).toEqual({ company: "X" })
    expect(parseCustomChartFilters("not json")).toEqual({})
  })
})

describe("loadChartSource", () => {
  it("fetches the config once per source", async () => {
    const callMethod = vi.fn().mockResolvedValue(ACCOUNT_BALANCE_TIMELINE)
    const api = { callMethod } as unknown as Parameters<typeof loadChartSource>[0]
    await loadChartSource(api, "Account Balance Timeline")
    await loadChartSource(api, "Account Balance Timeline")
    expect(callMethod).toHaveBeenCalledTimes(1)
    expect(callMethod.mock.calls[0]?.[0]).toBe(CHART_SOURCE_CONFIG_METHOD)
  })
})
