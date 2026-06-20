"use client"

import * as React from "react"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Landmark, Wallet, Pencil, ChevronDown, ChevronUp, FileText } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"

interface BankCardProps {
  bank: any
  accounts: any[]
}

export function BankCard({ bank, accounts }: BankCardProps) {
  const [isExpanded, setIsExpanded] = React.useState(true)

  // Group balances by currency
  const totalsByCurrency = accounts.reduce((acc, account) => {
    const curr = account.currency || "EGP"
    acc[curr] = (acc[curr] || 0) + Number((account.current_balance ?? account.opening_balance) || 0)
    return acc
  }, {} as Record<string, number>)

  const currencies = Object.keys(totalsByCurrency)

  return (
    <Card className="overflow-hidden">
      <CardHeader 
        className="bg-primary text-primary-foreground pb-4 rounded-t-lg cursor-pointer select-none transition-colors hover:bg-primary/95"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between w-full gap-4">
          <div className="flex flex-wrap items-center gap-4 flex-1">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary-foreground/20 rounded-md">
                <Landmark className="h-5 w-5 text-primary-foreground" />
              </div>
              <CardTitle className="text-xl whitespace-nowrap">{bank.name}</CardTitle>
            </div>
            
            {/* Bank Totals Inline */}
            {currencies.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 border-r border-primary-foreground/20 pr-4">
                <span className="text-sm font-medium text-primary-foreground/80 my-auto ml-2">الإجمالي:</span>
                {currencies.map(curr => (
                  <div key={curr} className="flex items-center gap-1.5 bg-primary-foreground/10 px-3 py-1 rounded-full">
                    <span className="font-bold text-sm dir-ltr">
                      {totalsByCurrency[curr].toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                    <span className="text-xs text-primary-foreground/80">{curr}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-2">
            <Link href={`?modal=edit-bank&id=${bank.id}`} scroll={false} onClick={(e) => e.stopPropagation()}>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground">
                <Pencil className="h-4 w-4" />
              </Button>
            </Link>
            <Button variant="ghost" size="icon" className="h-8 w-8 text-primary-foreground hover:bg-primary-foreground/20 hover:text-primary-foreground">
              {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </Button>
          </div>
        </div>
      </CardHeader>
      
      {isExpanded && (
        <CardContent className="p-0 animate-in slide-in-from-top-2 fade-in duration-200">
          {accounts.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground text-sm">
              لا توجد حسابات مضافة في هذا البنك.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {accounts.map((account) => (
                <div key={account.id} className="flex items-center justify-between p-4 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-4">
                    <div className="p-2 bg-secondary rounded-full">
                      <Wallet className="h-4 w-4 text-secondary-foreground" />
                    </div>
                    <div>
                      <p className="font-medium">{account.account_name}</p>
                      {account.account_number && (
                        <p className="text-xs text-muted-foreground mt-1">
                          رقم الحساب: <span className="font-mono">{account.account_number}</span>
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-4 text-left rtl:text-right">
                    <div>
                      <p className="font-bold text-lg dir-ltr">
                        {Number(account.current_balance ?? account.opening_balance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {account.currency}
                      </p>
                      <p className="text-xs text-muted-foreground">الرصيد الحالي</p>
                    </div>
                    <div className="flex gap-1">
                      <Link href={`/accounts/statement?account_id=${account.id}`}>
                        <Button variant="ghost" size="icon" title="كشف حساب" className="h-8 w-8 text-muted-foreground hover:text-primary bg-primary/5">
                          <FileText className="h-4 w-4" />
                        </Button>
                      </Link>
                      <Link href={`?modal=edit-bank-account&id=${account.id}`} scroll={false}>
                        <Button variant="ghost" size="icon" title="تعديل الحساب" className="h-8 w-8 text-muted-foreground hover:text-foreground">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}
