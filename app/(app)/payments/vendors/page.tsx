import { createClient } from "@/lib/supabase/server"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Truck, CheckCircle2, Clock, ArrowLeft, AlertTriangle,
  Receipt, Calendar, Landmark, Banknote, ArrowRight,
} from "lucide-react"
import { AddPaymentModal } from "@/components/modals/add-payment-modal"
import { PaymentsFilter } from "@/components/ui/payments-filter"
import { PaymentsTabs } from "@/components/ui/payments-tabs"
import Link from "next/link"
import React from "react"

function formatDate(d: string | null) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" })
}
function formatAmount(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default async function VendorPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const resolvedParams = await searchParams
  const activeTab = typeof resolvedParams.tab === "string" ? resolvedParams.tab : "pending"
  const projectId  = typeof resolvedParams.projectId === "string" ? resolvedParams.projectId : ""
  const vendorId   = typeof resolvedParams.vendorId === "string" ? resolvedParams.vendorId : ""

  const defaultMonth = activeTab === "pending" ? "all" : new Date().toISOString().slice(0, 7)
  const monthFilter  = typeof resolvedParams.month === "string" ? resolvedParams.month : defaultMonth

  const supabase = await createClient()

  // ── Pending vendor POs ────────────────────────────────────────────────────
  let pendingPOsQuery = supabase
    .from("vendor_pos")
    .select("id, amount, paid_amount, description, po_date, vendors!inner(id, name)")
    .is("settled_at", null)
    .order("po_date", { ascending: true })

  // ── Paid vendor expenses ───────────────────────────────────────────────────
  let vendorPaymentsQuery = supabase
    .from("expenses")
    .select("id, description, amount, expense_date, payment_type, notes, vendors(id, name), bank_accounts(id, account_name, banks(name))")
    .in("payment_type", ["vendor_payment", "direct"])
    .order("expense_date", { ascending: false })

  if (projectId) {
    pendingPOsQuery    = pendingPOsQuery.eq("project_id", projectId)
    vendorPaymentsQuery = vendorPaymentsQuery.eq("project_id", projectId)
  }
  if (vendorId) {
    pendingPOsQuery    = pendingPOsQuery.eq("vendor_id", vendorId)
    vendorPaymentsQuery = vendorPaymentsQuery.eq("vendor_id", vendorId)
  }
  if (monthFilter && monthFilter !== "all") {
    const [year, month] = monthFilter.split("-")
    const startDate = `${year}-${month}-01`
    const nextMonth = Number(month) === 12 ? 1 : Number(month) + 1
    const nextYear  = Number(month) === 12 ? Number(year) + 1 : Number(year)
    const endDate   = `${nextYear}-${nextMonth.toString().padStart(2, "0")}-01`
    pendingPOsQuery    = pendingPOsQuery.gte("po_date", startDate).lt("po_date", endDate)
    vendorPaymentsQuery = vendorPaymentsQuery.gte("expense_date", startDate).lt("expense_date", endDate)
  }

  const [
    { data: pendingPOsRaw },
    { data: vendorPaymentsRaw },
    { data: bankAccountsRaw },
    { data: employeesList },
    { data: projectsList },
    { data: vendorsList },
  ] = await Promise.all([
    pendingPOsQuery,
    vendorPaymentsQuery,
    supabase.from("bank_accounts").select("id, account_name, banks(name)").order("account_name"),
    supabase.from("employees").select("id, name, job_title").order("name"),
    supabase.from("projects").select("id, name").order("name"),
    supabase.from("vendors").select("id, name, type").order("name"),
  ])

  const safePendingPOs    = pendingPOsRaw    || []
  const safeVendorPayments = vendorPaymentsRaw || []
  const bankAccounts = (bankAccountsRaw || []).map((a: any) => ({
    id: a.id, account_name: a.account_name, bank_name: a.banks?.name ?? "",
  }))

  // ── Group pending POs by vendor ────────────────────────────────────────────
  interface VendorGroup { vendor: { id: string; name: string }; pos: any[]; total: number; totalAmount: number; totalPaid: number }
  const vendorGroupMap = new Map<string, VendorGroup>()
  for (const po of safePendingPOs) {
    const v = po.vendors as any
    if (!v) continue
    if (!vendorGroupMap.has(v.id)) vendorGroupMap.set(v.id, { vendor: v, pos: [], total: 0, totalAmount: 0, totalPaid: 0 })
    const group = vendorGroupMap.get(v.id)!
    const amount = Number(po.amount) || 0
    const paid = Number(po.paid_amount) || 0
    const remaining = amount - paid
    group.pos.push({ ...po, remaining })
    group.total += remaining
    group.totalAmount += amount
    group.totalPaid += paid
  }
  const vendorGroups = Array.from(vendorGroupMap.values()).sort((a, b) => b.total - a.total)

  const pendingPOsTotal       = safePendingPOs.reduce((s, p) => s + (Number(p.amount) - Number(p.paid_amount || 0)), 0)
  const pendingPOsTotalAmount = safePendingPOs.reduce((s, p) => s + (Number(p.amount) || 0), 0)
  const pendingPOsTotalPaid   = safePendingPOs.reduce((s, p) => s + (Number(p.paid_amount) || 0), 0)
  const vendorPaymentsTotal   = safeVendorPayments.reduce((s, e) => s + Number(e.amount), 0)

  const tabs = [
    { key: "pending",  label: "مطالبات معلقة",   badge: safePendingPOs.length },
    { key: "payments", label: "دفعات مسددة",      badge: safeVendorPayments.length },
  ]

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="static md:sticky md:top-0 z-20 bg-background/95 backdrop-blur-md pb-4 border-b border-border -mx-4 px-4 -mt-4 pt-4 md:-mx-6 md:px-6 md:-mt-6 md:pt-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-2">
        <div className="flex items-center gap-3">
          <Link href="/payments">
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
              <ArrowRight className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">مدفوعات الموردين</h1>
            <p className="text-muted-foreground text-sm mt-0.5">مطالبات الموردين، والدفعات المسددة.</p>
          </div>
        </div>
        <AddPaymentModal employees={employeesList || []} vendors={vendorsList || []} bankAccounts={bankAccounts} />
      </div>

      {/* ── Filter ──────────────────────────────────────────────────────────── */}
      <React.Suspense fallback={null}>
        <PaymentsFilter vendors={vendorsList || []} projects={projectsList || []} />
      </React.Suspense>

      {/* ── Tabs ────────────────────────────────────────────────────────────── */}
      <React.Suspense fallback={null}>
        <PaymentsTabs tabs={tabs} />
      </React.Suspense>

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 1 — Pending Vendor POs
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "pending" && (
        <section className="flex flex-col gap-4">
          {/* Section header */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-amber-500" />
              <h2 className="font-semibold text-lg">مطالبات الموردين المعلقة</h2>
            </div>
            {vendorGroups.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-700 border border-amber-500/20">
                  {safePendingPOs.length} مطالبة · {vendorGroups.length} مورد · متبقي: {formatAmount(pendingPOsTotal)} EGP
                </span>
                <span className="text-[11px] text-muted-foreground bg-muted/50 px-2 py-1 rounded-full border border-border/50">
                  إجمالي المطالبات: {formatAmount(pendingPOsTotalAmount)} | إجمالي المدفوع: {formatAmount(pendingPOsTotalPaid)}
                </span>
              </div>
            )}
            <div className="mr-auto" />
            <Link href={`/vendor-pos`}>
              <Button variant="outline" size="sm">
                إدارة المطالبات
                <ArrowLeft className="h-4 w-4 mr-1" />
              </Button>
            </Link>
          </div>

          {vendorGroups.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center p-12 text-center gap-3">
                <div className="h-12 w-12 rounded-full bg-green-500/10 flex items-center justify-center">
                  <CheckCircle2 className="h-6 w-6 text-green-600" />
                </div>
                <p className="font-medium">لا توجد مطالبات موردين معلقة</p>
                <p className="text-sm text-muted-foreground">جميع الفواتير مسددة! ✓</p>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {vendorGroups.map(group => (
                <Card key={group.vendor.id} className="hover:shadow-md transition-all border-amber-500/10 hover:border-amber-500/30">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4 flex-wrap">
                      <div className="p-2.5 rounded-xl bg-amber-500/10 shrink-0">
                        <Truck className="h-5 w-5 text-amber-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-base">{group.vendor.name}</h3>
                          <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border bg-amber-500/10 text-amber-700 border-amber-500/20">
                            <Clock className="h-3 w-3" />
                            {group.pos.length} {group.pos.length === 1 ? "مطالبة" : "مطالبات"} معلقة
                          </span>
                        </div>
                        <div className="mt-2 flex flex-col gap-1">
                          {group.pos.slice(0, 3).map((po: any) => (
                            <div key={po.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Receipt className="h-3 w-3 shrink-0" />
                              <span className="truncate">{po.description}</span>
                              <span className="shrink-0 font-medium text-foreground">{formatAmount(po.remaining)} EGP</span>
                              <span className="shrink-0">· {formatDate(po.po_date)}</span>
                            </div>
                          ))}
                          {group.pos.length > 3 && (
                            <p className="text-xs text-muted-foreground/60 mt-0.5">
                              ... و{group.pos.length - 3} مطالبات أخرى
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-4 shrink-0 mr-auto">
                        <div className="flex flex-col items-end gap-1 text-right">
                          <p className="text-xl font-bold text-amber-600" title="المبلغ المتبقي">{formatAmount(group.total)} <span className="text-xs font-normal text-muted-foreground">EGP</span></p>
                          <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                            <span title="إجمالي المطالبات">إجمالي: {formatAmount(group.totalAmount)}</span>
                            <span className="text-border/50">|</span>
                            <span title="إجمالي المدفوع">مدفوع: {formatAmount(group.totalPaid)}</span>
                          </div>
                        </div>
                        <Link href={`/vendor-pos?vendor_id=${group.vendor.id}`}>
                          <Button variant="outline" size="sm">
                            عرض
                            <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                          </Button>
                        </Link>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          TAB 2 — Vendor Payments (paid)
      ══════════════════════════════════════════════════════════════════════ */}
      {activeTab === "payments" && (
        <section className="flex flex-col gap-4">
          {/* Section header */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-purple-500" />
              <h2 className="font-semibold text-lg">دفعات مسددة للموردين</h2>
            </div>
            {safeVendorPayments.length > 0 && (
              <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-purple-500/10 text-purple-700 border border-purple-500/20">
                {safeVendorPayments.length} دفعة · إجمالي: {formatAmount(vendorPaymentsTotal)} EGP
              </span>
            )}
          </div>

          {safeVendorPayments.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center p-12 text-center gap-3">
                <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center">
                  <Truck className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="font-medium">لا توجد دفعات مسجلة</p>
                <p className="text-sm text-muted-foreground">لم يتم تسجيل أي دفعة لمورد في هذه الفترة.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="flex flex-col gap-3">
              {safeVendorPayments.map((exp: any) => {
                const vendor      = exp.vendors as any
                const bankAccount = exp.bank_accounts as any
                return (
                  <Card key={exp.id} className="hover:shadow-md transition-all">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4 flex-wrap">
                        <div className="p-2.5 rounded-xl shrink-0 bg-purple-500/10">
                          <Truck className="h-5 w-5 text-purple-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-semibold text-base">{exp.description || "دفعة مورد"}</h3>
                            <span className="text-xs font-medium px-2 py-0.5 rounded-full border bg-purple-500/10 text-purple-700 border-purple-500/20">
                              {exp.payment_type === "vendor_payment" ? "دفعة مورد" : "دفعة مباشرة"}
                            </span>
                          </div>
                          {exp.notes && <p className="text-sm text-muted-foreground mt-0.5">{exp.notes}</p>}
                          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
                            {vendor && (
                              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                <Truck className="h-3.5 w-3.5" />{vendor.name}
                              </span>
                            )}
                            {bankAccount && (
                              <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                                <Landmark className="h-3.5 w-3.5" />
                                {bankAccount.banks?.name} — {bankAccount.account_name}
                              </span>
                            )}
                            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                              <Calendar className="h-3.5 w-3.5" />{formatDate(exp.expense_date)}
                            </span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-xl font-bold">{formatAmount(Number(exp.amount))}</p>
                          <p className="text-xs text-muted-foreground uppercase tracking-wider">EGP</p>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
              {/* Total card */}
              <Card className="bg-purple-500/5 border-purple-500/20">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Banknote className="h-5 w-5 text-purple-500" />
                    <span className="font-semibold">إجمالي الدفعات المسددة</span>
                  </div>
                  <span className="text-xl font-bold text-purple-700 dark:text-purple-400">
                    {formatAmount(vendorPaymentsTotal)} EGP
                  </span>
                </CardContent>
              </Card>
            </div>
          )}
        </section>
      )}

      <AddPaymentModal employees={employeesList || []} vendors={vendorsList || []} bankAccounts={bankAccounts} />
    </div>
  )
}
