import { createClient } from "@/lib/supabase/server"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  ArrowRight, Building2, FolderKanban, Calendar, Banknote,
  TrendingUp, TrendingDown, BarChart3, User, ShieldCheck,
  Wallet, CircleDollarSign, Plus, Trash2, PlusCircle,
  Receipt, FileText, Clock, Landmark
} from "lucide-react"
import Link from "next/link"
import { notFound } from "next/navigation"
import { AddProjectFundModal } from "@/components/modals/add-project-fund-modal"
import { EditProjectModal } from "@/components/modals/edit-project-modal"
import { deleteProjectFund } from "../actions"

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return "—"
  return new Date(dateStr).toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" })
}

function formatMoney(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  // Fetch the project
  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .single()

  if (projectError || !project) notFound()

  // Fetch all projects (for edit modal)
  const { data: allProjects } = await supabase
    .from("projects")
    .select("*")
    .order("name", { ascending: true })

  // Fetch fund injections for this project
  const { data: fundsRaw } = await supabase
    .from("project_funds")
    .select("*, bank_accounts(account_name, banks(name))")
    .eq("project_id", id)
    .order("fund_date", { ascending: false })

  const funds = fundsRaw || []
  const totalFunds = funds.reduce((s, f) => s + Number(f.amount), 0)

  // Fetch expenses for this project (direct payments, advances, vendor payments)
  const { data: expensesRaw } = await supabase
    .from("expenses")
    .select("id, amount, description, created_at, payment_type, employees(name), vendors(name)")
    .eq("project_id", id)
    .order("created_at", { ascending: false })
    .limit(20)

  const expenses = expensesRaw || []

  // Funded custodies for this project (custody withdrawals)
  const { data: custodiesRaw } = await supabase
    .from("employee_custodies")
    .select("id, item, funded_amount, date, employees(name)")
    .eq("project_id", id)
    .gt("funded_amount", 0)
    .order("date", { ascending: false })
    .limit(20)

  const custodies = custodiesRaw || []

  // Total expenses (all, not just the first 20): expenses table
  const { data: expensesTotalRaw } = await supabase
    .from("expenses")
    .select("amount")
    .eq("project_id", id)

  // Total funded custodies (all)
  const { data: custodiesAllRaw } = await supabase
    .from("employee_custodies")
    .select("funded_amount")
    .eq("project_id", id)
    .gt("funded_amount", 0)

  const totalExpenses =
    (expensesTotalRaw || []).reduce((s, e) => s + Number(e.amount), 0) +
    (custodiesAllRaw || []).reduce((s, c) => s + Number(c.funded_amount), 0)
  const profit = totalFunds - totalExpenses

  // Bank accounts for the fund modal
  const { data: bankAccountsRaw } = await supabase
    .from("bank_accounts")
    .select("id, account_name, banks(name)")
    .order("account_name", { ascending: true })

  const bankAccounts = (bankAccountsRaw || []).map((a: any) => ({
    id: a.id,
    account_name: a.account_name,
    bank_name: a.banks?.name || "بنك",
  }))

  // Status label
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

  const PAYMENT_TYPE_LABEL: Record<string, string> = {
    custody: "عهدة",
    employee_advance: "سلفة موظف",
    vendor_payment: "دفعة مورد",
    direct: "دفعة مباشرة",
  }

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">

      {/* Header */}
      <div className="static md:sticky md:top-0 z-20 bg-background/95 backdrop-blur-md pb-4 border-b border-border -mx-4 px-4 -mt-4 pt-4 md:-mx-6 md:px-6 md:-mt-6 md:pt-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-2">
        <div className="flex items-center gap-3">
          <Link href="/projects">
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
              <span className="text-sm font-medium px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground">
                {project.code}
              </span>
              {project.is_company_branch ? (
                <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border bg-primary/10 text-primary border-primary/20">
                  <ShieldCheck className="h-3 w-3" /> فرع شركة
                </span>
              ) : (
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${statusColor}`}>
                  {statusText}
                </span>
              )}
            </div>
            {project.owner_name && (
              <p className="flex items-center gap-1 text-sm text-muted-foreground mt-1">
                <User className="h-3.5 w-3.5" />
                صاحب المشروع: <span className="font-semibold text-foreground mr-1">{project.owner_name}</span>
              </p>
            )}
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link href={`/payments?projectId=${project.id}`}>
            <Button variant="outline" size="sm">
              <Receipt className="mr-2 h-4 w-4" />
              المصروفات
            </Button>
          </Link>
          <Link href={`?modal=add-project-fund&fund_project=${project.id}`} scroll={false}>
            <Button variant="outline" size="sm" className="border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10">
              <PlusCircle className="mr-2 h-4 w-4" />
              إضافة تمويل
            </Button>
          </Link>
          <Link href={`?modal=edit-project&edit_project=${project.id}`} scroll={false}>
            <Button variant="default" size="sm">
              تعديل المشروع
            </Button>
          </Link>
        </div>
      </div>

      {/* Financial Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-emerald-500/30 bg-gradient-to-br from-emerald-500/10 to-emerald-500/5">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-emerald-500/20 flex items-center justify-center shrink-0">
              <Wallet className="h-6 w-6 text-emerald-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">إجمالي التمويل</p>
              <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400 mt-0.5">{formatMoney(totalFunds)}</p>
              <p className="text-xs text-muted-foreground">{funds.length} دفعة تمويل</p>
            </div>
          </CardContent>
        </Card>

        <Card className="border-rose-500/30 bg-gradient-to-br from-rose-500/10 to-rose-500/5">
          <CardContent className="p-5 flex items-center gap-4">
            <div className="h-12 w-12 rounded-xl bg-rose-500/20 flex items-center justify-center shrink-0">
              <CircleDollarSign className="h-6 w-6 text-rose-600" />
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">إجمالي المصروفات</p>
              <p className="text-2xl font-bold text-rose-700 dark:text-rose-400 mt-0.5">{formatMoney(totalExpenses)}</p>
              <p className="text-xs text-muted-foreground">{expensesTotalRaw?.length || 0} عملية صرف</p>
            </div>
          </CardContent>
        </Card>

        <Card className={`border-${profit >= 0 ? "blue" : "amber"}-500/30 bg-gradient-to-br from-${profit >= 0 ? "blue" : "amber"}-500/10 to-${profit >= 0 ? "blue" : "amber"}-500/5`}>
          <CardContent className="p-5 flex items-center gap-4">
            <div className={`h-12 w-12 rounded-xl ${profit >= 0 ? "bg-blue-500/20" : "bg-amber-500/20"} flex items-center justify-center shrink-0`}>
              {profit >= 0
                ? <TrendingUp className="h-6 w-6 text-blue-600" />
                : <TrendingDown className="h-6 w-6 text-amber-600" />
              }
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                {profit >= 0 ? "صافي الربح" : "العجز"}
              </p>
              <p className={`text-2xl font-bold mt-0.5 ${profit >= 0 ? "text-blue-700 dark:text-blue-400" : "text-amber-700 dark:text-amber-400"}`}>
                {profit >= 0 ? "+" : ""}{formatMoney(profit)}
              </p>
              <p className="text-xs text-muted-foreground">EGP</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Budget progress if budget is set */}
      {project.budget && (
        <Card>
          <CardContent className="p-4">
            <div className="flex justify-between items-center mb-2">
              <p className="text-sm font-medium flex items-center gap-1.5">
                <Banknote className="h-4 w-4 text-primary" />
                الميزانية المقدرة: <span className="font-bold">{formatMoney(Number(project.budget))} EGP</span>
              </p>
              <p className="text-sm text-muted-foreground">
                {Math.min(100, Math.round((totalExpenses / Number(project.budget)) * 100))}% مُنفَّذ
              </p>
            </div>
            <div className="w-full bg-muted rounded-full h-2.5">
              <div
                className={`h-2.5 rounded-full transition-all ${totalExpenses > Number(project.budget) ? "bg-rose-500" : "bg-primary"}`}
                style={{ width: `${Math.min(100, (totalExpenses / Number(project.budget)) * 100)}%` }}
              />
            </div>
            {totalExpenses > Number(project.budget) && (
              <p className="text-xs text-rose-600 mt-1">⚠️ تجاوزت المصروفات الميزانية المقدرة بـ {formatMoney(totalExpenses - Number(project.budget))} EGP</p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Info row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {project.start_date && (
          <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/30">
            <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">تاريخ البدء</p>
              <p className="text-sm font-medium">{formatDate(project.start_date)}</p>
            </div>
          </div>
        )}
        {project.end_date && (
          <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/30">
            <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">تاريخ الانتهاء</p>
              <p className="text-sm font-medium">{formatDate(project.end_date)}</p>
            </div>
          </div>
        )}
        {project.description && (
          <div className="flex items-center gap-2 p-3 rounded-lg border bg-muted/30 col-span-2">
            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
            <div>
              <p className="text-xs text-muted-foreground">الوصف</p>
              <p className="text-sm font-medium">{project.description}</p>
            </div>
          </div>
        )}
      </div>

      {/* Funds History */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Wallet className="h-5 w-5 text-emerald-500" />
            سجل التمويل
          </CardTitle>
          <Link href={`?modal=add-project-fund&fund_project=${project.id}`} scroll={false}>
            <Button variant="outline" size="sm">
              <Plus className="h-4 w-4 mr-1" />
              إضافة دفعة
            </Button>
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {funds.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center px-4">
              <Wallet className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">لا يوجد تمويل مسجّل بعد لهذا المشروع.</p>
              <Link href={`?modal=add-project-fund&fund_project=${project.id}`} scroll={false} className="mt-3">
                <Button size="sm" variant="outline">
                  <Plus className="h-4 w-4 mr-1" />
                  إضافة أول دفعة
                </Button>
              </Link>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {funds.map((fund, i) => {
                const bankName = (fund as any).bank_accounts?.banks?.name || ""
                const accountName = (fund as any).bank_accounts?.account_name || ""
                const bankLabel = bankName && accountName ? `${bankName} — ${accountName}` : accountName || bankName || null
                return (
                <div key={fund.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/40 transition-colors">
                  <div className="h-8 w-8 rounded-full bg-emerald-500/15 flex items-center justify-center shrink-0 text-xs font-bold text-emerald-700">
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-emerald-700 dark:text-emerald-400">
                      + {formatMoney(Number(fund.amount))} EGP
                    </p>
                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Calendar className="h-3 w-3" />
                        {formatDate(fund.fund_date)}
                      </span>
                      {bankLabel && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Landmark className="h-3 w-3" />
                          {bankLabel}
                        </span>
                      )}
                      {fund.note && (
                        <span className="text-xs text-muted-foreground truncate">{fund.note}</span>
                      )}
                    </div>
                  </div>
                  <form action={async () => {
                    "use server"
                    await deleteProjectFund(fund.id, project.id)
                  }}>
                    <Button type="submit" variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:bg-destructive/10" title="حذف">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </form>
                </div>
              )})}
              {/* Totals row */}
              <div className="flex items-center gap-4 px-4 py-3 bg-emerald-500/5 border-t-2 border-emerald-500/20">
                <div className="h-8 w-8 rounded-full bg-emerald-500/25 flex items-center justify-center shrink-0">
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-emerald-700 dark:text-emerald-400">
                    الإجمالي: {formatMoney(totalFunds)} EGP
                  </p>
                  <p className="text-xs text-muted-foreground">{funds.length} دفعة</p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Expenses */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <CircleDollarSign className="h-5 w-5 text-rose-500" />
            آخر المصروفات
          </CardTitle>
          <Link href={`/payments?projectId=${project.id}`}>
            <Button variant="outline" size="sm">
              عرض الكل
              <ArrowRight className="h-4 w-4 mr-1" />
            </Button>
          </Link>
        </CardHeader>
        <CardContent className="p-0">
          {expenses.length === 0 && custodies.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center px-4">
              <Receipt className="h-10 w-10 text-muted-foreground/30 mb-3" />
              <p className="text-sm text-muted-foreground">لا توجد مصروفات مسجّلة لهذا المشروع بعد.</p>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {/* Funded custodies */}
              {custodies.map(custody => (
                <div key={`custody-${custody.id}`} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/40 transition-colors">
                  <div className="h-8 w-8 rounded-full bg-rose-500/15 flex items-center justify-center shrink-0">
                    <TrendingDown className="h-4 w-4 text-rose-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium truncate">{(custody as any).item || "عهدة"}</p>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 border border-amber-500/20">عهدة</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      {(custody as any).employees?.name && (
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <User className="h-3 w-3" />{(custody as any).employees.name}
                        </span>
                      )}
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="h-3 w-3" />
                        {formatDate((custody as any).date)}
                      </span>
                    </div>
                  </div>
                  <p className="font-semibold text-rose-700 dark:text-rose-400 shrink-0 text-sm">
                    − {formatMoney(Number((custody as any).funded_amount))} EGP
                  </p>
                </div>
              ))}
              {/* Direct / advance / vendor expenses */}
              {expenses.map(expense => {
                const partyName = (expense as any).employees?.name || (expense as any).vendors?.name || null
                return (
                  <div key={expense.id} className="flex items-center gap-4 px-4 py-3 hover:bg-muted/40 transition-colors">
                    <div className="h-8 w-8 rounded-full bg-rose-500/15 flex items-center justify-center shrink-0">
                      <TrendingDown className="h-4 w-4 text-rose-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{expense.description || PAYMENT_TYPE_LABEL[expense.payment_type] || "صرف"}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        {partyName && (
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <User className="h-3 w-3" />{partyName}
                          </span>
                        )}
                        <span className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Clock className="h-3 w-3" />
                          {formatDate(expense.created_at)}
                        </span>
                      </div>
                    </div>
                    <p className="font-semibold text-rose-700 dark:text-rose-400 shrink-0 text-sm">
                      − {formatMoney(Number(expense.amount))} EGP
                    </p>
                  </div>
                )
              })}
              {/* Totals row */}
              <div className="flex items-center gap-4 px-4 py-3 bg-rose-500/5 border-t-2 border-rose-500/20">
                <div className="h-8 w-8 rounded-full bg-rose-500/25 flex items-center justify-center shrink-0">
                  <TrendingDown className="h-4 w-4 text-rose-600" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-bold text-rose-700 dark:text-rose-400">
                    الإجمالي: {formatMoney(totalExpenses)} EGP
                  </p>
                  <p className="text-xs text-muted-foreground">{(expensesTotalRaw?.length || 0) + custodies.length} عملية (آخر 20 من كل نوع)</p>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Profit / Loss Summary */}
      <Card className={`border-2 ${profit >= 0 ? "border-blue-500/30 bg-blue-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
        <CardContent className="p-5">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3">
              <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${profit >= 0 ? "bg-blue-500/20" : "bg-amber-500/20"}`}>
                <BarChart3 className={`h-6 w-6 ${profit >= 0 ? "text-blue-600" : "text-amber-600"}`} />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  {profit >= 0 ? "💰 المشروع محقق ربح" : "⚠️ المشروع في عجز"}
                </p>
                <p className={`text-3xl font-bold ${profit >= 0 ? "text-blue-700 dark:text-blue-400" : "text-amber-700 dark:text-amber-400"}`}>
                  {profit >= 0 ? "+" : ""}{formatMoney(profit)} EGP
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-1 text-sm text-right">
              <span className="text-muted-foreground">التمويل: <strong className="text-emerald-600">{formatMoney(totalFunds)}</strong></span>
              <span className="text-muted-foreground">المصروفات: <strong className="text-rose-600">{formatMoney(totalExpenses)}</strong></span>
              <span className="text-muted-foreground">الصافي: <strong className={profit >= 0 ? "text-blue-600" : "text-amber-600"}>{profit >= 0 ? "+" : ""}{formatMoney(profit)}</strong></span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Modals */}
      <AddProjectFundModal projects={(allProjects || []).filter(p => !p.is_company_branch)} bankAccounts={bankAccounts} />
      <EditProjectModal projects={allProjects || []} />
    </div>
  )
}
