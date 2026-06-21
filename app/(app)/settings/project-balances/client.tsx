"use client"

import { useState } from "react"
import { useTransition } from "react"
import { saveProjectLegacyBalances } from "./actions"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Loader2, CheckCircle2 } from "lucide-react"

interface ProjectBalanceFormProps {
  project: {
    id: string
    name: string
  }
  legacyBalances: {
    legacy_paid_custodies: number
    legacy_vendor_payments: number
    legacy_funds: number
  } | null
}

export function ProjectBalanceForm({ project, legacyBalances }: ProjectBalanceFormProps) {
  const [isPending, startTransition] = useTransition()
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState("")

  async function handleSubmit(formData: FormData) {
    setError("")
    setSuccess(false)
    const paidCustodies = Number(formData.get("legacy_paid_custodies")) || 0
    const vendorPayments = Number(formData.get("legacy_vendor_payments")) || 0
    const funds = Number(formData.get("legacy_funds")) || 0

    startTransition(async () => {
      const result = await saveProjectLegacyBalances(project.id, paidCustodies, vendorPayments, funds)
      if (result.error) {
        setError(result.error)
      } else {
        setSuccess(true)
        setTimeout(() => setSuccess(false), 3000)
      }
    })
  }

  return (
    <Card>
      <CardContent className="p-4">
        <h3 className="font-bold text-lg mb-4">{project.name}</h3>
        <form action={handleSubmit} className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-end">
          <div className="space-y-2">
            <label className="text-sm font-medium">تمويل سابق (الذي دخل البنك قبل التطبيق)</label>
            <Input 
              type="number" 
              name="legacy_funds" 
              defaultValue={legacyBalances?.legacy_funds || ""}
              placeholder="0.00"
              step="0.01"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">عهد مصروفة سابقاً (رواتب/سلف)</label>
            <Input 
              type="number" 
              name="legacy_paid_custodies" 
              defaultValue={legacyBalances?.legacy_paid_custodies || ""}
              placeholder="0.00"
              step="0.01"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium">مدفوعات موردين سابقاً</label>
            <Input 
              type="number" 
              name="legacy_vendor_payments" 
              defaultValue={legacyBalances?.legacy_vendor_payments || ""}
              placeholder="0.00"
              step="0.01"
            />
          </div>
          <div className="flex flex-col gap-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "حفظ الأرصدة"}
            </Button>
            {success && <span className="text-sm text-green-600 flex items-center gap-1"><CheckCircle2 className="h-3.5 w-3.5" /> تم الحفظ</span>}
            {error && <span className="text-sm text-red-600">{error}</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
