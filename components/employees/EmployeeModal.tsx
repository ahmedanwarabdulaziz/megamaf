"use client"

import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { saveEmployee } from "@/app/(app)/employees/actions"
import { useTransition } from "react"
import { useRouter } from "next/navigation"

export function EmployeeModal() {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  const action = (formData: FormData) => {
    startTransition(async () => {
      try {
        const result = await saveEmployee(formData)
        if (result && result.error) {
          alert(result.error)
        } else {
          router.push("/employees")
        }
      } catch (e: any) {
        alert(e.message || "حدث خطأ غير متوقع")
      }
    })
  }

  return (
    <Modal name="add-employee" title="إضافة موظف">
      <form action={action} className="space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">الاسم الكامل</label>
          <Input name="full_name" required />
        </div>
        
        <div className="space-y-2">
          <label className="text-sm font-medium">اسم المستخدم</label>
          <Input name="username" required />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">الرقم السري (PIN)</label>
          <Input name="pin" type="password" maxLength={6} minLength={6} required />
          <p className="text-xs text-muted-foreground">يجب أن يكون 6 أرقام</p>
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">الصلاحية</label>
          <Select name="role" defaultValue="standard">
            <option value="standard">مستخدم</option>
            <option value="owner">مالك</option>
          </Select>
        </div>

        <div className="flex items-center gap-2 pt-2">
          <input type="checkbox" name="is_active" value="true" defaultChecked id="is_active" className="h-4 w-4 rounded border-primary" />
          <label htmlFor="is_active" className="text-sm">حساب نشط (يمكنه الدخول)</label>
        </div>

        <div className="flex items-center gap-2">
          <input type="checkbox" name="can_approve" value="true" id="can_approve" className="h-4 w-4 rounded border-primary" />
          <label htmlFor="can_approve" className="text-sm">يمكنه اعتماد الطلبات (مدير)</label>
        </div>

        <div className="flex items-center gap-2">
          <input type="checkbox" name="has_custody_access" value="true" id="has_custody_access" className="h-4 w-4 rounded border-primary" />
          <label htmlFor="has_custody_access" className="text-sm text-blue-600 font-medium">لديه صلاحية استلام عهدة وتسجيل مصروفات</label>
        </div>

        <div className="flex items-center gap-2">
          <input type="checkbox" name="is_super_admin" value="true" id="is_super_admin" className="h-4 w-4 rounded border-primary" />
          <label htmlFor="is_super_admin" className="text-sm font-bold text-destructive">مدير نظام (صلاحيات كاملة)</label>
        </div>

        <div className="pt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.push("/employees")}>
            إلغاء
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? "جاري الحفظ..." : "حفظ الموظف"}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
