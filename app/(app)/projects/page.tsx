import { createClient } from "@/lib/supabase/server"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Plus, Building2, FolderKanban, Pencil, Trash2, Calendar,
  Banknote, ShieldCheck, TrendingUp, TrendingDown, User,
  ArrowRight, Wallet, CircleDollarSign, BarChart3, PlusCircle, Clock
} from "lucide-react"
import Link from "next/link"
import { AddProjectModal } from "@/components/modals/add-project-modal"
import { EditProjectModal } from "@/components/modals/edit-project-modal"
import { AddProjectFundModal } from "@/components/modals/add-project-fund-modal"
import { deleteProject } from "./actions"

function formatDate(dateStr: string | null) {
  if (!dateStr) return null
  return new Date(dateStr).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" })
}

function formatMoney(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default async function ProjectsPage() {
  const supabase = await createClient()

  // 1. Projects
  const { data: projects } = await supabase
    .from("projects")
    .select("*")
    .order("is_company_branch", { ascending: false })
    .order("name", { ascending: true })

  const safeProjects = projects || []

  // 2. Project funds — sum per project
  const { data: fundsRaw } = await supabase
    .from("project_funds")
    .select("project_id, amount")

  // 3. Expenses — sum per project (direct payments, advances, vendor payments)
  const { data: expensesRaw } = await supabase
    .from("expenses")
    .select("project_id, amount, payment_type, vendor_id")

  // 3c. Pending POs
  const { data: pendingPOsRaw } = await supabase
    .from("vendor_pos")
    .select("project_id, amount, paid_amount")
    .is("settled_at", null)

  // 3d. Vendor PO settlements (for project-linked vendor payments)
  const { data: poSettlementsRaw } = await supabase
    .from("vendor_po_settlements")
    .select("amount, vendor_pos!inner(project_id)")

  // 3b. Custodies — sum per project (funded = expenses, unpaid = pending)
  const { data: custodiesRaw } = await supabase
    .from("employee_custodies")
    .select("project_id, amount, funded_amount")

  // 5. Legacy balances (opening balances from before the app)
  const { data: legacyBalancesRaw } = await supabase
    .from("project_legacy_balances")
    .select("*")

  // 4. Bank accounts for the fund modal
  const { data: bankAccountsRaw } = await supabase
    .from("bank_accounts")
    .select("id, account_name, banks(name)")
    .order("account_name", { ascending: true })

  const bankAccounts = (bankAccountsRaw || []).map((a: any) => ({
    id: a.id,
    account_name: a.account_name,
    bank_name: a.banks?.name || "بنك",
  }))

  // Build lookup maps
  const fundsMap: Record<string, number> = {}
  for (const f of fundsRaw || []) {
    if (f.project_id) fundsMap[f.project_id] = (fundsMap[f.project_id] || 0) + Number(f.amount)
  }

  const expensesMap: Record<string, number> = {}
  const vendorPaymentsMap: Record<string, number> = {}
  
  // From expenses table (direct expenses linked to a project)
  for (const e of expensesRaw || []) {
    if (e.project_id) {
      const amt = Number(e.amount)
      expensesMap[e.project_id] = (expensesMap[e.project_id] || 0) + amt
    }
  }
  const pendingCustodiesMap: Record<string, number> = {}
  const paidCustodiesMap: Record<string, number> = {}
  
  // From custodies
  for (const c of custodiesRaw || []) {
    if (c.project_id) {
      const funded = Number(c.funded_amount || 0)
      const totalAmt = Number(c.amount || 0)
      expensesMap[c.project_id] = (expensesMap[c.project_id] || 0) + funded
      
      if (funded > 0) {
        paidCustodiesMap[c.project_id] = (paidCustodiesMap[c.project_id] || 0) + funded
      }

      const unpaid = totalAmt - funded
      if (unpaid > 0) {
        pendingCustodiesMap[c.project_id] = (pendingCustodiesMap[c.project_id] || 0) + unpaid
      }
    }
  }
  // From vendor po settlements
  for (const s of poSettlementsRaw || []) {
    const vp = s.vendor_pos as any
    const projId = Array.isArray(vp) ? vp[0]?.project_id : vp?.project_id
    if (projId) {
      const amt = Number(s.amount)
      vendorPaymentsMap[projId] = (vendorPaymentsMap[projId] || 0) + amt
      expensesMap[projId] = (expensesMap[projId] || 0) + amt
    }
  }

  // From legacy balances
  const legacyFundsMap: Record<string, number> = {}
  const legacyPaidCustodiesMap: Record<string, number> = {}
  const legacyVendorPaymentsMap: Record<string, number> = {}

  for (const lb of legacyBalancesRaw || []) {
    const projId = lb.project_id
    if (projId) {
      const legFunds = Number(lb.legacy_funds || 0)
      const legPaidCustodies = Number(lb.legacy_paid_custodies || 0)
      const legVendorPayments = Number(lb.legacy_vendor_payments || 0)

      legacyFundsMap[projId] = legFunds
      legacyPaidCustodiesMap[projId] = legPaidCustodies
      legacyVendorPaymentsMap[projId] = legVendorPayments

      fundsMap[projId] = (fundsMap[projId] || 0) + legFunds
      paidCustodiesMap[projId] = (paidCustodiesMap[projId] || 0) + legPaidCustodies
      vendorPaymentsMap[projId] = (vendorPaymentsMap[projId] || 0) + legVendorPayments
      expensesMap[projId] = (expensesMap[projId] || 0) + legPaidCustodies + legVendorPayments
    }
  }

  const pendingPOsMap: Record<string, number> = {}
  for (const po of pendingPOsRaw || []) {
    if (po.project_id) {
      pendingPOsMap[po.project_id] = (pendingPOsMap[po.project_id] || 0) + (Number(po.amount) - Number(po.paid_amount || 0))
    }
  }

  // Stats
  const totalCount = safeProjects.length
  const branchesCount = safeProjects.filter(p => p.is_company_branch).length
  const activeCount = safeProjects.filter(p => p.status === "active" && !p.is_company_branch).length
  const completedCount = safeProjects.filter(p => p.status === "completed" && !p.is_company_branch).length

  // Financial totals across all projects (non-branch)
  const allProjectIds = safeProjects.filter(p => !p.is_company_branch).map(p => p.id)
  const totalFunds = allProjectIds.reduce((s, id) => s + (fundsMap[id] || 0), 0)
  const totalExpenses = allProjectIds.reduce((s, id) => s + (expensesMap[id] || 0), 0)
  const totalProfit = totalFunds - totalExpenses
  
  const totalVendorPayments = allProjectIds.reduce((s, id) => s + (vendorPaymentsMap[id] || 0), 0)
  const totalPendingPOs = allProjectIds.reduce((s, id) => s + (pendingPOsMap[id] || 0), 0)
  const totalPendingCustodies = allProjectIds.reduce((s, id) => s + (pendingCustodiesMap[id] || 0), 0)

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      {/* Header */}
      <div className="static md:sticky md:top-0 z-20 bg-background/95 backdrop-blur-md pb-4 border-b border-border -mx-4 px-4 -mt-4 pt-4 md:-mx-6 md:px-6 md:-mt-6 md:pt-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-2">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">المشروعات والفروع</h1>
          <p className="text-muted-foreground mt-2">إدارة المشروعات، تمويلها، ومصروفاتها.</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link href="?modal=add-project-fund" scroll={false}>
            <Button variant="outline">
              <TrendingUp className="mr-2 h-4 w-4 text-emerald-500" />
              إضافة تمويل
            </Button>
          </Link>
          <Link href="?modal=add-project" scroll={false}>
            <Button variant="default">
              <Plus className="mr-2 h-4 w-4" />
              إضافة مشروع
            </Button>
          </Link>
        </div>
      </div>

      {/* Count Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">الإجمالي</p>
            <p className="text-3xl font-bold">{totalCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">فروع الشركة</p>
            <p className="text-3xl font-bold text-primary">{branchesCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">مشروعات نشطة</p>
            <p className="text-3xl font-bold text-green-600">{activeCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">مشروعات مكتملة</p>
            <p className="text-3xl font-bold text-muted-foreground">{completedCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Financial Overview */}
      {allProjectIds.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card className="border-emerald-500/30 bg-emerald-500/5">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-emerald-500/20 flex items-center justify-center shrink-0">
                <Wallet className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">إجمالي التمويل</p>
                <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">{formatMoney(totalFunds)}</p>
                <p className="text-xs text-muted-foreground">EGP</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-rose-500/30 bg-rose-500/5">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-rose-500/20 flex items-center justify-center shrink-0">
                <CircleDollarSign className="h-5 w-5 text-rose-600" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">إجمالي المصروفات</p>
                <p className="text-lg font-bold text-rose-700 dark:text-rose-400">{formatMoney(totalExpenses)}</p>
                <p className="text-xs text-muted-foreground">EGP</p>
              </div>
            </CardContent>
          </Card>
          <Card className={`${totalProfit >= 0 ? "border-blue-500/30 bg-blue-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${totalProfit >= 0 ? "bg-blue-500/20" : "bg-amber-500/20"}`}>
                <BarChart3 className={`h-5 w-5 ${totalProfit >= 0 ? "text-blue-600" : "text-amber-600"}`} />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">صافي الربح</p>
                <p className={`text-lg font-bold ${totalProfit >= 0 ? "text-blue-700 dark:text-blue-400" : "text-amber-700 dark:text-amber-400"}`}>
                  {totalProfit >= 0 ? "+" : ""}{formatMoney(totalProfit)}
                </p>
                <p className="text-xs text-muted-foreground">EGP</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-purple-500/30 bg-purple-500/5">
            <CardContent className="p-4 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-lg bg-purple-500/20 flex items-center justify-center shrink-0">
                  <User className="h-5 w-5 text-purple-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">مطالبات معلقة (موردين)</p>
                  <p className="text-lg font-bold text-purple-700 dark:text-purple-400">{formatMoney(totalPendingPOs)} <span className="text-xs font-normal text-muted-foreground">EGP</span></p>
                </div>
              </div>
              {totalPendingCustodies > 0 && (
                <div className="pt-2 border-t border-purple-500/10">
                  <p className="text-xs text-muted-foreground">عهد معلقة (موظفين): <span className="font-semibold text-purple-700 dark:text-purple-400">{formatMoney(totalPendingCustodies)} EGP</span></p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Projects List */}
      {safeProjects.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed">
          <FolderKanban className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-medium">لا توجد مشروعات بعد</h3>
          <p className="text-muted-foreground mt-2 max-w-sm">
            قم بإضافة مشروع لبدء إدارة بياناته وميزانيته.
          </p>
          <Link href="?modal=add-project" scroll={false} className="mt-6">
            <Button>إضافة مشروع جديد</Button>
          </Link>
        </Card>
      ) : (
        <div className="grid gap-4">
          {safeProjects.map(project => {
            const isBranch = project.is_company_branch
            const funds = fundsMap[project.id] || 0
            const expenses = expensesMap[project.id] || 0
            const vPayments = vendorPaymentsMap[project.id] || 0
            const pendingPOs = pendingPOsMap[project.id] || 0
            const pendingCustodies = pendingCustodiesMap[project.id] || 0
            const paidCustodies = paidCustodiesMap[project.id] || 0
            
            const legFunds = legacyFundsMap[project.id] || 0
            const legPaidCustodies = legacyPaidCustodiesMap[project.id] || 0
            const legVendorPayments = legacyVendorPaymentsMap[project.id] || 0
            
            const profit = funds - expenses

            let statusColor = "bg-muted text-muted-foreground border-border"
            let statusText = "غير محدد"
            if (project.status === "active") {
              statusColor = "bg-green-500/10 text-green-600 border-green-500/20"
              statusText = "نشط"
            } else if (project.status === "completed") {
              statusColor = "bg-blue-500/10 text-blue-600 border-blue-500/20"
              statusText = "مكتمل"
            } else if (project.status === "on_hold") {
              statusColor = "bg-amber-500/10 text-amber-600 border-amber-500/20"
              statusText = "قيد الانتظار"
            } else if (project.status === "cancelled") {
              statusColor = "bg-red-500/10 text-red-600 border-red-500/20"
              statusText = "ملغى"
            }

            return (
              <Card key={project.id} className="hover:shadow-md transition-all hover:border-primary/50 group">
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    {/* Clickable project header — now goes to detail page */}
                    <Link href={isBranch ? `/payments?projectId=${project.id}` : `/projects/${project.id}`} className="flex flex-1 items-start gap-4 group/link min-w-0" title={isBranch ? "عرض مصروفات الفرع" : "عرض تفاصيل المشروع"}>
                      {/* Icon */}
                      <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 transition-colors ${isBranch ? "bg-primary/10 text-primary group-hover/link:bg-primary/20" : "bg-muted text-muted-foreground group-hover/link:bg-primary/10 group-hover/link:text-primary"}`}>
                        {isBranch ? <Building2 className="h-5 w-5" /> : <FolderKanban className="h-5 w-5" />}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-base group-hover/link:text-primary transition-colors">{project.name}</h3>
                          <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground">
                            {project.code || "بدون كود"}
                          </span>
                          {!isBranch && (
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${statusColor}`}>
                              {statusText}
                            </span>
                          )}
                          {isBranch && (
                            <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border bg-primary/10 text-primary border-primary/20">
                              <ShieldCheck className="h-3 w-3" /> فرع شركة (دائم)
                            </span>
                          )}
                        </div>

                        {/* Owner */}
                        {project.owner_name && (
                          <p className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
                            <User className="h-3.5 w-3.5 shrink-0" />
                            صاحب المشروع: <span className="font-medium text-foreground">{project.owner_name}</span>
                          </p>
                        )}

                        {project.description && (
                          <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
                            {project.description}
                          </p>
                        )}

                        {/* Date & Budget row */}
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                          {project.start_date && (
                            <span className="flex items-center gap-1 text-sm text-muted-foreground">
                              <Calendar className="h-3.5 w-3.5" /> تبدأ: {formatDate(project.start_date)}
                            </span>
                          )}
                          {project.end_date && (
                            <span className="flex items-center gap-1 text-sm text-muted-foreground">
                              <Calendar className="h-3.5 w-3.5" /> تنتهي: {formatDate(project.end_date)}
                            </span>
                          )}
                          {project.budget && (
                            <span className="flex items-center gap-1 text-sm font-medium">
                              <Banknote className="h-3.5 w-3.5 text-primary" />
                              ميزانية: {Number(project.budget).toLocaleString("en-US")} EGP
                            </span>
                          )}
                        </div>

                        {/* Financial mini-summary — only for non-branch projects */}
                        {!isBranch && (
                          <div className="flex flex-col gap-2 mt-3 pt-3 border-t border-border/60">
                            <div className="flex flex-wrap gap-3">
                              <span className="flex items-center gap-1.5 text-sm">
                                <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                                <span className="text-muted-foreground">تمويل:</span>
                                <span className="font-semibold text-emerald-700 dark:text-emerald-400">{formatMoney(funds)}</span>
                              </span>
                              <span className="text-muted-foreground/40 hidden sm:inline">|</span>
                              <span className="flex items-center gap-1.5 text-sm">
                                <TrendingDown className="h-3.5 w-3.5 text-rose-500" />
                                <span className="text-muted-foreground">مصروفات:</span>
                                <span className="font-semibold text-rose-700 dark:text-rose-400">{formatMoney(expenses)}</span>
                              </span>
                              <span className="text-muted-foreground/40 hidden sm:inline">|</span>
                              <span className="flex items-center gap-1.5 text-sm">
                                <BarChart3 className={`h-3.5 w-3.5 ${profit >= 0 ? "text-blue-500" : "text-amber-500"}`} />
                                <span className="text-muted-foreground">صافي:</span>
                                <span className={`font-bold ${profit >= 0 ? "text-blue-700 dark:text-blue-400" : "text-amber-700 dark:text-amber-400"}`}>
                                  {profit >= 0 ? "+" : ""}{formatMoney(profit)}
                                </span>
                              </span>
                            </div>
                            
                            {(legFunds > 0 || legVendorPayments > 0 || legPaidCustodies > 0) && (
                              <div className="flex flex-wrap gap-3 bg-indigo-500/10 rounded px-2 py-1.5 border border-indigo-500/20 mt-1">
                                {legFunds > 0 && (
                                  <span className="flex items-center gap-1.5 text-xs">
                                    <span className="text-indigo-600 dark:text-indigo-400 font-medium">تمويل سابق:</span>
                                    <span className="font-bold text-indigo-700 dark:text-indigo-300">{formatMoney(legFunds)}</span>
                                  </span>
                                )}
                                {legFunds > 0 && (legVendorPayments > 0 || legPaidCustodies > 0) && (
                                  <span className="text-indigo-500/40 hidden sm:inline">|</span>
                                )}
                                {legVendorPayments > 0 && (
                                  <span className="flex items-center gap-1.5 text-xs">
                                    <span className="text-indigo-600 dark:text-indigo-400 font-medium">موردين سابقاً:</span>
                                    <span className="font-bold text-indigo-700 dark:text-indigo-300">{formatMoney(legVendorPayments)}</span>
                                  </span>
                                )}
                                {legVendorPayments > 0 && legPaidCustodies > 0 && (
                                  <span className="text-indigo-500/40 hidden sm:inline">|</span>
                                )}
                                {legPaidCustodies > 0 && (
                                  <span className="flex items-center gap-1.5 text-xs">
                                    <span className="text-indigo-600 dark:text-indigo-400 font-medium">عهد مصروفة سابقاً:</span>
                                    <span className="font-bold text-indigo-700 dark:text-indigo-300">{formatMoney(legPaidCustodies)}</span>
                                  </span>
                                )}
                              </div>
                            )}

                            {(vPayments > 0 || pendingPOs > 0 || pendingCustodies > 0 || paidCustodies > 0) && (
                              <div className="flex flex-wrap gap-3 bg-muted/40 rounded px-2 py-1.5 border border-border/50">
                                {vPayments > 0 && (
                                  <span className="flex items-center gap-1.5 text-xs">
                                    <User className="h-3 w-3 text-purple-500" />
                                    <span className="text-muted-foreground">مدفوعات الموردين:</span>
                                    <span className="font-medium">{formatMoney(vPayments)}</span>
                                  </span>
                                )}
                                {vPayments > 0 && (pendingPOs > 0 || pendingCustodies > 0 || paidCustodies > 0) && (
                                  <span className="text-muted-foreground/40 hidden sm:inline">|</span>
                                )}
                                {pendingPOs > 0 && (
                                  <span className="flex items-center gap-1.5 text-xs">
                                    <Clock className="h-3 w-3 text-amber-500" />
                                    <span className="text-muted-foreground">مطالبات موردين:</span>
                                    <span className="font-medium text-amber-600">{formatMoney(pendingPOs)}</span>
                                  </span>
                                )}
                                {pendingPOs > 0 && (pendingCustodies > 0 || paidCustodies > 0) && (
                                  <span className="text-muted-foreground/40 hidden sm:inline">|</span>
                                )}
                                {paidCustodies > 0 && (
                                  <span className="flex items-center gap-1.5 text-xs">
                                    <TrendingDown className="h-3 w-3 text-blue-500" />
                                    <span className="text-muted-foreground">عهد مسددة:</span>
                                    <span className="font-medium text-blue-600">{formatMoney(paidCustodies)}</span>
                                  </span>
                                )}
                                {paidCustodies > 0 && pendingCustodies > 0 && (
                                  <span className="text-muted-foreground/40 hidden sm:inline">|</span>
                                )}
                                {pendingCustodies > 0 && (
                                  <span className="flex items-center gap-1.5 text-xs">
                                    <Clock className="h-3 w-3 text-rose-500" />
                                    <span className="text-muted-foreground">عهد معلقة:</span>
                                    <span className="font-medium text-rose-600">{formatMoney(pendingCustodies)}</span>
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </Link>

                    {/* Action buttons */}
                    <div className="flex flex-col gap-1 shrink-0">
                      {/* Add fund — only for non-branch projects */}
                      {!isBranch && (
                        <Link href={`?modal=add-project-fund&fund_project=${project.id}`} scroll={false}>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-emerald-600 hover:bg-emerald-500/10" title="إضافة تمويل">
                            <PlusCircle className="h-4 w-4" />
                          </Button>
                        </Link>
                      )}

                      {/* Detail / expenses link */}
                      <Link href={isBranch ? `/payments?projectId=${project.id}` : `/projects/${project.id}`} scroll={false}>
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="عرض التفاصيل">
                          <ArrowRight className="h-4 w-4" />
                        </Button>
                      </Link>

                      {/* Edit */}
                      <Link href={`?modal=edit-project&edit_project=${project.id}`} scroll={false}>
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="تعديل">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </Link>

                      {/* Delete */}
                      {!isBranch && (
                        <form action={async () => { "use server"; await deleteProject(project.id) }}>
                          <Button type="submit" variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" title="حذف">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </form>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Modals */}
      <AddProjectModal />
      <EditProjectModal projects={safeProjects} />
      <AddProjectFundModal projects={safeProjects.filter(p => !p.is_company_branch)} bankAccounts={bankAccounts} />
    </div>
  )
}
