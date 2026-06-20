"use client"

import * as React from "react"
import { useActionState } from "react"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { addCertificate } from "@/app/(app)/finance/certificates/actions"
import { useFormStatus } from "react-dom"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جاري الحفظ..." : "حفظ الشهادة"}
    </Button>
  )
}

export function AddCertificateModal() {
  const [state, formAction] = useActionState(addCertificate as any, { error: "", success: false })
  const formRef = React.useRef<HTMLFormElement>(null)

  React.useEffect(() => {
    if (state?.success) {
      const url = new URL(window.location.href)
      url.searchParams.delete("modal")
      window.history.pushState({}, "", url)
      formRef.current?.reset()
    }
  }, [state])

  return (
    <Modal name="add-certificate" title="إضافة شهادة / وديعة" description="أدخل تفاصيل الشهادة أو الوديعة لتوليد جدول الأرباح.">
      <form action={formAction} ref={formRef} className="flex flex-col gap-4 mt-4">
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="bank_name">اسم البنك</label>
            <Input id="bank_name" name="bank_name" placeholder="مثال: البنك الأهلي المصري" required />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="certificate_type">نوع الشهادة / الوديعة</label>
            <Input id="certificate_type" name="certificate_type" placeholder="مثال: الشهادة البلاتينية 3 سنوات" required />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="amount">مبلغ الشهادة / الوديعة</label>
          <Input id="amount" name="amount" type="number" step="0.01" inputMode="decimal" required />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="currency">العملة</label>
            <select id="currency" name="currency" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="EGP">جنيه مصري (EGP)</option>
              <option value="USD">دولار أمريكي (USD)</option>
              <option value="EUR">يورو (EUR)</option>
            </select>
          </div>
          
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="interest_rate">نسبة الفائدة السنوية %</label>
            <Input id="interest_rate" name="interest_rate" type="number" step="0.01" inputMode="decimal" placeholder="مثال: 20" required />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="duration_months">المدة (بالشهور)</label>
            <Input id="duration_months" name="duration_months" type="number" inputMode="numeric" placeholder="مثال: 12" required />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="start_date">تاريخ الربط</label>
            <Input id="start_date" name="start_date" type="date" required />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="payout_frequency">دورية صرف العائد</label>
            <select id="payout_frequency" name="payout_frequency" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="monthly">شهري</option>
              <option value="quarterly">ربع سنوي</option>
              <option value="semi_annually">نصف سنوي</option>
              <option value="annually">سنوي</option>
              <option value="at_maturity">في نهاية المدة</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="notes">ملاحظات (اختياري)</label>
          <Input id="notes" name="notes" placeholder="ملاحظات إضافية..." />
        </div>
        
        {state?.error && (
          <p className="text-sm text-destructive">{state.error}</p>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <SubmitButton />
        </div>
      </form>
    </Modal>
  )
}
