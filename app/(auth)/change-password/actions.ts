'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { logAudit } from '@/lib/audit'

export async function changePassword(prevState: any, formData: FormData) {
  const newPassword = formData.get('new_password') as string
  const confirmPassword = formData.get('confirm_password') as string

  if (!newPassword || !confirmPassword) {
    return { error: 'يرجى تعبئة جميع الحقول' }
  }

  if (newPassword !== confirmPassword) {
    return { error: 'كلمتا المرور غير متطابقتين' }
  }

  if (newPassword.length < 6) {
    return { error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' }
  }

  const supabase = await createClient()

  const { error } = await supabase.auth.updateUser({
    password: newPassword,
    data: { must_change_password: false },
  })

  if (error) {
    console.error('Change password error:', error)
    return { error: `فشل في تغيير كلمة المرور: ${error.message}` }
  }

  const { data: userData } = await supabase.auth.getUser()
  const { data: employeeData } = await supabase
    .from('employees')
    .select('id')
    .eq('auth_user_id', userData.user?.id)
    .single()

  await logAudit({
    employee_id: employeeData?.id,
    action: 'update',
    entity_type: 'user_credentials',
    entity_id: employeeData?.id,
  })

  revalidatePath('/', 'layout')
  redirect('/')
}
