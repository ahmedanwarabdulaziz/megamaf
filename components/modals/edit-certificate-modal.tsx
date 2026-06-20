"use client"

import * as React from "react"
import { useActionState } from "react"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { editCertificate } from "@/app/(app)/finance/certificates/actions"
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

export function EditCertificateModal() {
  const [state, formAction] = useActionState(editCertificate as any, { error: "", success: false })
  const formRef = React.useRef<HTMLFormElement>(null)
  const searchParams = useSearchParams()

  const id = searchParams?.get("id") || ""
  const bank_name = searchParams?.get("bank_name") || ""
  const certificate_type = searchParams?.get("certificate_type") || ""
  const amount = searchParams?.get("amount") || ""
  const currency = searchParams?.get("currency") || "EGP"
  const interest_rate = searchParams?.get("interest_rate") || ""
  const duration_months = searchParams?.get("duration_months") || ""
  const start_date = searchParams?.get("start_date") || ""
  const payout_frequency = searchParams?.get("payout_frequency") || "monthly"
  const notes = searchParams?.get("notes") || ""

  React.useEffect(() => {
    if (state?.success) {
      const url = new URL(window.location.href)
      url.searchParams.delete("modal")
      url.searchParams.delete("id")
      url.searchParams.delete("bank_name")
      url.searchParams.delete("certificate_type")
      url.searchParams.delete("amount")
      url.searchParams.delete("currency")
      url.searchParams.delete("interest_rate")
      url.searchParams.delete("duration_months")
      url.searchParams.delete("start_date")
      url.searchParams.delete("payout_frequency")
      url.searchParams.delete("notes")
      window.history.pushState({}, "", url)
      formRef.current?.reset()
    }
  }, [state])

  return (
    <Modal name="edit-certificate" title="تعديل الشهادة / الوديعة" description="قم بتعديل تفاصيل الشهادة.">
      <form action={formAction} ref={formRef} className="flex flex-col gap-4 mt-4">
        <input type="hidden" name="id" value={id} />
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="edit_bank_name">اسم البنك</label>
            <Input id="edit_bank_name" name="bank_name" defaultValue={bank_name} required />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="edit_certificate_type">نوع الشهادة / الوديعة</label>
            <Input id="edit_certificate_type" name="certificate_type" defaultValue={certificate_type} required />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="edit_amount">مبلغ الشهادة / الوديعة</label>
          <Input id="edit_amount" name="amount" type="number" step="0.01" inputMode="decimal" defaultValue={amount} required />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="edit_currency">العملة</label>
            <select id="edit_currency" name="currency" defaultValue={currency} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="EGP">جنيه مصري (EGP)</option>
              <option value="USD">دولار أمريكي (USD)</option>
              <option value="EUR">يورو (EUR)</option>
            </select>
          </div>
          
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="edit_interest_rate">نسبة الفائدة السنوية %</label>
            <Input id="edit_interest_rate" name="interest_rate" type="number" step="0.01" inputMode="decimal" defaultValue={interest_rate} required />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="edit_duration_months">المدة (بالشهور)</label>
            <Input id="edit_duration_months" name="duration_months" type="number" inputMode="numeric" defaultValue={duration_months} required />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="edit_start_date">تاريخ الربط</label>
            <Input id="edit_start_date" name="start_date" type="date" defaultValue={start_date} required />
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="edit_payout_frequency">دورية صرف العائد</label>
            <select id="edit_payout_frequency" name="payout_frequency" defaultValue={payout_frequency} className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="monthly">شهري</option>
              <option value="quarterly">ربع سنوي</option>
              <option value="semi_annually">نصف سنوي</option>
              <option value="annually">سنوي</option>
              <option value="at_maturity">في نهاية المدة</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="edit_notes">ملاحظات (اختياري)</label>
          <Input id="edit_notes" name="notes" defaultValue={notes} />
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
