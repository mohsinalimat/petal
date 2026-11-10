# Frappe-compatible form runtime

Petal can run Frappe Desk's client code (ERPNext, HRMS and other apps' form scripts) unchanged, so Petal forms behave exactly like Desk: same validations, same calculations, same buttons. Apps opt in with the `frappe_compat` hook (see the custom app guide).

## How it works

```
GenericForm ──▶ useCompatForm ──▶ frappe-compat runtime (packages/core/src/lib/frappe-compat)
   ▲  renders snapshots            │  window.frappe, $, moment, locals, cur_frm, __, flt …
   └──── notifyForms() ◀───────────┤  frappe.model / meta / defaults   (model.ts)
                                   │  frappe.call / xcall / db         (request.ts → FrappeClient.rawCall → /api/v1/exec)
                                   │  frm, ScriptManager, grids        (form.ts)
                                   │  msgprint, Dialog, picker         (ui.ts → <CompatHost/>)
                                   └  boot (frappe.sessions.get), bundles via assets.json (index.ts)
```

- **Documents live in `locals`**, as in Desk. The runtime owns the open document; Petal re-renders from a snapshot after every change (batched to one render per tick).
- **One `Form` per doctype**, switched between documents, so each doctype's script is evaluated once per session, as in Desk.
- **Field properties** (`hidden`, `reqd`, `read_only`, `label`, `options`) come from Frappe's per-document docfield copies, which is where `set_df_property` and `toggle_*` write.
- **User edits** go through `frappe.model.set_value` with the field type, so Desk's change events fire. Free-text fields commit after a 400 ms pause (Desk fires on blur); links, selects, checks and dates commit immediately. Child-table edits are diffed into `items_add`, `before_items_remove`/`items_remove` and per-cell events.
- **Documents load with `frappe.desk.form.load.getdoc`**, so `__onload` and docinfo are present, and **save with `savedocs`**, including Desk's mandatory checks.
- Logic that must match the server (rounding, number formats, defaults, dates) is ported line by line from `frappe/public/js`.

## Beyond forms

The same runtime drives the rest of Desk's client API:

| Desk API | In Petal | Where |
|---|---|---|
| `frappe.Chart`, `frm.dashboard.render_graph`, `frappe.utils.make_chart` | the real **frappe-charts**; drawn once its element is on screen, with calls before that queued | `widgets.ts` |
| `frappe.DataTable` | the real **frappe-datatable**; tables built into dialogs or HTML fields before they're shown are re-measured when they appear | `widgets.ts` |
| `frappe.ui.Scanner` | Frappe's scanner over **html5-qrcode** (loaded on first scan) | `widgets.ts` |
| `frappe.ui.Tree` | Frappe's own `tree.js`, loaded from the bench | `index.ts` |
| `frappe.format`, `frappe.form.formatters` | Frappe's own `formatters.js`, loaded from the bench | `index.ts` |
| `frappe.listview_settings` | Petal's list page: `get_indicator` status pills, `add_fields`, `formatters`, default `filters`, and `onload`/`refresh` with a Desk-shaped `listview` (`page.add_action_item` / `add_menu_item` / `add_inner_button`, `get_checked_items`, `call_for_selected_items`, `filter_area`) | `list.ts`, `app/list/[doctype]/useCompatList.tsx` |
| `frappe.query_reports` | Petal's report page runs the real settings: filters are Desk controls (`default`, `get_query`, `on_change`, `depends_on`), `onload(report)`, `formatter`, and `frappe.query_report.get_filter_value` / `set_filter_value` / `refresh` | `report.ts`, `components/compat/CompatReport.tsx` |
| `frappe.pages[name]` (Desk pages) | `/page/<name>`: the page script draws into its wrapper as in Desk; `frappe.ui.make_app_page` returns a page whose title, indicator, buttons and menu Petal draws, and whose `add_field` uses Desk's controls. `set_route("<page>")` and `/app/<page>` links go there | `page.ts`, `app/page/[...route]` |
| `frappe.ui.form.Control*`, `make_control` | Desk's own controls (`controls.bundle.js`, ~1.6 MB) **loaded on demand**: for Desk pages, report filters, and form fields Petal has no input for (Dynamic Link, Geolocation, Signature, Barcode, Duration, Phone, JSON, Markdown/HTML Editor, Autocomplete, Table MultiSelect, Icon; add more with `frappe_compat.desk_controls`) | `desk-controls.ts`, `form.ts` (`mountDeskControl`) |

