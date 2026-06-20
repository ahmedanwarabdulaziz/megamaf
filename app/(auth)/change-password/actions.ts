'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

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

  revalidatePath('/', 'layout')
  redirect('/')
}
