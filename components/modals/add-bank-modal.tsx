"use client"

import * as React from "react"
import { useActionState } from "react"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { addBank } from "@/app/(app)/accounts/actions"
import { useFormStatus } from "react-dom"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جاري الحفظ..." : "إضافة البنك"}
    </Button>
  )
}

export function AddBankModal() {
  const [state, formAction] = useActionState(addBank as any, { error: "", success: false })
  const formRef = React.useRef<HTMLFormElement>(null)

  React.useEffect(() => {
    if (state?.success) {
      // Close modal by removing it from URL
      const url = new URL(window.location.href)
      url.searchParams.delete("modal")
      window.history.pushState({}, "", url)
      formRef.current?.reset()
    }
  }, [state])

  return (
    <Modal name="add-bank" title="إضافة بنك جديد" description="أدخل اسم البنك الجديد هنا.">
      <form action={formAction} ref={formRef} className="flex flex-col gap-4 mt-4">
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="name">اسم البنك</label>
          <Input 
            id="name"
            name="name"
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
