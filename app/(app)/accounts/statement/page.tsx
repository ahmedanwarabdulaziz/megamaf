import { createClient } from "@/lib/supabase/server"
import { Card, CardContent } from "@/components/ui/card"
import { ChevronRight, Download, Filter } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { redirect } from "next/navigation"
import { DeleteTransactionButton } from "./_components/delete-button"

interface StatementPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

export default async function StatementPage(props: StatementPageProps) {
  const searchParams = await props.searchParams
  const accountId = searchParams.account_id as string | undefined
  const supabase = await createClient()

  // Time filters
  const currentMonth = new Date().getMonth() + 1
  const currentYear = new Date().getFullYear()
  
  const monthRaw = searchParams.month as string | undefined
  const isAllMonths = monthRaw === 'all'
  const monthParam = isAllMonths ? 1 : (monthRaw ? parseInt(monthRaw) : currentMonth)
  const yearParam = searchParams.year ? parseInt(searchParams.year as string) : currentYear

  const filterStartDate = isAllMonths 
    ? new Date(yearParam, 0, 1).getTime() 
    : new Date(yearParam, monthParam - 1, 1).getTime()
    
  const filterEndDate = isAllMonths 
    ? new Date(yearParam, 11, 31, 23, 59, 59, 999).getTime() 
    : new Date(yearParam, monthParam, 0, 23, 59, 59, 999).getTime()

  // Fetch Accounts
  const { data: accountsData } = await supabase
    .from("bank_accounts")
    .select("*, banks(name)")

  const safeAccounts = accountsData || []
  
  // Verify account if id is provided
  let selectedAccount = null
  if (accountId) {
    selectedAccount = safeAccounts.find(a => a.id === accountId)
    if (!selectedAccount) {
      redirect("/accounts") // Fallback if invalid
    }
  }

  // Fetch Transactions safely without deep nested joins that might throw relation errors
  let query = supabase
    .from("bank_transactions")
    .select("*")
    .order("transaction_date", { ascending: true }) // Oldest first for running balance

  if (accountId) {
    query = query.eq("bank_account_id", accountId)
  }

  const { data: transactionsData, error: txError } = await query
  if (txError) {
    console.error("Statement fetch error:", txError)
  }
  const safeTransactions = transactionsData || []

  // Build ALL rows chronologically
  const allRows: any[] = []
  
  if (selectedAccount) {
    let currentBalance = Number(selectedAccount.opening_balance || 0)
    
    // True opening balance
    allRows.push({
      id: "opening",
      date: new Date(selectedAccount.created_at).toISOString(),
      description: "الرصيد الافتتاحي (أول المدة)",
      deposit: currentBalance,
      withdrawal: 0,
      running_balance: currentBalance,
      type: "opening",
      currency: selectedAccount.currency
    })

    safeTransactions.forEach(tx => {
      const amount = Number(tx.amount)
      if (tx.type === 'deposit') currentBalance += amount
      if (tx.type === 'withdrawal') currentBalance -= amount

      allRows.push({
        id: tx.id,
        date: tx.transaction_date,
        description: tx.description || "-",
        deposit: tx.type === 'deposit' ? amount : 0,
        withdrawal: tx.type === 'withdrawal' ? amount : 0,
        running_balance: currentBalance,
        type: tx.type,
        currency: selectedAccount.currency
      })
    })
  } else {
    // Global statement
    safeTransactions.forEach(tx => {
      const amount = Number(tx.amount)
      const acc = safeAccounts.find(a => a.id === tx.bank_account_id)
      allRows.push({
        id: tx.id,
        date: tx.transaction_date,
        description: tx.description || "-",
        deposit: tx.type === 'deposit' ? amount : 0,
        withdrawal: tx.type === 'withdrawal' ? amount : 0,
        running_balance: null, 
        type: tx.type,
        bankName: acc?.banks?.name,
        accountName: acc?.account_name,
        currency: acc?.currency
      })
    })
  }

  // Filter rows based on selected month/year
  const displayRows: any[] = []
  let broughtForwardRow: any = null

  allRows.forEach(row => {
    const rowTime = new Date(row.date).getTime()
    if (rowTime < filterStartDate) {
      if (selectedAccount) {
        broughtForwardRow = {
          id: "brought_forward",
          date: new Date(yearParam, monthParam - 1, 1).toISOString(),
          description: "رصيد مرحّل (سابق)",
          deposit: 0,
          withdrawal: 0,
          running_balance: row.running_balance,
          type: "opening",
          currency: row.currency
        }
      }
    } else if (rowTime <= filterEndDate) {
      displayRows.push(row)
    }
  })

  if (broughtForwardRow) {
    displayRows.unshift(broughtForwardRow)
  }

  const months = Array.from({ length: 12 }, (_, i) => i + 1)
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i)

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6">
      <div className="static md:sticky md:top-0 z-20 bg-background/95 backdrop-blur-md pb-4 border-b border-border -mx-4 px-4 -mt-4 pt-4 md:-mx-6 md:px-6 md:-mt-6 md:pt-6 flex flex-col gap-4 mb-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/accounts" className="hover:text-foreground flex items-center transition-colors">
              الحسابات
            </Link>
            <ChevronRight className="h-4 w-4" />
            <span className="text-foreground font-medium">كشف حساب</span>
          </div>
          
          <form method="GET" className="flex items-center gap-2">
            {accountId && <input type="hidden" name="account_id" value={accountId} />}
            <div className="flex items-center bg-muted/50 rounded-md border px-2 py-1 gap-2">
              <Filter className="h-4 w-4 text-muted-foreground" />
              <select name="month" defaultValue={monthRaw || currentMonth} className="h-7 rounded bg-transparent text-sm font-medium focus:outline-none cursor-pointer">
                <option value="all">كل الأشهر</option>
                {months.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <span className="text-muted-foreground">/</span>
              <select name="year" defaultValue={yearParam} className="h-7 rounded bg-transparent text-sm font-medium focus:outline-none cursor-pointer">
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
            <Button type="submit" variant="secondary" size="sm" className="h-9">تصفية</Button>
          </form>
        </div>
        
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {selectedAccount ? `كشف حساب: ${selectedAccount.banks?.name} - ${selectedAccount.account_name}` : "كشف الحساب العام"}
            </h1>
            <p className="text-muted-foreground mt-2">
              {selectedAccount ? `العملة: ${selectedAccount.currency} | الفترة: ${isAllMonths ? 'كل الأشهر' : monthParam}/${yearParam}` : `جميع المعاملات على مستوى الشركة | الفترة: ${isAllMonths ? 'كل الأشهر' : monthParam}/${yearParam}`}
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline">
              <Download className="mr-2 h-4 w-4" />
              تصدير PDF
            </Button>
          </div>
        </div>
      </div>

      <Card className="overflow-hidden border-border shadow-sm">
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-muted/50 text-muted-foreground border-b border-border">
                <tr>
                  <th className="px-4 py-3 font-medium whitespace-nowrap">التاريخ</th>
                  {!selectedAccount && <th className="px-4 py-3 font-medium whitespace-nowrap">البنك / الحساب</th>}
                  <th className="px-4 py-3 font-medium">البيان</th>
                  <th className="px-4 py-3 font-medium text-green-600 whitespace-nowrap">إيداع / تحصيل (+)</th>
                  <th className="px-4 py-3 font-medium text-red-600 whitespace-nowrap">سحب (-)</th>
                  {selectedAccount ? (
                    <th className="px-4 py-3 font-medium whitespace-nowrap">الرصيد التراكمي</th>
                  ) : (
                    <th className="px-4 py-3 font-medium whitespace-nowrap">العملة</th>
                  )}
                  <th className="px-2 py-3 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {displayRows.length === 0 ? (
                  <tr>
                    <td colSpan={selectedAccount ? 6 : 7} className="px-4 py-12 text-center text-muted-foreground">
                      لا توجد حركات مالية مسجلة في هذا الشهر.
                    </td>
                  </tr>
                ) : (
                  displayRows.map((row, idx) => (
                    <tr key={row.id + idx} className="hover:bg-muted/20 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap">
                        {new Date(row.date).toLocaleDateString('en-GB')}
                      </td>
                      
                      {!selectedAccount && (
                        <td className="px-4 py-3 whitespace-nowrap font-medium text-primary">
                          {row.bankName} - {row.accountName}
                        </td>
                      )}
                      
                      <td className="px-4 py-3 min-w-[200px]">
                        {row.type === 'opening' ? (
                          <span className="font-semibold text-primary">{row.description}</span>
                        ) : (
                          row.description
                        )}
                      </td>
                      
                      <td className="px-4 py-3 dir-ltr text-right text-green-600 font-medium">
                        {row.deposit > 0 ? `+ ${row.deposit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "-"}
                      </td>
                      
                      <td className="px-4 py-3 dir-ltr text-right text-red-600 font-medium">
                        {row.withdrawal > 0 ? `- ${row.withdrawal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "-"}
                      </td>
                      
                      {selectedAccount ? (
                        <td className="px-4 py-3 dir-ltr text-right font-bold bg-primary/5">
                          {row.running_balance !== null ? row.running_balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-"}
                        </td>
                      ) : (
                        <td className="px-4 py-3 whitespace-nowrap text-muted-foreground font-medium">
                          {row.currency}
                        </td>
                      )}
                      
                      <td className="px-2 py-3 text-left">
                        {row.id !== 'opening' && row.id !== 'brought_forward' && (
                          <DeleteTransactionButton id={row.id} />
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
