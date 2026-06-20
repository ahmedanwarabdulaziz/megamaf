"use client"

import * as React from "react"
import { useActionState } from "react"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { editBankAccount } from "@/app/(app)/accounts/actions"
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

export function EditBankAccountModal({ accounts, banks }: { accounts: any[], banks: any[] }) {
  const [state, formAction] = useActionState(editBankAccount as any, { error: "", success: false })
  const formRef = React.useRef<HTMLFormElement>(null)
  const searchParams = useSearchParams()
  const accountId = searchParams.get("id")

  const account = React.useMemo(() => accounts.find(a => a.id === accountId), [accounts, accountId])

  React.useEffect(() => {
    if (state?.success) {
      const url = new URL(window.location.href)
      url.searchParams.delete("modal")
      url.searchParams.delete("id")
      window.history.pushState({}, "", url)
      formRef.current?.reset()
    }
  }, [state])

  if (!account && searchParams.get("modal") === "edit-bank-account") {
    return null
  }

  return (
    <Modal name="edit-bank-account" title="تعديل الحساب البنكي" description="قم بتحديث تفاصيل الحساب البنكي.">
      <form action={formAction} ref={formRef} className="flex flex-col gap-4 mt-4">
        <input type="hidden" name="id" value={account?.id || ""} />
        
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="bank_id">البنك</label>
          <select 
            id="bank_id"
            name="bank_id"
            required
            defaultValue={account?.bank_id || ""}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="">اختر البنك</option>
            {banks.map(bank => (
              <option key={bank.id} value={bank.id}>{bank.name}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="account_name">اسم الحساب</label>
          <Input 
            id="account_name"
            name="account_name"
            defaultValue={account?.account_name || ""}
            placeholder="مثال: الحساب الجاري"
            required
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="account_number">رقم الحساب (اختياري)</label>
          <Input 
            id="account_number"
            name="account_number"
            inputMode="numeric"
            defaultValue={account?.account_number || ""}
            placeholder="مثال: 123456789"
          />
        </div>

        <div className="flex gap-4">
          <div className="flex flex-col gap-2 flex-1">
            <label className="text-sm font-medium" htmlFor="currency">العملة</label>
            <select 
              id="currency"
              name="currency"
              defaultValue={account?.currency || "EGP"}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <option value="EGP">جنيه مصري (EGP)</option>
              <option value="USD">دولار أمريكي (USD)</option>
              <option value="EUR">يورو (EUR)</option>
              <option value="SAR">ريال سعودي (SAR)</option>
            </select>
          </div>

          <div className="flex flex-col gap-2 flex-1">
            <label className="text-sm font-medium" htmlFor="opening_balance">الرصيد الافتتاحي</label>
            <Input 
              id="opening_balance"
              name="opening_balance"
              type="number"
              step="0.01"
              inputMode="decimal"
              defaultValue={account?.opening_balance || 0}
              required
            />
          </div>
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