**Desk markup.** Petal's form uses Desk's class names and attributes (`.frappe-control[data-fieldname]`, `.form-section`, `.section-head`, `.form-column`, `.control-label`, `.control-input`), and `frm.wrapper`, `frm.fields_dict.x.wrapper` / `$wrapper` / `$input` and `grid.wrapper` point at the rendered elements. The first `refresh` runs after Petal has drawn the form, as in Desk (where the layout exists before refresh), so `document.querySelector('[data-fieldname=x] .section-head')` and `$(frm.wrapper).find(...)` in refresh handlers find the real fields.

**Desk fallback.** Screens whose scripts are too tied to Desk can open in Desk instead: `frappe_compat.desk = { doctypes: [...], pages: [...], embed?: true }` with `NEXT_PUBLIC_PETAL_DESK_URL` set to Desk's address. Petal shows an "Open in Desk" link, or embeds Desk when `embed` is on. Embedding needs the browser to be signed in to Desk too (same parent domain or SSO); the CSP allows framing only that origin.

**Load cost.** The runtime (jQuery, moment, the `frappe` namespace) loads only for apps with `frappe_compat` on, and only when a form, list, report or page needs it. Production build: `/form` 160 kB and `/list` 141 kB first load (they were 295 kB and 275 kB when the runtime was imported up front), `/report` 107 kB. Desk's controls bundle is fetched only when a screen uses a Desk control.

## Verification

`packages/core/src/lib/frappe-compat/erpnext-conformance.test.ts` (runs when a bench is next to the repo, or set `FRAPPE_BENCH`):

1. Loads the real `erpnext.bundle.js` and `hrms.bundle.js` with no errors.
2. Opens all 372 ERPNext/HRMS doctypes (new, and submitted for the 121 submittable ones) through setup → onload → refresh. Seven doctypes are allow-listed: four read server data the mock doesn't return, three drive Desk-only widgets (see below). Any other failure fails the test.
3. Runs a Sales Invoice through ERPNext's own controllers: item details, rate, amount, 18% tax, qty change, line discount and row removal, checking every total.

`GenericForm.compat.test.tsx` renders a new Sales Invoice and checks ERPNext's buttons ("Get Items From ▸ Sales Order / Delivery Note"), indicator and Save action in Petal's header.

Also against the bench's real files:

- `erpnext-list.test.ts`: `sales_invoice_list.js` indicators and add_fields, and its onload bulk actions ("Delivery Note", "Payment") calling ERPNext's bulk transaction method with the checked rows.
- `CompatReport.test.tsx`: the Stock Balance report's filters (Desk controls, defaults, MultiSelectList), onload button, run arguments and formatter.
- `app/page/[...route]/page.test.tsx`: the Sales Funnel Desk page (header fields, primary action, body).
- `GenericForm.desk-controls.test.tsx`: Desk's Duration and Dynamic Link controls inside Petal's form, with edits reaching the doctype's handlers.
- `GenericForm.desk-dom.test.tsx`: a refresh handler using HRMS's `document.querySelector('[data-fieldname=…]').querySelector(".section-head")` pattern, `$wrapper`, `$input` and `$(frm.wrapper).find(...)`.
- `widgets.test.ts`: charts (including `render_graph`), DataTable (also off-screen), Tree and number shortening.

## Not covered

- **Kanban and Gantt from Desk**: Petal has its own Kanban/Gantt views; Desk's `frappe.views.KanbanView` isn't run.
- **Script-heavy Desk pages built on Desk CSS** (e.g. Point of Sale) run, but look plain: Desk's stylesheet isn't loaded (it would restyle Petal), and Petal styles only the common Bootstrap classes, scoped under `.petal-desk`. Use the Desk fallback for those.
- **The Leaflet map** (Geolocation fields, the Location doctype) needs Frappe's Leaflet build, which isn't loaded; the field shows Desk's control without the map.
- **Apps overriding a control class** (e.g. ERPNext's telephony `ControlData`) apply only where Desk's controls are used; list the field type in `frappe_compat.desk_controls` to use Desk's control for it everywhere.
- **Report charts and tree reports** (`get_chart_data`, `tree: true`) show as a flat table, and `after_datatable_render` isn't called (Petal draws the table).
- **Per-row field overrides** in child tables (`grid_row.toggle_editable`) are stored but Petal's grid applies table-level overrides only.
- **Quick Entry** dialogs open the full form instead.
- **Form "Connections" dashboard** (linked documents) and Desk's email composer aren't rendered.
- Seven ERPNext/HRMS doctypes still fail the offline conformance test (four need server data the mock doesn't return; Location needs the map; Employee Checkin and Shift Assignment Tool expect a rendered Desk page, which the offline test doesn't have — Shift Assignment Tool's section-header lookup now works in a rendered form).
