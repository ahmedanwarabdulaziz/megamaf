"use client"

import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"
import { Card, CardContent } from "@/components/ui/card"

interface SummaryRow {
  label: string
  amount: number
  count: number
  status: "" | "pending" | "approved"
  color?: string
  isTotal?: boolean
}

export function CustodySummary({
  notApprovedAmount,
  notApprovedCount,
  approvedAmount,
  approvedCount,
  totalAmount,
  totalCount,
}: {
  notApprovedAmount: number
  notApprovedCount: number
  approvedAmount: number
  approvedCount: number
  totalAmount: number
  totalCount: number
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const currentStatus = searchParams.get("status") || ""

  function navigate(status: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (status) params.set("status", status)
    else params.delete("status")
    params.delete("employee_id")
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const fmt = (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const rows: SummaryRow[] = [
    { label: "غير معتمدة", amount: notApprovedAmount, count: notApprovedCount, status: "pending", color: "" },
    { label: "معتمدة",     amount: approvedAmount,    count: approvedCount,    status: "approved", color: "text-green-600" },
    { label: "الإجمالي",  amount: totalAmount,        count: totalCount,       status: "", isTotal: true },
  ]

  return (
    <Card>
      <CardContent className="p-0 divide-y divide-border">
        {rows.map(({ label, amount, count, status, color, isTotal }) => {
          const isActive = currentStatus === status
          return (
            <button
              key={label}
              onClick={() => navigate(status)}
              className={cn(
                "w-full flex items-center justify-between px-4 py-2.5 transition-colors text-right",
                "hover:bg-muted/60",
                isActive && "bg-primary/8",
                isTotal && "bg-muted/40 hover:bg-muted/60"
              )}
            >
              <span className={cn(
                "text-sm",
                isTotal ? "font-medium" : "text-muted-foreground",
                isActive && "font-semibold text-foreground"
              )}>
                {label}
                {isActive && !isTotal && (
                  <span className="mr-1.5 inline-block w-1.5 h-1.5 rounded-full bg-primary align-middle" />
                )}
              </span>
              <div className="flex items-center gap-3">
                <span className={cn(
                  "text-xs border rounded-full px-2 py-0.5 dir-ltr tabular-nums",
                  isActive ? "border-primary/40 text-primary" : "border-border text-muted-foreground"
                )}>
                  {count}
                </span>
                <span className={cn(
                  "text-sm dir-ltr tabular-nums",
                  isTotal ? "font-bold" : "font-semibold",
                  color,
                  isActive && !color && "text-primary"
                )}>
                  {fmt(amount)} EGP
                </span>
              </div>
            </button>
          )
        })}
      </CardContent>
    </Card>
  )
}
