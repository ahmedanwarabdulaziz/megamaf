import { createClient } from "@/lib/supabase/server"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Truck, Users, Clock, CheckCircle2, TrendingDown,
  ArrowLeft, Wallet, CircleDollarSign, AlertTriangle,
  Banknote, BarChart3, Receipt,
} from "lucide-react"
import { AddPaymentModal } from "@/components/modals/add-payment-modal"
import { PaymentsFilter } from "@/components/ui/payments-filter"
import Link from "next/link"
import React from "react"

function formatAmount(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default async function PaymentsHubPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const resolvedParams = await searchParams
  const projectId  = typeof resolvedParams.projectId  === "string" ? resolvedParams.projectId  : ""
  const employeeId = typeof resolvedParams.employeeId === "string" ? resolvedParams.employeeId : ""

  const defaultMonth = new Date().toISOString().slice(0, 7)
  const monthFilter  = typeof resolvedParams.month === "string" ? resolvedParams.month : defaultMonth

  const supabase = await createClient()

  // Apply date range
  let startDate: string | null = null
  let endDate: string | null = null
  if (monthFilter && monthFilter !== "all") {
    const [year, month] = monthFilter.split("-")
    startDate = `${year}-${month}-01`
    const nm = Number(month) === 12 ? 1 : Number(month) + 1
    const ny = Number(month) === 12 ? Number(year) + 1 : Number(year)
    endDate = `${ny}-${nm.toString().padStart(2, "0")}-01`
  }

  // ── All stats in one parallel batch ───────────────────────────────────────
  const buildDateFilter = <T extends { gte: (col: string, v: string) => T; lt: (col: string, v: string) => T }>(
    q: T, col: string
  ): T => {
    if (startDate) q = q.gte(col, startDate)
    if (endDate)   q = q.lt(col, endDate)
    return q
  }

  let pendingCustodiesQ = supabase
    .from("employee_custodies")
    .select("id, amount, funded_amount")
    .not("approved_at", "is", null)
    .is("funded_at", null)
  if (employeeId) pendingCustodiesQ = pendingCustodiesQ.eq("employee_id", employeeId) as any
  if (projectId)  pendingCustodiesQ = pendingCustodiesQ.eq("project_id", projectId) as any
  pendingCustodiesQ = buildDateFilter(pendingCustodiesQ as any, "date")

  let paidCustodiesQ = supabase
    .from("employee_custodies")
    .select("id, amount")
    .not("funded_at", "is", null)
  if (employeeId) paidCustodiesQ = paidCustodiesQ.eq("employee_id", employeeId) as any
  if (projectId)  paidCustodiesQ = paidCustodiesQ.eq("project_id", projectId) as any
  paidCustodiesQ = buildDateFilter(paidCustodiesQ as any, "funded_at")

  let employeeAdvancesQ = supabase
    .from("expenses")
    .select("id, amount")
    .in("payment_type", ["employee_advance", "direct"])
  if (employeeId) employeeAdvancesQ = employeeAdvancesQ.eq("employee_id", employeeId) as any
  if (projectId)  employeeAdvancesQ = employeeAdvancesQ.eq("project_id", projectId) as any
  employeeAdvancesQ = buildDateFilter(employeeAdvancesQ as any, "expense_date")

  let pendingPOsQ = supabase
    .from("vendor_pos")
    .select("id, amount, paid_amount")
    .is("settled_at", null)
  if (projectId) pendingPOsQ = pendingPOsQ.eq("project_id", projectId) as any
  pendingPOsQ = buildDateFilter(pendingPOsQ as any, "po_date")

  let vendorPaymentsQ = supabase
    .from("expenses")
    .select("id, amount")
    .in("payment_type", ["vendor_payment"])
  if (projectId) vendorPaymentsQ = vendorPaymentsQ.eq("project_id", projectId) as any
  vendorPaymentsQ = buildDateFilter(vendorPaymentsQ as any, "expense_date")

  const [
    { data: pendingCustodiesRaw },
    { data: paidCustodiesRaw },
    { data: employeeAdvancesRaw },
    { data: pendingPOsRaw },
    { data: vendorPaymentsRaw },
    { data: bankAccountsRaw },
    { data: employeesList },
    { data: projectsList },
    { data: vendorsList },
  ] = await Promise.all([
    pendingCustodiesQ,
    paidCustodiesQ,
    employeeAdvancesQ,
    pendingPOsQ,
    vendorPaymentsQ,
    supabase.from("bank_accounts").select("id, account_name, banks(name)").order("account_name"),
    supabase.from("employees").select("id, name, job_title").order("name"),
    supabase.from("projects").select("id, name").order("name"),
    supabase.from("vendors").select("id, name, type").order("name"),
  ])

  const bankAccounts = (bankAccountsRaw || []).map((a: any) => ({
    id: a.id, account_name: a.account_name, bank_name: a.banks?.name ?? "",
  }))

  // ── Compute totals ─────────────────────────────────────────────────────────
  const pendingCustodiesTotal = (pendingCustodiesRaw || []).reduce(
    (s, c) => s + (Number(c.amount) - Number(c.funded_amount || 0)), 0
  )
  const paidCustodiesTotal    = (paidCustodiesRaw    || []).reduce((s, c) => s + Number(c.amount), 0)
  const employeeAdvancesTotal = (employeeAdvancesRaw || []).reduce((s, e) => s + Number(e.amount), 0)
  const pendingPOsTotal       = (pendingPOsRaw       || []).reduce(
    (s, p) => s + (Number(p.amount) - Number(p.paid_amount || 0)), 0
  )
  const vendorPaymentsTotal   = (vendorPaymentsRaw   || []).reduce((s, e) => s + Number(e.amount), 0)

  const totalPending = pendingCustodiesTotal + pendingPOsTotal
  const totalPaid    = paidCustodiesTotal + employeeAdvancesTotal + vendorPaymentsTotal

  // Preserve filters in sub-page links
  const filterParams = new URLSearchParams()
  if (projectId)  filterParams.set("projectId", projectId)
  if (employeeId) filterParams.set("employeeId", employeeId)
  if (monthFilter) filterParams.set("month", monthFilter)
  const filterString = filterParams.toString() ? `?${filterParams.toString()}` : ""

  const hasUrgent = pendingCustodiesTotal > 0 || pendingPOsTotal > 0

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="static md:sticky md:top-0 z-20 bg-background/95 backdrop-blur-md pb-4 border-b border-border -mx-4 px-4 -mt-4 pt-4 md:-mx-6 md:px-6 md:-mt-6 md:pt-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-2">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">المصروفات</h1>
          <p className="text-muted-foreground mt-1">نظرة شاملة على كافة المدفوعات والمطالبات.</p>
        </div>
        <AddPaymentModal employees={employeesList || []} vendors={vendorsList || []} bankAccounts={bankAccounts} />
      </div>

      {/* ── Filter ──────────────────────────────────────────────────────────── */}
      <React.Suspense fallback={null}>
        <PaymentsFilter employees={employeesList || []} projects={projectsList || []} />
      </React.Suspense>

      {/* ── Urgent alert banner ──────────────────────────────────────────────── */}
      {hasUrgent && (
        <div className="flex items-center gap-3 p-3 rounded-xl border border-amber-500/30 bg-amber-500/5">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
          <div className="flex flex-wrap gap-x-4 gap-y-1 flex-1 text-sm">
            {pendingCustodiesTotal > 0 && (
              <span>
                <span className="text-muted-foreground">عهد موظفين معلقة: </span>
                <strong className="text-amber-700">{formatAmount(pendingCustodiesTotal)} EGP</strong>
              </span>
            )}
            {pendingPOsTotal > 0 && (
              <span>
                <span className="text-muted-foreground">مطالبات موردين معلقة: </span>
                <strong className="text-amber-700">{formatAmount(pendingPOsTotal)} EGP</strong>
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Summary stat cards ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Clock className="h-4 w-4 text-amber-600" />
              <p className="text-xs font-medium text-muted-foreground">عهد معلقة</p>
            </div>
            <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">{formatAmount(pendingCustodiesTotal)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{(pendingCustodiesRaw || []).length} بند</p>
          </CardContent>
        </Card>

        <Card className="border-green-500/30 bg-green-500/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <p className="text-xs font-medium text-muted-foreground">عهد مصروفة</p>
            </div>
            <p className="text-2xl font-bold text-green-700 dark:text-green-400">{formatAmount(paidCustodiesTotal)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{(paidCustodiesRaw || []).length} عهدة</p>
          </CardContent>
        </Card>

        <Card className="border-blue-500/30 bg-blue-500/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Users className="h-4 w-4 text-blue-600" />
              <p className="text-xs font-medium text-muted-foreground">سلف الموظفين</p>
            </div>
            <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">{formatAmount(employeeAdvancesTotal)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{(employeeAdvancesRaw || []).length} سلفة</p>
          </CardContent>
        </Card>

        <Card className="border-rose-500/30 bg-rose-500/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Truck className="h-4 w-4 text-rose-600" />
              <p className="text-xs font-medium text-muted-foreground">مطالبات معلقة</p>
            </div>
            <p className="text-2xl font-bold text-rose-700 dark:text-rose-400">{formatAmount(pendingPOsTotal)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{(pendingPOsRaw || []).length} مطالبة</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Financial overview ───────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card className="border-rose-500/20">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-rose-500/15 flex items-center justify-center shrink-0">
              <CircleDollarSign className="h-5 w-5 text-rose-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">إجمالي المعلق</p>
              <p className="text-lg font-bold text-rose-700 dark:text-rose-400">{formatAmount(totalPending)}</p>
              <p className="text-xs text-muted-foreground">EGP</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-green-500/20">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-green-500/15 flex items-center justify-center shrink-0">
              <Wallet className="h-5 w-5 text-green-600" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">إجمالي المدفوع</p>
              <p className="text-lg font-bold text-green-700 dark:text-green-400">{formatAmount(totalPaid)}</p>
              <p className="text-xs text-muted-foreground">EGP</p>
            </div>
          </CardContent>
        </Card>
        <Card className="border-border">
          <CardContent className="p-4 flex items-center gap-3">
            <div className="h-10 w-10 rounded-xl bg-muted flex items-center justify-center shrink-0">
              <BarChart3 className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">الإجمالي الكلي</p>
              <p className="text-lg font-bold">{formatAmount(totalPending + totalPaid)}</p>
              <p className="text-xs text-muted-foreground">EGP</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Navigation cards ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        {/* Employee Payments Card */}
        <Link href={`/payments/employees${filterString}`} className="block group">
          <Card className="h-full hover:shadow-lg transition-all duration-200 border-blue-500/20 hover:border-blue-500/50 bg-gradient-to-br from-blue-500/5 to-transparent group-hover:from-blue-500/10 cursor-pointer">
            <CardContent className="p-6 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-xl bg-blue-500/15 flex items-center justify-center">
                    <Users className="h-6 w-6 text-blue-600" />
                  </div>
                  <div>
                    <h2 className="font-bold text-lg text-blue-800 dark:text-blue-300">مدفوعات الموظفين</h2>
                    <p className="text-sm text-muted-foreground">عهد، سلف، وتسبيقات</p>
                  </div>
                </div>
                <ArrowLeft className="h-5 w-5 text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <p className="text-xs text-muted-foreground">عهد معلقة</p>
                  <p className="text-base font-bold text-amber-700">{formatAmount(pendingCustodiesTotal)}</p>
                  <p className="text-xs text-muted-foreground">{(pendingCustodiesRaw || []).length} بند</p>
                </div>
                <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                  <p className="text-xs text-muted-foreground">سلف وتسبيقات</p>
                  <p className="text-base font-bold text-blue-700">{formatAmount(employeeAdvancesTotal)}</p>
                  <p className="text-xs text-muted-foreground">{(employeeAdvancesRaw || []).length} سلفة</p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-border/50">
                <span className="text-sm text-muted-foreground">إجمالي الدفعات المصروفة</span>
                <span className="font-bold text-green-700">{formatAmount(paidCustodiesTotal + employeeAdvancesTotal)} EGP</span>
              </div>
            </CardContent>
          </Card>
        </Link>

        {/* Vendor Payments Card */}
        <Link href={`/payments/vendors${filterString}`} className="block group">
          <Card className="h-full hover:shadow-lg transition-all duration-200 border-purple-500/20 hover:border-purple-500/50 bg-gradient-to-br from-purple-500/5 to-transparent group-hover:from-purple-500/10 cursor-pointer">
            <CardContent className="p-6 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-xl bg-purple-500/15 flex items-center justify-center">
                    <Truck className="h-6 w-6 text-purple-600" />
                  </div>
                  <div>
                    <h2 className="font-bold text-lg text-purple-800 dark:text-purple-300">مدفوعات الموردين</h2>
                    <p className="text-sm text-muted-foreground">مطالبات ودفعات المقاولين</p>
                  </div>
                </div>
                <ArrowLeft className="h-5 w-5 text-purple-500 opacity-0 group-hover:opacity-100 transition-opacity" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <p className="text-xs text-muted-foreground">مطالبات معلقة</p>
                  <p className="text-base font-bold text-amber-700">{formatAmount(pendingPOsTotal)}</p>
                  <p className="text-xs text-muted-foreground">{(pendingPOsRaw || []).length} مطالبة</p>
                </div>
                <div className="p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                  <p className="text-xs text-muted-foreground">دفعات مسددة</p>
                  <p className="text-base font-bold text-purple-700">{formatAmount(vendorPaymentsTotal)}</p>
                  <p className="text-xs text-muted-foreground">{(vendorPaymentsRaw || []).length} دفعة</p>
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-border/50">
                <span className="text-sm text-muted-foreground">إجمالي ما تم سداده</span>
                <span className="font-bold text-green-700">{formatAmount(vendorPaymentsTotal)} EGP</span>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

    </div>
  )
}
