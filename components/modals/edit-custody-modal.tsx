"use client"

import * as React from "react"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { editCustody } from "@/app/(app)/custodies/actions"
import { Upload, X, FileText, ImageIcon, Paperclip } from "lucide-react"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جاري الحفظ..." : "حفظ التغييرات"}
    </Button>
  )
}

function getTodayAndMin() {
  const today = new Date().toISOString().split("T")[0]
  const min = new Date()
  min.setDate(min.getDate() - 15)
  return { today, minDate: min.toISOString().split("T")[0] }
}

function isImagePath(path: string | null) {
  if (!path) return false
  return /\.(jpg|jpeg|png|gif|webp)$/i.test(path)
}

export function EditCustodyModal({
  custodies,
  eligibleEmployees,
  projects = [],
}: {
  custodies: any[]
  eligibleEmployees: { id: string; name: string; job_title: string | null }[]
  projects?: { id: string; name: string; is_company_branch: boolean }[]
}) {
  const [state, formAction] = useActionState(editCustody as any, { error: "", success: false })
  const formRef = React.useRef<HTMLFormElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const lastCustodyIdRef = React.useRef<string | null>(null)

  const [selectedCustody, setSelectedCustody] = React.useState<any>(null)
  const [newFile, setNewFile] = React.useState<File | null>(null)
  const [removeFile, setRemoveFile] = React.useState(false)
  const { today, minDate } = getTodayAndMin()

  // Sync selected custody from URL
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const custodyId = params.get("edit_custody")
    if (custodyId && custodyId !== lastCustodyIdRef.current) {
      lastCustodyIdRef.current = custodyId
      const found = custodies.find(c => c.id === custodyId)
      setSelectedCustody(found || null)
      setNewFile(null)
      setRemoveFile(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    } else if (!custodyId) {
      lastCustodyIdRef.current = null
    }
  })

  // Close on success
  React.useEffect(() => {
    if (state?.success) {
      const url = new URL(window.location.href)
      url.searchParams.delete("modal")
      url.searchParams.delete("edit_custody")
      window.history.pushState({}, "", url)
      formRef.current?.reset()
      setNewFile(null)
      setRemoveFile(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }, [state])

  const hasExistingFile = !!selectedCustody?.file_path && !removeFile
  const isNewFileImage = newFile && newFile.type.startsWith("image/")
  const isExistingImage = isImagePath(selectedCustody?.file_path)

  function clearNewFile() {
    setNewFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  return (
    <Modal name="edit-custody" title="تعديل عهدة" description="قم بتعديل تفاصيل العهدة.">
      <form action={formAction} ref={formRef} className="flex flex-col gap-4 mt-4">
        <input type="hidden" name="id" value={selectedCustody?.id || ""} />
        <input type="hidden" name="remove_file" value={removeFile ? "true" : "false"} />

        {/* Employee */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="ec-employee">الموظف</label>
          <select
            id="ec-employee"
            name="employee_id"
            required
            key={selectedCustody?.id + "-emp"}
            defaultValue={selectedCustody?.employee_id || ""}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">— اختر موظفاً —</option>
            {eligibleEmployees.map(e => (
              <option key={e.id} value={e.id}>
                {e.name}{e.job_title ? ` — ${e.job_title}` : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Project */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="ec-project">المشروع / الفرع</label>
          <select id="ec-project" name="project_id" required
            key={selectedCustody?.id + "-proj"}
            defaultValue={selectedCustody?.project_id || ""}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <option value="">— اختر المشروع أو الفرع —</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} {p.is_company_branch ? "(فرع رئيسي)" : ""}
              </option>
            ))}
          </select>
        </div>

        {/* Date */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="ec-date">التاريخ</label>
          <Input
            id="ec-date"
            name="date"
            type="date"
            key={selectedCustody?.id + "-date"}
            defaultValue={selectedCustody?.date || today}
            min={minDate}
            max={today}
          />
        </div>

        {/* Item */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="ec-item">البند</label>
          <Input
            id="ec-item"
            name="item"
            required
            key={selectedCustody?.id + "-item"}
            defaultValue={selectedCustody?.item || ""}
          />
        </div>

        {/* Amount */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="ec-amount">المبلغ (EGP)</label>
          <Input
            id="ec-amount"
            name="amount"
            type="number"
            step="0.01"
            inputMode="decimal"
            min="0.01"
            required
            key={selectedCustody?.id + "-amount"}
            defaultValue={selectedCustody?.amount ?? ""}
          />
        </div>

        {/* Notes */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="ec-notes">ملاحظات</label>
          <textarea
            id="ec-notes"
            name="notes"
            rows={2}
            key={selectedCustody?.id + "-notes"}
            defaultValue={selectedCustody?.notes || ""}
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
          />
        </div>

        {/* File — input always mounted, UI shown conditionally on top */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium">المستند / الصورة</label>

          {/* Always-mounted hidden file input — never unmount this */}
          <input
            ref={fileInputRef}
            type="file"
            name="file"
            className="sr-only"
            accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
            onChange={e => { setNewFile(e.target.files?.[0] || null); setRemoveFile(false) }}
          />

          {/* Existing file row */}
          {hasExistingFile && !newFile && (
            <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30">
              {isExistingImage
                ? <ImageIcon className="h-5 w-5 text-muted-foreground shrink-0" />
                : <FileText className="h-5 w-5 text-muted-foreground shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm truncate text-muted-foreground">ملف مرفق حالياً</p>
                <p className="text-xs text-muted-foreground">{selectedCustody?.file_path?.split("/").pop()}</p>
              </div>
              <button type="button" onClick={() => setRemoveFile(true)}
                className="text-muted-foreground hover:text-destructive transition-colors shrink-0">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* New file preview */}
          {newFile && (
            <div className="flex items-center gap-3 p-3 rounded-lg border border-primary/30 bg-primary/5">
              {isNewFileImage
                ? <ImageIcon className="h-5 w-5 text-primary shrink-0" />
                : <FileText className="h-5 w-5 text-primary shrink-0" />}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{newFile.name}</p>
                <p className="text-xs text-muted-foreground">{(newFile.size / 1024).toFixed(0)} KB — سيحل محل الملف القديم</p>
              </div>
              <button type="button" onClick={clearNewFile}
                className="text-muted-foreground hover:text-destructive transition-colors shrink-0">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Upload / replace trigger button */}
          {!newFile && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border hover:border-primary/50 transition-colors text-sm text-muted-foreground w-full"
            >
              {hasExistingFile ? <Paperclip className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
              {hasExistingFile ? "استبدال الملف الحالي" : "رفع ملف أو صورة"}
            </button>
          )}
        </div>

        {state?.error && (
          <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{state.error}</p>
        )}

        <div className="flex justify-end gap-2 mt-2">
          <SubmitButton />
        </div>
      </form>
    </Modal>
  )
}
