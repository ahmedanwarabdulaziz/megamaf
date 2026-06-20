'use client'

import * as React from 'react'
import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { changePassword } from './actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { KeyRound, ShieldCheck } from 'lucide-react'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending} className="w-full">
      {pending ? 'جاري الحفظ...' : 'تغيير كلمة المرور'}
    </Button>
  )
}

export default function ChangePasswordPage() {
  const [state, formAction] = useActionState(changePassword as any, { error: '', success: false })

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-background">
      <div className="w-full max-w-sm space-y-6">
        {/* Icon */}
        <div className="flex flex-col items-center gap-3">
          <div className="p-4 rounded-full bg-primary/10">
            <KeyRound className="h-8 w-8 text-primary" />
          </div>
          <div className="text-center">
            <h1 className="text-2xl font-bold">تغيير كلمة المرور</h1>
            <p className="text-muted-foreground text-sm mt-1">
              يجب عليك تغيير كلمة المرور المؤقتة قبل المتابعة
            </p>
          </div>
        </div>

        <Card>
          <CardContent className="pt-6">
            <form action={formAction} className="flex flex-col gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium" htmlFor="new_password">
                  كلمة المرور الجديدة
                </label>
                <Input
                  id="new_password"
                  name="new_password"
                  type="password"
                  placeholder="••••••••"
                  required
                  minLength={6}
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-sm font-medium" htmlFor="confirm_password">
                  تأكيد كلمة المرور
                </label>
                <Input
                  id="confirm_password"
                  name="confirm_password"
                  type="password"
                  placeholder="••••••••"
                  required
                  minLength={6}
                />
              </div>

              {state?.error && (
                <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">
                  {state.error}
                </p>
              )}

              <SubmitButton />
            </form>
          </CardContent>
        </Card>

        <div className="flex items-center gap-2 text-xs text-muted-foreground justify-center">
          <ShieldCheck className="h-3.5 w-3.5" />
          كلمة المرور يجب أن تكون 6 أحرف على الأقل
        </div>
      </div>
    </div>
  )
}
