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

## Verification

`packages/core/src/lib/frappe-compat/erpnext-conformance.test.ts` (runs when a bench is next to the repo, or set `FRAPPE_BENCH`):

1. Loads the real `erpnext.bundle.js` and `hrms.bundle.js` with no errors.
2. Opens all 372 ERPNext/HRMS doctypes (new, and submitted for the 121 submittable ones) through setup → onload → refresh. Seven doctypes are allow-listed: four read server data the mock doesn't return, three drive Desk-only widgets (see below). Any other failure fails the test.
3. Runs a Sales Invoice through ERPNext's own controllers: item details, rate, amount, 18% tax, qty change, line discount and row removal, checking every total.

`GenericForm.compat.test.tsx` renders a new Sales Invoice and checks ERPNext's buttons ("Get Items From ▸ Sales Order / Delivery Note"), indicator and Save action in Petal's header.

## Not covered

- **Desk-only widgets** render nothing: `frappe.Chart`, DataTable, `frappe.ui.Tree`, the Leaflet map (Location), barcode camera, and scripts that query Desk's page markup (e.g. Shift Assignment Tool's section header). They are inert stand-ins so the rest of the script still runs.
- **Per-row field overrides** in child tables (`grid_row.toggle_editable`) are stored but Petal's grid applies table-level overrides only.
- **Quick Entry** dialogs open the full form instead.
- **List view settings** (`__list_js`) are evaluated, and used for the form's status indicator, but Petal's list page doesn't use their indicators, filters or buttons yet.
- **Form "Connections" dashboard** (linked documents) and Desk's email composer aren't rendered.
- Desk CSS isn't loaded (it would restyle Petal), so script-built HTML gets Petal's light styling for common Frappe classes.
