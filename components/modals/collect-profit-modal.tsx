"use client"

import * as React from "react"
import { useActionState } from "react"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { collectProfit } from "@/app/(app)/finance/certificates/actions"
import { useFormStatus } from "react-dom"
import { useSearchParams } from "next/navigation"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جاري التحصيل..." : "تأكيد التحصيل"}
    </Button>
  )
}

export function CollectProfitModal({ accounts }: { accounts: any[] }) {
  const [state, formAction] = useActionState(collectProfit as any, { error: "", success: false })
  const formRef = React.useRef<HTMLFormElement>(null)
  const searchParams = useSearchParams()
  
  const expectedAmount = searchParams?.get("expected_amount") || ""
  const certId = searchParams?.get("certificate_id") || ""
  const certType = searchParams?.get("certificate_type") || "شهادة"
  const bankName = searchParams?.get("bank_name") || ""
  const rawDate = searchParams?.get("date") || ""
  const dateStr = rawDate ? new Date(rawDate).toISOString().split('T')[0] : ""

  const defaultDescription = dateStr ? `تحصيل أرباح ${bankName ? `${bankName} - ` : ''}${certType} - استحقاق ${new Date(rawDate).toLocaleDateString('en-GB')}` : `تحصيل أرباح ${bankName ? `${bankName} - ` : ''}${certType}`

  React.useEffect(() => {
    if (state?.success) {
      const url = new URL(window.location.href)
      url.searchParams.delete("modal")
      url.searchParams.delete("certificate_id")
      url.searchParams.delete("certificate_type")
      url.searchParams.delete("bank_name")
      url.searchParams.delete("expected_amount")
      url.searchParams.delete("date")
      window.history.pushState({}, "", url)
      formRef.current?.reset()
    }
  }, [state])

  return (
    <Modal name="collect-profit" title="تحصيل أرباح" description="قم بمراجعة المبلغ وإضافته إلى الحساب البنكي المناسب.">
      <form action={formAction} ref={formRef} className="flex flex-col gap-4 mt-4">
        
        <input type="hidden" name="certificate_id" value={certId} />

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="amount">مبلغ الربح الفعلي</label>
            <Input id="amount" name="amount" type="number" step="0.01" inputMode="decimal" defaultValue={expectedAmount} required />
            <p className="text-xs text-muted-foreground">تأكد من المبلغ الفعلي الذي تم صرفه من البنك.</p>
          </div>

          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="transaction_date">تاريخ التحصيل الفعلي</label>
            <Input id="transaction_date" name="transaction_date" type="date" required defaultValue={new Date().toISOString().split('T')[0]} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="bank_account_id">إيداع في الحساب</label>
          <select id="bank_account_id" name="bank_account_id" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" required>
            <option value="">-- اختر حساب بنكي --</option>
            {accounts.map(acc => (
              <option key={acc.id} value={acc.id}>
                {acc.banks?.name} - {acc.account_name} {acc.account_number ? `(${acc.account_number})` : ''} - [{acc.currency}]
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="description">البيان (اختياري)</label>
          <Input id="description" name="description" placeholder="أرباح شهادة بنكية" defaultValue={defaultDescription} />
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
