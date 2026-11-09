/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * frappe.utils / frappe.datetime helpers that Desk's controls bundle and
 * page scripts call, copied from frappe/public/js/frappe/utils/*.js. Only
 * fills gaps; anything the runtime already defines is left alone.
 */
import { __, cstr, type Any } from "./env"

const g: Any = typeof window !== "undefined" ? window : globalThis

const VALIDATE: Record<string, RegExp> = {
  phone: /^([0-9 +_\-,.*#()]){1,20}$/,
  name: /^[\w][\w'-]*([ \w][\w'-]+)*$/,
  number: /^-?(?:\d+|\d{1,3}(?:,\d{3})+)?(?:\.\d+)?$/,
  digits: /^\d+$/,
  alphanum: /^\w+$/,
  email: /^(([^<>()[\]\\.,;:\s@"]+(\.[^<>()[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/,
  // eslint-disable-next-line no-useless-escape
  url: /^((([A-Za-z0-9.+-]+:(?:\/\/)?)(?:[-;:&=\+\,\w]@)?[A-Za-z0-9.-]+(:[0-9]+)?|(?:www.|[-;:&=\+\$,\w]+@)[A-Za-z0-9.-]+)((?:\/[\+~%\/.\w-_]*)?\??(?:[-\+=&;%@.\w_]*)#?(?:[\w]*))?)$/i,
  dateIso: /^(\d{4})\D?(0[1-9]|1[0-2])\D?([12]\d|0[1-9]|3[01])$/,
}

function csvToArray(strData: string, strDelimiter = ","): string[][] {
  const pattern = new RegExp(
    "(\\" + strDelimiter + "|\\r?\\n|\\r|^)" + '(?:"([^"]*(?:""[^"]*)*)"|' + '([^"\\' + strDelimiter + "\\r\\n]*))",
    "gi",
  )
  const data: string[][] = [[]]
  let m: RegExpExecArray | null
  while ((m = pattern.exec(strData))) {
    const delim = m[1]!
    if (delim.length && delim !== strDelimiter) data.push([])
    data[data.length - 1]!.push(m[2] ? m[2].replace(/""/g, '"') : (m[3] ?? ""))
    if (m.index === pattern.lastIndex) pattern.lastIndex++
  }
  return data
}

function secondsToDuration(seconds: number, opts?: Any) {
  const floor = seconds > 0 ? Math.floor : Math.ceil
  const d = {
    days: floor(seconds / 86400),
    hours: floor((seconds % 86400) / 3600),
    minutes: floor((seconds % 3600) / 60),
    seconds: floor(seconds % 60),
  }
  if (opts?.hide_days) { d.hours = floor(seconds / 3600); d.days = 0 }
  if (opts?.hide_seconds) { d.minutes += Math.round(d.seconds / 60); d.seconds = 0 }
  return d
}

export function installDeskUtils(frappe: Any) {
  const u = frappe.utils
  const fill = (obj: Any, defs: Record<string, Any>) => {
    for (const [k, v] of Object.entries(defs)) if (typeof obj[k] !== "function") obj[k] = v
  }

  fill(u, {
    validate_type(val: Any, type: string) {
      const re = VALIDATE[type]
      return re ? (val !== "" ? re.test(val) : false) : false
    },
    csv_to_array: csvToArray,
    deep_clone: (obj: Any) => (typeof structuredClone === "function" ? structuredClone(obj) : JSON.parse(JSON.stringify(obj))),
    duration_to_seconds(days = 0, hours = 0, minutes = 0, seconds = 0) {
      return (days || 0) * 86400 + (hours || 0) * 3600 + (minutes || 0) * 60 + (seconds || 0)
    },
    fetch_link_title(doctype: string, name: string) {
      if (!doctype || !name) return
      return frappe.xcall("frappe.desk.search.get_link_title", { doctype, docname: name }).then((title: string) => {
        u.add_link_title(doctype, name, title)
        return title
      })
    },
    flag: (code: string) => `<img src="https://flagcdn.com/${encodeURIComponent(code)}.svg" width="20" height="15">`,
    get_clipboard_data(e: Any) {
      const data = e.clipboardData || g.clipboardData || e.originalEvent?.clipboardData
      return data?.getData("Text") ?? ""
    },
    get_decoded_string(dataURI: string) {
      let decoded = atob(dataURI.split(",")[1] ?? "")
      try { decoded = decodeURIComponent(escape(decoded)) } catch { /* keep atob output */ }
      return decoded
    },
    get_duration_options: (df: Any) => ({ hide_days: df.hide_days, hide_seconds: df.hide_seconds }),
    seconds_to_duration: secondsToDuration,
    get_formatted_duration(value: number, opts: Any = null) {
      opts = opts ?? { hide_days: 0, hide_seconds: 0 }
      if (!value) return ""
      const d = secondsToDuration(value, opts)
      const parts: string[] = []
      if (d.days && opts.hide_days !== 1) parts.push(d.days + __("d", null, "Days (Field: Duration)"))
      if (d.hours) parts.push(d.hours + __("h", null, "Hours (Field: Duration)"))
      if (d.minutes) parts.push(d.minutes + __("m", null, "Minutes (Field: Duration)"))
      if (d.seconds && opts.hide_seconds !== 1) parts.push(d.seconds + __("s", null, "Seconds (Field: Duration)"))
      return parts.join(" ")
    },
    get_formatted_iban(value: string) {
      if (!value || ["BI", "SV", "EG", "LY"].some((c) => value.startsWith(c))) return value
      return value.replace(/ /g, "").replace(/(.{4})(?=.)/g, "$1 ")
    },
    is_json(str: string) { try { JSON.parse(str); return true } catch { return false } },
    is_rtl: (lang: string | null = null) => ["ar", "he", "fa", "ps"].includes(lang || frappe.boot?.lang),
    is_xs: () => (typeof window !== "undefined" ? window.innerWidth < 768 : false),
    only_allow_num_decimal(input: Any) {
      input.on("input", (e: Any) => {
        const self = g.$(e.target)
        self.val(String(self.val()).replace(/[^0-9.-]/g, ""))
      })
    },
    parse_json(str: string) { try { return JSON.parse(str) } catch { return str } },
    split_emails(txt: string) {
      if (!txt) return []
      return txt.split(/[,\n](?=(?:[^"]|"[^"]*")*$)/g).map((e) => e.trim()).filter(Boolean)
    },
    string_to_boolean(s: string) {
      switch (s.toLowerCase().trim()) {
        case "t": case "true": case "y": case "yes": case "1": return true
        case "f": case "false": case "n": case "no": case "0": return false
        default: return s
      }
    },
    replace_newlines: (t: string) => (t ? t.replace(/\n/g, "<br>") : ""),
  })

  fill(frappe.datetime, {
    moment_to_date_obj(m: Any) {
      const a = m.toArray()
      return new Date(a[0], a[1], a[2], a[3], a[4], a[5], a[6])
    },
  })

  // utils/common.js and datatype.js globals
  fill(g, {
    strip_html: (txt: Any) => cstr(txt).replace(/<[^>]*>/g, ""),
    validate_url: (txt: string) => u.validate_type(txt, "url"),
    validate_email: (txt: string) => u.validate_type(txt, "email"),
    validate_phone: (txt: string) => u.validate_type(txt, "phone"),
    validate_name: (txt: string) => u.validate_type(txt, "name"),
    replace_all: (s: string, t1: string, t2: string) => s.split(t1).join(t2),
  })
}
