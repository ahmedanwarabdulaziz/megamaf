"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { AlertCircle, ArrowLeft, Clock } from "lucide-react"
import Link from "next/link"
import { QuickActions } from "@/components/ui/quick-actions"
import { CustodyApproveButton } from "@/app/(app)/custodies/_components/custody-approve-button"

type PendingCustody = {
  id: string
  item: string
  amount: number
  date: string
  employees: { name: string } | null
}

export function PendingCustodiesCard({ custodies, canApprove }: { custodies: PendingCustody[], canApprove: boolean }) {
  const displayCustodies = custodies?.slice(0, 4) || []
  const remainingCount = (custodies?.length || 0) - displayCustodies.length
  const totalAmount = (custodies || []).reduce((sum, c) => sum + Number(c.amount), 0)

  return (
    <Card className="col-span-full border-amber-500/30 shadow-sm bg-gradient-to-br from-card to-amber-500/5">
      <CardHeader className="pb-3 border-b border-border/30">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-lg font-bold tracking-tight text-amber-700 dark:text-amber-500">
            <AlertCircle className="h-5 w-5" />
            عهد بانتظار الاعتماد
          </CardTitle>
          <div className="text-sm font-bold text-amber-700 dark:text-amber-500 bg-amber-500/10 px-3 py-1 rounded-full">
            {custodies.length} طلبات
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {displayCustodies.length === 0 ? (
          <div className="text-center py-6 text-muted-foreground text-sm">
            لا توجد عهد بانتظار الاعتماد حالياً.
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border/30">
            {displayCustodies.map((custody) => (
              <QuickActions key={custody.id} menuContent={
                <div className="flex flex-col gap-0.5 w-full">
                  {canApprove ? (
                    <CustodyApproveButton custodyId={custody.id} mode="approve" />
                  ) : (
                    <div className="text-xs p-2 text-muted-foreground text-center">لا تملك صلاحية الاعتماد</div>
                  )}
                </div>
              }>
                <div className="p-3 px-4 sm:px-5 flex items-center justify-between hover:bg-muted/50 transition-colors cursor-context-menu">
                  <div className="flex flex-col gap-1">
                    <div className="font-semibold text-sm">
                      {custody.employees?.name || "موظف غير معروف"}
                    </div>
                    <div className="text-xs text-muted-foreground flex items-center gap-1.5">
                      <Clock className="h-3 w-3" />
                      {custody.item} <span className="opacity-50">|</span> {new Date(custody.date).toLocaleDateString('en-GB')}
                    </div>
                  </div>
                  <div className="font-bold text-amber-600 dark:text-amber-500 dir-ltr text-sm">
                    {Number(custody.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })} EGP
                  </div>
                </div>
              </QuickActions>
            ))}
            
            <div className="p-3 px-4 sm:px-5 bg-muted/20 flex items-center justify-between">
              <div className="text-sm font-semibold text-muted-foreground">
                الإجمالي المعلق
              </div>
              <div className="font-bold text-amber-700 dark:text-amber-400 dir-ltr">
                {totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2 })} EGP
              </div>
            </div>
          </div>
        )}

        <div className="p-3 border-t border-border/30 flex justify-center">
          <Link href="/custodies" className="text-sm font-medium text-amber-600 dark:text-amber-500 hover:text-amber-700 dark:hover:text-amber-400 flex items-center gap-1 transition-colors">
            عرض كل العهد
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}
