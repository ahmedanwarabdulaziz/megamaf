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
      <CardContent className="p-0 grid grid-cols-3 divide-x divide-x-reverse divide-border">
        {rows.map(({ label, amount, count, status, color, isTotal }) => {
          const isActive = currentStatus === status
          return (
            <button
              key={label}
              onClick={() => navigate(status)}
              className={cn(
                "flex flex-col items-center justify-center p-3 transition-colors text-center relative",
                "hover:bg-muted/60",
                isActive && "bg-primary/5",
                isTotal && "bg-muted/30 hover:bg-muted/50"
              )}
            >
              {isActive && !isTotal && (
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-primary" />
              )}
              <div className="flex items-center justify-center gap-1.5 mb-1.5">
                <span className={cn(
                  "text-xs",
                  isTotal ? "font-medium" : "text-muted-foreground",
                  isActive && "font-semibold text-foreground"
                )}>
                  {label}
                </span>
                <span className={cn(
                  "text-[10px] border rounded-full px-1.5 py-0.5 dir-ltr tabular-nums leading-none",
                  isActive ? "border-primary/40 text-primary" : "border-border text-muted-foreground"
                )}>
                  {count}
                </span>
              </div>
              <span className={cn(
                "text-sm sm:text-base dir-ltr tabular-nums",
                isTotal ? "font-bold" : "font-semibold",
                color,
                isActive && !color && "text-primary"
              )}>
                {fmt(amount)}
              </span>
            </button>
          )
        })}
      </CardContent>
    </Card>
  )
}
