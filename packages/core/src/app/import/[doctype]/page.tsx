"use client"
import { useParams, useRouter } from "next/navigation"
import { ImportWizard } from "@petal/ui"
import type { ImportMode } from "@petal/ui"
import type { FrappeDocument } from "@petal/sdk"
import { useFrappe } from "@/hooks/useFrappe"
import { useDocMeta } from "@/hooks/useDocMeta"
import { runImport } from "@/lib/import/run-import"
import { DoctypeViewHeader } from "@/components/views/DoctypeViewHeader"

export default function ImportPage() {
  const params = useParams()
  const doctype = decodeURIComponent(params.doctype as string)
  const router = useRouter()
  const frappe = useFrappe()
  const { meta, error } = useDocMeta(doctype)

  async function handleImport(docs: Record<string, unknown>[], mode: ImportMode, onProgress: (n: number) => void) {
    return runImport(docs, mode, {
      insertMany: (batch) => frappe.insertMany(batch),
      insertOne: (doc) => frappe.saveDoc(doc as Partial<FrappeDocument> & { doctype: string }),
      update: (dt, name, values) => frappe.setValue(dt, name, values),
    }, onProgress)
  }

  return (
    <div className="space-y-5 max-w-4xl">
      <DoctypeViewHeader doctype={doctype} meta={meta} active="list" crumb="Import" />
      {error && <p className="text-sm text-muted-foreground">{error}</p>}
      {meta?.issingle === 1 && <p className="text-sm text-muted-foreground">{doctype} is a single DocType and can&apos;t be imported.</p>}
      {meta && meta.issingle !== 1 && (
        <>
          <p className="text-sm text-muted-foreground">
            Upload a CSV with one {doctype} per row. Child tables aren&apos;t supported here yet — use Frappe&apos;s Data Import for those.
          </p>
          <ImportWizard
            doctype={doctype}
            fields={meta.fields}
            onImport={handleImport}
            onDone={() => router.push(`/list/${encodeURIComponent(doctype)}`)}
          />
        </>
      )}
    </div>
  )
}
