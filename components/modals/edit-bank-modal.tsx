"use client"

import * as React from "react"
import { useActionState } from "react"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { editBank } from "@/app/(app)/accounts/actions"
import { useFormStatus } from "react-dom"
import { useSearchParams } from "next/navigation"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جاري الحفظ..." : "حفظ التعديلات"}
    </Button>
  )
}

export function EditBankModal({ banks }: { banks: any[] }) {
  const [state, formAction] = useActionState(editBank as any, { error: "", success: false })
  const formRef = React.useRef<HTMLFormElement>(null)
  const searchParams = useSearchParams()
  const bankId = searchParams.get("id")

  const bank = React.useMemo(() => banks.find(b => b.id === bankId), [banks, bankId])

  React.useEffect(() => {
    if (state?.success) {
      const url = new URL(window.location.href)
      url.searchParams.delete("modal")
      url.searchParams.delete("id")
      window.history.pushState({}, "", url)
      formRef.current?.reset()
    }
  }, [state])

  // Don't render inputs if no bank is found, though Modal wrapper still renders
  if (!bank && searchParams.get("modal") === "edit-bank") {
    return null
  }

  return (
    <Modal name="edit-bank" title="تعديل بيانات البنك" description="قم بتحديث اسم البنك.">
      <form action={formAction} ref={formRef} className="flex flex-col gap-4 mt-4">
        <input type="hidden" name="id" value={bank?.id || ""} />
        
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="name">اسم البنك</label>
          <Input 
            id="name"
            name="name"
            defaultValue={bank?.name || ""}
            placeholder="مثال: البنك الأهلي"
            required
          />
        </div>
        
        {state?.error && (
          <p className="text-sm text-destructive">{state.error}</p>
        )}

        <div className="flex justify-end gap-2 mt-2">
          <SubmitButton />
        </div>
      </form>
    </Modal>
  )
}
