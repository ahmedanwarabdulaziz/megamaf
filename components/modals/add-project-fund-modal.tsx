"use client"

import * as React from "react"
import { useActionState } from "react"
import { useFormStatus } from "react-dom"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { addProjectFund } from "@/app/(app)/projects/actions"
import { useSearchParams } from "next/navigation"
import { TrendingUp, Landmark } from "lucide-react"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "جاري الحفظ..." : "إضافة تمويل"}
    </Button>
  )
}

export function AddProjectFundModal({
  projects,
  bankAccounts,
}: {
  projects: { id: string; name: string; owner_name?: string | null }[]
  bankAccounts: { id: string; account_name: string; bank_name: string }[]
}) {
  const [state, formAction] = useActionState(addProjectFund as any, { error: "", success: false })
  const searchParams = useSearchParams()
  const formRef = React.useRef<HTMLFormElement>(null)

  // project can be pre-selected via ?fund_project=<id>
  const preselectedId = searchParams.get("fund_project") || ""
  const preselectedProject = projects.find(p => p.id === preselectedId)

  React.useEffect(() => {
    if (state?.success) {
      const url = new URL(window.location.href)
      url.searchParams.delete("modal")
      url.searchParams.delete("fund_project")
      window.history.pushState({}, "", url)
      formRef.current?.reset()
    }
  }, [state])

  return (
    <Modal
      name="add-project-fund"
      title="إضافة تمويل للمشروع"
      description="سجّل مبلغاً جديداً يضخّه صاحب المشروع — سيُضاف تلقائياً كإيداع في الحساب البنكي المحدد."
    >
      <form action={formAction} ref={formRef} className="flex flex-col gap-4 mt-4">

        {/* Project selector or pre-selected display */}
        {preselectedProject ? (
          <>
            <input type="hidden" name="project_id" value={preselectedProject.id} />
            <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/20">
              <TrendingUp className="h-4 w-4 text-primary shrink-0" />
              <div>
                <p className="text-sm font-semibold">{preselectedProject.name}</p>
                {preselectedProject.owner_name && (
                  <p className="text-xs text-muted-foreground">صاحب المشروع: {preselectedProject.owner_name}</p>
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="pf-project">المشروع</label>
            <select id="pf-project" name="project_id" required
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <option value="">اختر المشروع...</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}{p.owner_name ? ` — ${p.owner_name}` : ""}</option>
              ))}
            </select>
          </div>
        )}

        {/* Bank account selector */}
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="pf-bank">
            <span className="flex items-center gap-1.5">
              <Landmark className="h-3.5 w-3.5" />
              الحساب البنكي (سيُسجَّل الإيداع فيه)
            </span>
          </label>
          <select id="pf-bank" name="bank_account_id" required
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <option value="">اختر الحساب البنكي...</option>
            {bankAccounts.map(a => (
              <option key={a.id} value={a.id}>{a.bank_name} — {a.account_name}</option>
            ))}
          </select>
          {bankAccounts.length === 0 && (
            <p className="text-xs text-amber-600">لا توجد حسابات بنكية. أضف حساباً بنكياً أولاً من صفحة الحسابات.</p>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="pf-amount">المبلغ المُضاف (EGP)</label>
          <Input
            id="pf-amount"
            name="amount"
            type="number"
            step="0.01"
            inputMode="decimal"
            required
            placeholder="0.00"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="pf-date">تاريخ الاستلام</label>
          <Input
            id="pf-date"
            name="fund_date"
            type="date"
            required
            defaultValue={new Date().toISOString().split("T")[0]}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="pf-note">ملاحظة (اختياري)</label>
          <Input id="pf-note" name="note" placeholder="مثال: دفعة أولى، قسط شهر يونيو..." />
        </div>

        {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

        <div className="flex justify-end gap-2 mt-2">
          <SubmitButton />
        </div>
      </form>
    </Modal>
  )
}
