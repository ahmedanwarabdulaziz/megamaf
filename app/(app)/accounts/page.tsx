import { createClient } from "@/lib/supabase/server"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Plus, Landmark, Wallet, Pencil, FileText } from "lucide-react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { AddBankModal } from "@/components/modals/add-bank-modal"
import { AddBankAccountModal } from "@/components/modals/add-bank-account-modal"
import { EditBankModal } from "@/components/modals/edit-bank-modal"
import { EditBankAccountModal } from "@/components/modals/edit-bank-account-modal"
import { BankCard } from "./_components/bank-card"

export default async function AccountsPage() {
  const supabase = await createClient()

  // Fetch banks
  const { data: banks } = await supabase
    .from("banks")
    .select("*")
    .order("created_at", { ascending: true })

  // Fetch bank accounts
  const { data: accounts } = await supabase
    .from("bank_accounts")
    .select("*, banks(name)")
    .order("created_at", { ascending: true })

  // Fetch all transactions to calculate current balance
  const { data: transactions } = await supabase
    .from("bank_transactions")
    .select("bank_account_id, type, amount")

  const safeBanks = banks || []
  const safeAccounts = accounts || []
  const safeTransactions = transactions || []

  // Calculate current balances for all accounts
  const accountsWithBalance = safeAccounts.map(account => {
    const accTxs = safeTransactions.filter(t => t.bank_account_id === account.id)
    const totalDeposits = accTxs.filter(t => t.type === 'deposit').reduce((sum, t) => sum + Number(t.amount), 0)
    const totalWithdrawals = accTxs.filter(t => t.type === 'withdrawal').reduce((sum, t) => sum + Number(t.amount), 0)
    return {
      ...account,
      current_balance: Number(account.opening_balance || 0) + totalDeposits - totalWithdrawals
    }
  })

  // Calculate Grand Totals across all accounts using current_balance
  const grandTotalsByCurrency = accountsWithBalance.reduce((acc, account) => {
    const curr = account.currency || "EGP"
    acc[curr] = (acc[curr] || 0) + account.current_balance
    return acc
  }, {} as Record<string, number>)

  const currencies = Object.keys(grandTotalsByCurrency)

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      <div className="static md:sticky md:top-0 z-20 bg-background/95 backdrop-blur-md pb-4 border-b border-border -mx-4 px-4 -mt-4 pt-4 md:-mx-6 md:px-6 md:-mt-6 md:pt-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">الحسابات البنكية</h1>
          <p className="text-muted-foreground mt-2">
            إدارة البنوك والحسابات الخاصة بالشركة.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/accounts/statement">
            <Button variant="outline" className="bg-background">
              <FileText className="mr-2 h-4 w-4" />
              كشف حساب عام
            </Button>
          </Link>
          <Link href="?modal=add-bank" scroll={false}>
            <Button variant="secondary">
              <Landmark className="mr-2 h-4 w-4" />
              إضافة بنك
            </Button>
          </Link>
          <Link href="?modal=add-bank-account" scroll={false}>
            <Button variant="default">
              <Plus className="mr-2 h-4 w-4" />
              إضافة حساب
            </Button>
          </Link>
        </div>
      </div>

      {/* Grand Totals Section */}
      {currencies.length > 0 && (
        <Card className="bg-primary/5 border-primary/20 -mt-2">
          <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="font-bold text-lg text-primary whitespace-nowrap">إجمالي الأرصدة لجميع البنوك:</div>
            <div className="flex flex-wrap gap-3 w-full">
              {currencies.map(curr => (
                <div key={curr} className="flex items-center gap-2 bg-background px-4 py-2 rounded-lg shadow-sm border border-border">
                  <span className="font-bold text-lg dir-ltr text-foreground">
                    {grandTotalsByCurrency[curr].toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  <span className="text-sm font-medium text-muted-foreground">{curr}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {safeBanks.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed">
          <Landmark className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-medium">لا توجد بنوك بعد</h3>
          <p className="text-muted-foreground mt-2 max-w-sm">
            قم بإضافة بنك جديد أولاً لتتمكن من فتح حسابات بنكية مرتبطة به.
          </p>
          <Link href="?modal=add-bank" scroll={false} className="mt-6">
            <Button>إضافة بنك جديد</Button>
          </Link>
        </Card>
      ) : (
        <div className="grid gap-6">
          {safeBanks.map(bank => (
            <BankCard 
              key={bank.id} 
              bank={bank} 
              accounts={accountsWithBalance.filter(acc => acc.bank_id === bank.id)} 
            />
          ))}
        </div>
      )}

      {/* Include Modals here so they can be triggered by URL */}
      <AddBankModal />
      <AddBankAccountModal banks={safeBanks} />
      <EditBankModal banks={safeBanks} />
      <EditBankAccountModal accounts={safeAccounts} banks={safeBanks} />
    </div>
  )
}
