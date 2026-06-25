"use client"

import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { saveOwner } from "@/app/(app)/settings/owners/actions"
import { useTransition } from "react"
import { useRouter, useSearchParams } from "next/navigation"

export function OwnerModal() {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const searchParams = useSearchParams()
  
  const isOpen = searchParams.get("modal") === "add-owner" || searchParams.get("modal") === "edit-owner"
  const isEdit = searchParams.get("modal") === "edit-owner"
  
  const id = searchParams.get("id") || ""
  const name = searchParams.get("name") || ""
  const phone = searchParams.get("phone") || ""
  const notes = searchParams.get("notes") || ""

  const action = (formData: FormData) => {
    startTransition(async () => {
      await saveOwner(formData)
      const params = new URLSearchParams(searchParams.toString())
      params.delete("modal")
      params.delete("id")
      params.delete("name")
      params.delete("phone")
      params.delete("notes")
      router.push(`?${params.toString()}`, { scroll: false })
    })
  }

  if (!isOpen) return null

  return (
    <Modal name={searchParams.get("modal")!} title={isEdit ? "تعديل المالك" : "إضافة مالك"}>
      <form action={action} className="space-y-4">
        {isEdit && <input type="hidden" name="id" value={id} />}
        
        <div className="space-y-2">
          <label className="text-sm font-medium">الاسم</label>
          <Input name="name" defaultValue={name} required />
        </div>
        
        <div className="space-y-2">
          <label className="text-sm font-medium">رقم الهاتف</label>
          <Input name="phone" defaultValue={phone} />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">ملاحظات</label>
          <Input name="notes" defaultValue={notes} />
        </div>

        <div className="pt-4 flex justify-end gap-2">
          <Button 
            type="button" 
            variant="outline" 
            onClick={() => {
              const params = new URLSearchParams(searchParams.toString())
              params.delete("modal")
              router.push(`?${params.toString()}`, { scroll: false })
            }}
          >
            إلغاء
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? "جاري الحفظ..." : "حفظ المالك"}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
