"use client"

import * as React from "react"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { setEmployeeCredentials } from "@/app/(app)/employees/actions"
import { KeyRound, RefreshCw, Lock, User } from "lucide-react"

function SubmitButton({ hasAccount }: { hasAccount: boolean }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending
        ? "جاري الحفظ..."
        : hasAccount
        ? "إعادة تعيين كلمة المرور"
        : "إنشاء حساب"}
    </Button>
  )
}

export function SetCredentialsModal({ employees }: { employees: any[] }) {
  const [state, formAction] = useActionState(setEmployeeCredentials as any, { error: "", success: false })
  const formRef = React.useRef<HTMLFormElement>(null)
  const [selectedEmployee, setSelectedEmployee] = React.useState<any>(null)

  const lastEmpIdRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const empId = params.get("set_credentials")
    if (empId && empId !== lastEmpIdRef.current) {
      lastEmpIdRef.current = empId
      const found = employees.find(e => e.id === empId)
      setSelectedEmployee(found || null)
    } else if (!empId) {
      lastEmpIdRef.current = null
      setSelectedEmployee(null)
    }
  })

  React.useEffect(() => {
    if (state?.success) {
      const url = new URL(window.location.href)
      url.searchParams.delete("modal")
      url.searchParams.delete("set_credentials")
      window.history.pushState({}, "", url)
      formRef.current?.reset()
    }
  }, [state])

  const hasAccount = !!selectedEmployee?.auth_user_id

  return (
    <Modal
      name="set-credentials"
      title={hasAccount ? "إعادة تعيين كلمة المرور" : "إنشاء بيانات دخول"}
      description={
        hasAccount
          ? `إعادة تعيين كلمة المرور المؤقتة لـ ${selectedEmployee?.name || "الموظف"}. سيُطلب منه تغييرها عند تسجيل الدخول.`
          : `إنشاء اسم مستخدم وكلمة مرور مؤقتة لـ ${selectedEmployee?.name || "الموظف"}.`
      }
    >
      <form action={formAction} ref={formRef} className="flex flex-col gap-4 mt-4">
        <input type="hidden" name="employee_id" value={selectedEmployee?.id || ""} />

        {/* Employee info */}
        {selectedEmployee && (
          <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/40 border border-border">
            <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center font-bold text-primary text-sm shrink-0">
              {selectedEmployee.name?.charAt(0)}
            </div>
            <div>
              <p className="font-medium text-sm">{selectedEmployee.name}</p>
              <p className="text-xs text-muted-foreground">{selectedEmployee.job_title || "موظف"}</p>
            </div>
          </div>
        )}

        {/* Username */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium flex items-center gap-1.5" htmlFor="sc-username">
            <User className="h-3.5 w-3.5" />
            اسم المستخدم
          </label>
          {hasAccount ? (
            <div className="flex items-center gap-2 h-10 w-full rounded-md border border-input bg-muted px-3 py-2 text-sm text-muted-foreground">
              <Lock className="h-3.5 w-3.5" />
              {selectedEmployee?.username}
              <span className="mr-auto text-xs">(لا يمكن تغييره)</span>
            </div>
          ) : (
            <>
              <Input
                id="sc-username"
                name="username"
                placeholder="ahmed_ali"
                pattern="[a-z0-9_]+"
                title="أحرف إنجليزية صغيرة، أرقام، أو شرطة سفلية فقط"
                required
              />
              <p className="text-xs text-muted-foreground">
                يسمح فقط بالأحرف الإنجليزية الصغيرة، الأرقام، والشرطة السفلية. لا يمكن تغييره لاحقاً.
              </p>
            </>
          )}
        </div>

        {/* Temp Password */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium flex items-center gap-1.5" htmlFor="sc-password">
            <KeyRound className="h-3.5 w-3.5" />
            كلمة المرور المؤقتة
          </label>
          <Input
            id="sc-password"
            name="temp_password"
            type="text"
            placeholder="6 أحرف على الأقل"
            minLength={6}
            required
          />
          <p className="text-xs text-muted-foreground">
            سيُطلب من الموظف تغيير هذه الكلمة فور تسجيل دخوله الأول.
          </p>
        </div>

        {hasAccount && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-sm text-amber-700">
            <RefreshCw className="h-4 w-4 shrink-0 mt-0.5" />
            <span>
              سيتم إعادة تفعيل إجبار تغيير كلمة المرور. عند تسجيل الموظف للدخول بالكلمة الجديدة، سيُطلب منه فوراً اختيار كلمة مرور شخصية.
            </span>
          </div>
        )}

        {state?.error && (
          <p className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{state.error}</p>
        )}

        <div className="flex justify-end gap-2 mt-2">
          <SubmitButton hasAccount={hasAccount} />
        </div>
      </form>
    </Modal>
  )
}
