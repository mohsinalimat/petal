export type MetaField = {
  fieldname: string
  fieldtype: string
  label: string
  options?: string
  reqd?: 0 | 1
  read_only?: 0 | 1
  hidden?: 0 | 1
  in_list_view?: 0 | 1
  collapsible?: 0 | 1
  description?: string
  default?: string | number
  bold?: 0 | 1
  precision?: string
  depends_on?: string
  mandatory_depends_on?: string
  read_only_depends_on?: string
  hidden_depends_on?: string
  fetch_from?: string
  fetch_if_empty?: 0 | 1
  allow_in_quick_entry?: 0 | 1
  print_hide?: 0 | 1
  print_hide_if_no_value?: 0 | 1
  no_copy?: 0 | 1
  allow_on_submit?: 0 | 1
  translatable?: 0 | 1
  in_global_search?: 0 | 1
  search_index?: 0 | 1
  report_hide?: 0 | 1
  permlevel?: number
  columns?: number
  link_filters?: string
  idx?: number
  width?: string
  print_width?: string
  ignore_user_permissions?: 0 | 1
  in_filter?: 0 | 1
  in_preview?: 0 | 1
  in_standard_filter?: 0 | 1
  non_negative?: 0 | 1
  remember_last_selected_value?: 0 | 1
  unique?: 0 | 1
}

export type DocTypeMeta = {
  name: string
  doctype?: string
  module?: string
  title_field?: string
  image_field?: string
  sort_field?: string
  sort_order?: string
  is_submittable?: 0 | 1
  issingle?: 0 | 1
  is_tree?: 0 | 1
  is_virtual?: 0 | 1
  quick_entry?: 0 | 1
  autoname?: string
  description?: string
  icon?: string
  document_type?: string
  search_fields?: string
  track_changes?: 0 | 1
  track_views?: 0 | 1
  allow_import?: 0 | 1
  allow_rename?: 0 | 1
  max_attachments?: number
  fields: MetaField[]
  permissions?: unknown[]
  actions?: unknown[]
  links?: unknown[]
  /** Active workflow for this doctype, attached by frappe.desk.form.meta. */
  __workflow_docs?: Array<{
    name: string
    workflow_state_field?: string
    is_active?: 0 | 1
    override_status?: 0 | 1
  }>
}

export type LayoutColumn = { label: string; fields: MetaField[] }

export type LayoutSection = {
  label: string
  collapsible: boolean
  columns: LayoutColumn[]
}

export type LayoutTab = {
  label: string
  fieldname: string
  sections: LayoutSection[]
}
