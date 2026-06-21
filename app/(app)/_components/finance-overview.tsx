"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Landmark, Wallet } from "lucide-react"

type BankAccount = {
  id: string
  account_name: string
  currency: string
}

type BankTransaction = {
  bank_account_id: string
  type: string
  amount: number
  transaction_date: string
}

export function FinanceOverview({
  accounts,
  transactions,
}: {
  accounts: BankAccount[]
  transactions: BankTransaction[]
}) {
  const [selectedAccountId, setSelectedAccountId] = useState<string>("all")

  // Filter transactions by selected account
  const filteredTransactions = useMemo(() => {
    if (selectedAccountId === "all") return transactions
    return transactions.filter((t) => t.bank_account_id === selectedAccountId)
  }, [transactions, selectedAccountId])

  // Calculate totals per currency
  const totalsByCurrency = useMemo(() => {
    const totals: Record<string, { in: number; out: number }> = {}

    for (const tx of filteredTransactions) {
      const account = accounts.find((a) => a.id === tx.bank_account_id)
      if (!account) continue
      const currency = account.currency || "EGP"

      if (!totals[currency]) {
        totals[currency] = { in: 0, out: 0 }
      }

      if (tx.type === "deposit") {
        totals[currency].in += Number(tx.amount)
      } else if (tx.type === "withdrawal") {
        totals[currency].out += Number(tx.amount)
      }
    }

    return totals
  }, [filteredTransactions, accounts])

  return (
    <Card className="col-span-full shadow-sm bg-card border-border/60">
      <CardHeader className="pb-2 pt-3 px-4 sm:px-5 border-b border-border/30">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base font-bold tracking-tight">
            <Landmark className="h-4 w-4 text-primary" />
            التدفقات النقدية (هذا الشهر)
          </CardTitle>

          {/* Tags / Filter */}
          {accounts.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setSelectedAccountId("all")}
                className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors border ${
                  selectedAccountId === "all"
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-background text-muted-foreground hover:bg-muted border-border"
                }`}
              >
                الجميع
              </button>
              {accounts.map((acc) => (
                <button
                  key={acc.id}
                  onClick={() => setSelectedAccountId(acc.id)}
                  className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors border flex items-center gap-1 ${
                    selectedAccountId === acc.id
                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                      : "bg-background text-muted-foreground hover:bg-muted border-border"
                  }`}
                >
                  <Wallet className="h-3 w-3" />
                  {acc.account_name}
                </button>
              ))}
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {/* Totals */}
        {Object.keys(totalsByCurrency).length === 0 ? (
          <div className="text-center py-4 text-muted-foreground text-sm">
            لا توجد حركات مالية هذا الشهر.
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-border/30">
            {Object.entries(totalsByCurrency).map(([currency, totals]) => {
              const net = totals.in - totals.out;
              
              return (
                <div key={currency} className="p-3 px-4 sm:px-5">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="px-2 py-0.5 bg-muted rounded text-[10px] font-bold text-muted-foreground tracking-wider uppercase border border-border/50">
                      {currency}
                    </span>
                  </div>

                  {/* Table Layout: One line for text, one line for numbers */}
                  <div className="grid grid-cols-3 text-center">
                    {/* Headers Line */}
                    <div className="text-xs font-bold text-muted-foreground pb-1 border-b border-border/20">الوارد</div>
                    <div className="text-xs font-bold text-muted-foreground pb-1 border-b border-border/20">المنصرف</div>
                    <div className="text-xs font-bold text-muted-foreground pb-1 border-b border-border/20">صافي التدفقات</div>
                    
                    {/* Numbers Line */}
                    <div className="text-base sm:text-lg font-bold text-green-600 dark:text-green-500 dir-ltr pt-1">
                      {totals.in.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </div>
                    <div className="text-base sm:text-lg font-bold text-red-600 dark:text-red-500 dir-ltr pt-1">
                      {totals.out.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </div>
                    <div className={`text-base sm:text-lg font-bold dir-ltr pt-1 ${
                      net > 0 ? "text-primary" : net < 0 ? "text-orange-600 dark:text-orange-500" : "text-foreground"
                    }`}>
                      {net.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
