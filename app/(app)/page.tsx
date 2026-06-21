import { createClient } from "@/lib/supabase/server"
import { getProfile, getEmployeePermissions } from "@/lib/supabase/get-profile"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { FAB } from "@/components/ui/fab"
import { PWAInstallPrompt } from "@/components/ui/pwa-install-prompt"
import { FinanceOverview } from "./_components/finance-overview"
import { ProjectsOverview } from "./_components/projects-overview"
import { PendingCustodiesCard } from "./_components/pending-custodies-card"

export default async function HomePage() {
  const { user, profile, supabase } = await getProfile()

  let canApprove = false
  if (profile?.role === "admin" || profile?.role === "member") {
    canApprove = true
  } else if (profile?.role === "employee" && user) {
    const emp = await getEmployeePermissions(user.id)
    if (emp?.is_super_admin || emp?.can_approve_custodies) {
      canApprove = true
    }
  }

  // Get current month date range
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0]

  // Fetch accounts
  const { data: accounts } = await supabase
    .from("bank_accounts")
    .select("id, account_name, currency")
    .order("created_at", { ascending: true })

  // Fetch transactions for the month
  const { data: transactions } = await supabase
    .from("bank_transactions")
    .select("bank_account_id, type, amount, transaction_date")
    .gte("transaction_date", startOfMonth)
    .lte("transaction_date", endOfMonth)

  // Fetch projects (non-branch)
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name")
    .eq("is_company_branch", false)
    .order("name", { ascending: true })

  // Fetch project funds
  const { data: projectFunds } = await supabase
    .from("project_funds")
    .select("project_id, amount")
    .gte("fund_date", startOfMonth)
    .lte("fund_date", endOfMonth)

  // Fetch project expenses (direct expenses)
  const { data: directExpenses } = await supabase
    .from("expenses")
    .select("project_id, amount")
    .not("project_id", "is", null)
    .gte("expense_date", startOfMonth)
    .lte("expense_date", endOfMonth)

  // Fetch project custodies (funded this month)
  const { data: custodies } = await supabase
    .from("employee_custodies")
    .select("project_id, funded_amount")
    .not("project_id", "is", null)
    .gte("funded_at", startOfMonth)
    .lte("funded_at", endOfMonth)

  // Fetch vendor PO settlements (paid this month)
  const { data: poSettlements } = await supabase
    .from("vendor_po_settlements")
    .select("amount, vendor_pos!inner(project_id), expenses!inner(expense_date)")
    .gte("expenses.expense_date", startOfMonth)
    .lte("expenses.expense_date", endOfMonth)

  // Fetch pending custodies
  const { data: pendingCustodies } = await supabase
    .from("employee_custodies")
    .select(`
      id,
      item,
      amount,
      date,
      employees ( name )
    `)
    .is("approved_at", null)
    .order("date", { ascending: false })

  const safeAccounts = accounts || []
  const safeTransactions = transactions || []
  const safeProjects = projects || []
  const safeProjectFunds = projectFunds || []
  const safePendingCustodies = (pendingCustodies as any[]) || []
  
  const safeProjectExpenses: { project_id: string; amount: number }[] = []

  // Combine direct expenses
  for (const e of directExpenses || []) {
    if (e.project_id) {
      safeProjectExpenses.push({ project_id: e.project_id, amount: Number(e.amount) })
    }
  }

  // Combine funded custodies
  for (const c of custodies || []) {
    if (c.project_id && c.funded_amount) {
      safeProjectExpenses.push({ project_id: c.project_id, amount: Number(c.funded_amount) })
    }
  }

  // Combine vendor PO settlements
  for (const s of poSettlements || []) {
    const vp = s.vendor_pos as any
    const projId = Array.isArray(vp) ? vp[0]?.project_id : vp?.project_id
    if (projId) {
      safeProjectExpenses.push({ project_id: projId, amount: Number(s.amount) })
    }
  }

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">لوحة القيادة</h1>
        <p className="text-muted-foreground mt-2">
          مرحباً بك في نظام الإدارة.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-2">
        <FinanceOverview accounts={safeAccounts} transactions={safeTransactions} />
        <ProjectsOverview projects={safeProjects} funds={safeProjectFunds} expenses={safeProjectExpenses} />
        <PendingCustodiesCard custodies={safePendingCustodies} canApprove={canApprove} />
      </div>

      {/* Only show FAB and PWA install prompt on the home page */}
      <FAB modalTrigger="profile-modal" />
      <PWAInstallPrompt />
    </div>
  )
}
