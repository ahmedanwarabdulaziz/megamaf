"use client"

import * as React from "react"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { addCustody } from "@/app/(app)/custodies/actions"
import { Upload, X, FileText, ImageIcon, Loader2 } from "lucide-react"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جاري الحفظ..." : "إضافة العهدة"}
    </Button>
  )
}

function FileDropzone({ selectedFile, setSelectedFile, fileInputRef, clearFile }: any) {
  const { pending } = useFormStatus()
  const isImage = selectedFile && selectedFile.type.startsWith("image/")

  return (
    <div className="flex flex-col gap-2 relative mt-2">
      <label className="text-sm font-medium">المستند / الصورة</label>

      {/* Hidden file input — always mounted */}
      <input
        ref={fileInputRef}
        type="file"
        name="file"
        className="sr-only"
        accept="image/jpeg,image/png,image/gif,image/webp,application/pdf"
        onChange={e => setSelectedFile(e.target.files?.[0] || null)}
        disabled={pending}
      />

      <div className="relative">
        {selectedFile ? (
          /* Preview */
          <div className={`flex items-center gap-3 p-3 rounded-lg border border-primary/30 bg-primary/5 transition-opacity ${pending ? "opacity-40" : ""}`}>
            {isImage ? <ImageIcon className="h-5 w-5 text-primary shrink-0" /> : <FileText className="h-5 w-5 text-primary shrink-0" />}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{selectedFile.name}</p>
              <p className="text-xs text-muted-foreground">{(selectedFile.size / 1024).toFixed(0)} KB</p>
            </div>
            {!pending && (
              <button type="button" onClick={clearFile} className="text-muted-foreground hover:text-destructive transition-colors shrink-0">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ) : (
          /* Drop zone */
          <button
            type="button"
            disabled={pending}
            onClick={() => fileInputRef.current?.click()}
            className={`flex flex-col items-center gap-2 p-4 rounded-lg border-2 border-dashed border-border w-full transition-colors ${pending ? "opacity-50 cursor-not-allowed" : "hover:border-primary/50 cursor-pointer"}`}
          >
            <Upload className="h-6 w-6 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">اضغط لرفع ملف أو صورة</span>
            <span className="text-xs text-muted-foreground">JPG, PNG, PDF — حتى 10MB</span>
          </button>
        )}

        {/* Overlay while uploading */}
        {pending && selectedFile && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-background/60 backdrop-blur-[2px] rounded-lg">
            <div className="bg-background border shadow-sm rounded-full px-4 py-2 flex items-center gap-2">
              <Loader2 className="h-4 w-4 text-primary animate-spin" />
              <span className="text-sm font-medium text-primary">جاري الرفع...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function getTodayAndMin() {
  const today = new Date().toISOString().split("T")[0]
  const min = new Date()
  min.setDate(min.getDate() - 15)
  return { today, minDate: min.toISOString().split("T")[0] }
}

export function AddCustodyModal({
  eligibleEmployees,
  preselectedEmployeeId,
  projects = [],
}: {
  eligibleEmployees: { id: string; name: string; job_title: string | null }[]
  preselectedEmployeeId?: string | null
  projects?: { id: string; name: string; is_company_branch: boolean }[]
}) {
  const [state, formAction] = useActionState(addCustody as any, { error: "", success: false })
  const formRef = React.useRef<HTMLFormElement>(null)
  // Keep a ref to the file input so it always stays in the DOM
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const [selectedFile, setSelectedFile] = React.useState<File | null>(null)
  const { today, minDate } = getTodayAndMin()

  React.useEffect(() => {
    if (state?.success) {
      const url = new URL(window.location.href)
      url.searchParams.delete("modal")
      window.history.pushState({}, "", url)
      formRef.current?.reset()
      setSelectedFile(null)
    }
  }, [state])

  const isImage = selectedFile && selectedFile.type.startsWith("image/")

  function clearFile() {
    setSelectedFile(null)
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  return (
    <Modal name="add-custody" title="إضافة عهدة" description="سجّل عهدة جديدة لأحد الموظفين.">
      <form action={formAction} ref={formRef} className="flex flex-col gap-4 mt-4">

        {/* Employee */}
        {preselectedEmployeeId ? (
          <input type="hidden" name="employee_id" value={preselectedEmployeeId} />
        ) : (
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="ac-employee">الموظف</label>
            {eligibleEmployees.length === 0 ? (
              <p className="text-sm text-muted-foreground bg-muted/40 p-3 rounded-lg">
                لا يوجد موظفون مسموح لهم بالعهد. فعّل خيار &quot;مسموح له بالعهد&quot; من صفحة الموظفين أولاً.
              </p>
            ) : (
              <select id="ac-employee" name="employee_id" required
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <option value="">— اختر موظفاً —</option>
                {eligibleEmployees.map(e => (
                  <option key={e.id} value={e.id}>
                    {e.name}{e.job_title ? ` — ${e.job_title}` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="ac-project">المشروع / الفرع</label>
          <select id="ac-project" name="project_id" required
            defaultValue={projects.length === 1 ? projects[0].id : ""}
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
          <label className="text-sm font-medium" htmlFor="ac-date">التاريخ</label>
          <Input id="ac-date" name="date" type="date"
            defaultValue={today} min={minDate} max={today} />
          <p className="text-xs text-muted-foreground">يمكن تعديل التاريخ حتى 15 يوم سابقاً كحد أقصى.</p>
        </div>

        {/* Item */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="ac-item">البند</label>
          <Input id="ac-item" name="item" placeholder="مثال: لابتوب، أدوات، مصاريف سفر..." required />
        </div>

        {/* Amount */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="ac-amount">المبلغ (EGP)</label>
          <Input id="ac-amount" name="amount" type="number" step="0.01" inputMode="decimal" placeholder="0.00" required min="0.01" />
        </div>

        {/* Notes */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="ac-notes">ملاحظات</label>
          <textarea id="ac-notes" name="notes" rows={2}
            placeholder="ملاحظات إضافية (اختياري)"
            className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none" />
        </div>

        {/* File Upload */}
        <FileDropzone
          selectedFile={selectedFile}
          setSelectedFile={setSelectedFile}
          fileInputRef={fileInputRef}
          clearFile={clearFile}
        />

        {state?.error && <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{state.error}</p>}

        <div className="flex justify-end gap-2 mt-2">
          <SubmitButton />
        </div>
      </form>
    </Modal>
  )
}
