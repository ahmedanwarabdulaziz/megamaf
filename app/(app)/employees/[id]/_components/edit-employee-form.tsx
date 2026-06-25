'use client'

import { useActionState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { updateEmployeeAction } from '../actions'

export function EditEmployeeForm({ employee }: { employee: any }) {
  const [state, formAction, pending] = useActionState(updateEmployeeAction, null as any)

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="id" value={employee.id} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="text-sm font-medium">الاسم الكامل</label>
          <Input name="full_name" defaultValue={employee.full_name} required />
        </div>
        <div>
          <label className="text-sm font-medium">اسم المستخدم</label>
          <Input name="username" defaultValue={employee.username} readOnly className="bg-muted cursor-not-allowed" />
          <p className="text-xs text-muted-foreground mt-1">لا يمكن تغيير اسم المستخدم بعد الإنشاء.</p>
        </div>
        <div>
          <label className="text-sm font-medium">الصلاحية</label>
          <select
            name="role"
            defaultValue={employee.role}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            <option value="standard">موظف</option>
            <option value="owner">مالك / مدير عام</option>
          </select>
        </div>
        <div>
          <label className="text-sm font-medium">إعادة تعيين الرقم السري</label>
          <Input name="pin" type="password" maxLength={6} minLength={6} placeholder="اتركه فارغاً لعدم التغيير" />
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 pt-2">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="is_active" value="true" defaultChecked={employee.is_active} className="h-4 w-4 rounded border-primary" />
          حساب نشط (يمكنه الدخول)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="can_approve" value="true" defaultChecked={employee.can_approve} className="h-4 w-4 rounded border-primary" />
          يمكنه اعتماد الطلبات (مدير)
        </label>
        <label className="flex items-center gap-2 text-sm text-blue-600 font-medium">
          <input type="checkbox" name="has_custody_access" value="true" defaultChecked={employee.has_custody_access} className="h-4 w-4 rounded border-primary" />
          صلاحية استلام عهدة وتسجيل مصروفات
        </label>
        <label className="flex items-center gap-2 text-sm text-destructive font-bold">
          <input type="checkbox" name="is_super_admin" value="true" defaultChecked={employee.is_super_admin} className="h-4 w-4 rounded border-primary" />
          مدير نظام (صلاحيات كاملة)
        </label>
      </div>

      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
      {state?.success && <p className="text-sm text-green-600">تم حفظ التعديلات بنجاح.</p>}

      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? 'جارٍ الحفظ...' : 'حفظ التعديلات'}
        </Button>
      </div>
    </form>
  )
}
