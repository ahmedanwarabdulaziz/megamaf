import { createClient } from "@/lib/supabase/server"
import { Card, CardContent } from "@/components/ui/card"
import {
  Banknote, BadgeCheck, User,
  Calendar, Clock, Package, AlertTriangle,
  Receipt, CheckCircle2, ArrowRight, Landmark,
  Users, Truck,
} from "lucide-react"
import { AddPaymentModal } from "@/components/modals/add-payment-modal"
import { CustodyDetailDialog } from "@/components/ui/custody-detail-dialog"
import { PaidCustodyDetailDialog } from "@/components/ui/paid-custody-detail-dialog"
import { PaymentsFilter } from "@/components/ui/payments-filter"
import { Modal } from "@/components/ui/modal"
import Link from "next/link"

function formatDate(d: string | null) {
  if (!d) return "—"
  return new Date(d).toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" })
}
function formatAmount(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const TYPE_LABEL: Record<string, string> = {
  custody:          "عهدة",
  employee_advance: "سلفة موظف",
  vendor_payment:   "دفعة مورد",
  direct:           "دفعة مباشرة",
}

interface EmployeeCustodyGroup {
  employee: { id: string; name: string; job_title: string | null }
  custodies: {
    id: string; item: string; amount: number
    date: string | null; approved_at: string | null; notes: string | null
  }[]
  total: number
}

interface VendorPOGroup {
  vendor: { id: string; name: string }
  pos: {
    id: string; description: string; amount: number; po_date: string | null
  }[]
  total: number
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}) {
  const resolvedSearchParams = await searchParams
  const employeeId = typeof resolvedSearchParams.employeeId === "string" ? resolvedSearchParams.employeeId : ""
  const projectId = typeof resolvedSearchParams.projectId === "string" ? resolvedSearchParams.projectId : ""

  const supabase = await createClient()

  // 1. Approved + unfunded = waiting to be paid
  let pendingQuery = supabase
    .from("employee_custodies")
    .select(`
      id, item, amount, funded_amount, date, approved_at, notes,
      employees!inner(id, name, job_title)
    `)
    .not("approved_at", "is", null)
    .is("funded_at", null)
    .order("approved_at", { ascending: true })

  // 2. Funded custodies — show as completed payments with their source reference
  let paidQuery = supabase
    .from("employee_custodies")
    .select(`
      id, item, amount, date, approved_at, funded_at, bank_account_id,
      employees!inner(id, name, job_title),
      bank_accounts(id, account_name, banks(name)),
      settled_by_expense_id,
      settling_expense:expenses!settled_by_expense_id(
        id, description, amount, expense_date, payment_type,
        bank_accounts(id, account_name, banks(name))
      )
    `)
    .not("funded_at", "is", null)
    .order("funded_at", { ascending: false })

  // 3. Manual advance payments and vendor payments
  let advanceQuery = supabase
    .from("expenses")
    .select(`
      id, description, amount, expense_date, payment_type, notes,
      employees(id, name),
      vendors(id, name),
      bank_accounts(id, account_name, banks(name))
    `)
    .in("payment_type", ["employee_advance", "vendor_payment", "direct"])
    .order("expense_date", { ascending: false })

  // 4. Pending Vendor POs
  let pendingVendorPOsQuery = supabase
    .from("vendor_pos")
    .select(`
      id, amount, paid_amount, description, po_date,
      vendors!inner(id, name)
    `)
    .is("settled_at", null)
    .order("po_date", { ascending: true })

  if (employeeId) {
    pendingQuery = pendingQuery.eq("employee_id", employeeId)
    paidQuery = paidQuery.eq("employee_id", employeeId)
    advanceQuery = advanceQuery.eq("employee_id", employeeId)
  }
  if (projectId) {
    pendingQuery = pendingQuery.eq("project_id", projectId)
    paidQuery = paidQuery.eq("project_id", projectId)
    advanceQuery = advanceQuery.eq("project_id", projectId)
    pendingVendorPOsQuery = pendingVendorPOsQuery.eq("project_id", projectId)
  }

  const defaultMonth = new Date().toISOString().slice(0, 7) // "YYYY-MM"
  const monthFilter = typeof resolvedSearchParams.month === "string" ? resolvedSearchParams.month : defaultMonth
  
  if (monthFilter && monthFilter !== "all") {
    const [year, month] = monthFilter.split("-")
    const startDate = `${year}-${month}-01`
    const nextMonth = Number(month) === 12 ? 1 : Number(month) + 1
    const nextYear = Number(month) === 12 ? Number(year) + 1 : Number(year)
    const endDate = `${nextYear}-${nextMonth.toString().padStart(2, "0")}-01`

    pendingQuery = pendingQuery.gte("date", startDate).lt("date", endDate)
    paidQuery = paidQuery.gte("funded_at", startDate).lt("funded_at", endDate)
    advanceQuery = advanceQuery.gte("expense_date", startDate).lt("expense_date", endDate)
    pendingVendorPOsQuery = pendingVendorPOsQuery.gte("po_date", startDate).lt("po_date", endDate)
  }

  const [
    { data: pendingCustodies },
    { data: paidCustodies },
    { data: advancePayments },
    { data: pendingVendorPOsRaw },
    { data: bankAccountsRaw },
    { data: employeesList },
    { data: projectsList },
    { data: vendorsList },
  ] = await Promise.all([
    pendingQuery,
    paidQuery,
    advanceQuery,
    pendingVendorPOsQuery,
    supabase.from("bank_accounts").select("id, account_name, banks(name)").order("account_name"),
    supabase.from("employees").select("id, name, job_title").order("name"),
    supabase.from("projects").select("id, name").order("name"),
    supabase.from("vendors").select("id, name, type").order("name"),
  ])

  const safePending  = pendingCustodies || []
  const safePaid     = paidCustodies    || []
  const safeAdvances = advancePayments  || []
  const safePendingVendorPOs = pendingVendorPOsRaw || []
  const bankAccounts = (bankAccountsRaw || []).map((a: any) => ({
    id: a.id, account_name: a.account_name, bank_name: a.banks?.name ?? "",
  }))
  const safeVendors  = vendorsList || []

  // ── Group pending custodies by employee ────────────────────────────────────
  const groupMap = new Map<string, EmployeeCustodyGroup>()
  for (const c of safePending) {
    const emp = c.employees as any
    if (!emp) continue
    if (!groupMap.has(emp.id)) {
      groupMap.set(emp.id, {
        employee: { id: emp.id, name: emp.name, job_title: emp.job_title },
        custodies: [],
        total: 0,
      })
    }
    const group = groupMap.get(emp.id)!
    const remaining = Number(c.amount) - Number(c.funded_amount || 0)
    group.custodies.push({
      id: c.id,
      item: c.item,
      amount: remaining,
      date: c.date,
      approved_at: c.approved_at,
      notes: (c as any).notes ?? null,
    })
    group.total += remaining
  }
  const employeeGroups = Array.from(groupMap.values())
    .sort((a, b) => b.total - a.total) // highest total first

  // ── Group pending vendor POs by vendor ─────────────────────────────────────
  const vendorGroupMap = new Map<string, VendorPOGroup>()
  for (const po of safePendingVendorPOs) {
    const v = po.vendors as any
    if (!v) continue
    if (!vendorGroupMap.has(v.id)) {
      vendorGroupMap.set(v.id, { vendor: v, pos: [], total: 0 })
    }
    const group = vendorGroupMap.get(v.id)!
    const remaining = Number(po.amount) - Number(po.paid_amount || 0)
    group.pos.push({
      id: po.id, description: po.description, amount: remaining, po_date: po.po_date
    })
    group.total += remaining
  }
  const vendorPendingGroups = Array.from(vendorGroupMap.values())
    .sort((a, b) => b.total - a.total)

  const custodyPendingTotal = safePending.reduce((s, c) => s + (Number(c.amount) - Number(c.funded_amount || 0)), 0)
  const vendorPendingTotal  = safePendingVendorPOs.reduce((s, p) => s + (Number(p.amount) - Number(p.paid_amount || 0)), 0)
  const custodyPaidTotal    = safePaid.reduce((s, c) => s + Number(c.amount), 0)
  const advanceTotal        = safeAdvances.reduce((s, e) => s + Number(e.amount), 0)

  const employeeAdvances = safeAdvances.filter(a => a.payment_type === "employee_advance" || (a.payment_type === "direct" && !a.vendors))
  const vendorAdvances = safeAdvances.filter(a => a.payment_type === "vendor_payment" || (a.payment_type === "direct" && !!a.vendors))

  const employeeAdvanceTotal = employeeAdvances.reduce((s, e) => s + Number(e.amount), 0)
  const vendorAdvanceTotal = vendorAdvances.reduce((s, e) => s + Number(e.amount), 0)

  // ── Calculate remaining balance of displayed advances ──────────────────────
  const advanceIds = safeAdvances.map(a => a.id)
  const advanceSettledMap = new Map<string, number>()
  let advanceSettledTotal = 0

  if (advanceIds.length > 0) {
    const { data: settledCustodies } = await supabase
      .from("employee_custodies")
      .select("amount, settled_by_expense_id")
      .in("settled_by_expense_id", advanceIds)

    for (const c of (settledCustodies || [])) {
      const eid = c.settled_by_expense_id
      if (eid) {
        const amt = Number(c.amount)
        advanceSettledMap.set(eid, (advanceSettledMap.get(eid) || 0) + amt)
        advanceSettledTotal += amt
      }
    }
  }
  const advanceRemainingTotal = advanceTotal - advanceSettledTotal

  // Prepare links for modals while preserving search params
  const currentParams = new URLSearchParams()
  if (employeeId) currentParams.set("employeeId", employeeId)
  if (projectId) currentParams.set("projectId", projectId)
  if (monthFilter) currentParams.set("month", monthFilter)
  
  const paidCustodiesLink = `?${new URLSearchParams({ ...Object.fromEntries(currentParams), modal: "paid-custodies" }).toString()}`
  const employeeAdvancesLink = `?${new URLSearchParams({ ...Object.fromEntries(currentParams), modal: "employee-advances" }).toString()}`
  const vendorAdvancesLink = `?${new URLSearchParams({ ...Object.fromEntries(currentParams), modal: "vendor-advances" }).toString()}`
  const vendorPendingLink = `?${new URLSearchParams({ ...Object.fromEntries(currentParams), modal: "vendor-pending" }).toString()}`

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="static md:sticky md:top-0 z-20 bg-background/95 backdrop-blur-md pb-4 border-b border-border -mx-4 px-4 -mt-4 pt-4 md:-mx-6 md:px-6 md:-mt-6 md:pt-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-2">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">المصروفات</h1>
          <p className="text-muted-foreground mt-1">صرف العهد المعتمدة وإضافة سلف وتسبيقات.</p>
        </div>
        <div className="flex flex-col sm:flex-row items-end sm:items-center gap-4">
          <PaymentsFilter employees={employeesList || []} projects={projectsList || []} />
          <div className="flex flex-wrap items-center justify-end gap-2">
            {custodyPendingTotal > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs">
                <Clock className="h-3.5 w-3.5 text-amber-600" />
                <span className="text-muted-foreground">عهد معلقة</span>
                <span className="font-bold text-amber-600">{formatAmount(custodyPendingTotal)} EGP</span>
              </div>
            )}
            {vendorPendingTotal > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs">
                <Truck className="h-3.5 w-3.5 text-amber-600" />
                <span className="text-muted-foreground">مطالبات معلقة</span>
                <span className="font-bold text-amber-600">{formatAmount(vendorPendingTotal)} EGP</span>
              </div>
            )}
            {(custodyPaidTotal + advanceTotal) > 0 && (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-green-500/10 border border-green-500/20 text-xs">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
                <span className="text-muted-foreground">تم صرفه</span>
                <span className="font-bold text-green-700">{formatAmount(custodyPaidTotal + advanceTotal)} EGP</span>
              </div>
            )}
            <AddPaymentModal
              employees={employeesList || []}
              vendors={safeVendors}
              bankAccounts={bankAccounts}
            />
          </div>
        </div>
      </div>

      {/* ── Section 1: Pending custodies — grouped by employee ───────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <Clock className="h-4 w-4 text-amber-600" />
          <h2 className="font-semibold text-sm">عهد معتمدة — تنتظر الصرف</h2>
          {employeeGroups.length > 0 && (
            <span className="mr-auto text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/20">
              {safePending.length} بند · {employeeGroups.length} موظف · {formatAmount(custodyPendingTotal)} EGP
            </span>
          )}
        </div>

        {employeeGroups.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex items-center justify-center gap-2 p-6 text-center">
              <CheckCircle2 className="h-4 w-4 text-green-600" />
              <p className="text-sm text-muted-foreground">لا توجد عهد معلقة — كل شيء تم صرفه ✓</p>
            </CardContent>
          </Card>
        ) : (
          <>
            {bankAccounts.length === 0 && (
              <Card className="border-amber-500/30 bg-amber-500/5">
                <CardContent className="flex items-center gap-3 p-4">
                  <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0" />
                  <p className="text-sm text-amber-700">لا توجد حسابات بنكية. أضف حساباً من صفحة الحسابات أولاً.</p>
                </CardContent>
              </Card>
            )}

            {/* Info notice: payment only via إضافة دفعة */}
            <div className="flex items-center gap-2 text-xs px-3 py-2 rounded-lg border border-blue-500/20 bg-blue-500/5 text-blue-600">
              <Banknote className="h-3.5 w-3.5 shrink-0" />
              لصرف العهد استخدم زر <span className="font-bold mx-1">«إضافة دفعة»</span> واختر الموظف — ستتم تسوية عهوده تلقائياً
            </div>

            {/* Per-employee custody summary cards */}
            {employeeGroups.map(group => (
              <Card
                key={group.employee.id}
                className="hover:shadow-md transition-all border-amber-500/10 hover:border-amber-500/30"
              >
                <CardContent className="p-4">
                  <div className="flex items-center gap-4 flex-wrap">

                    {/* Avatar / icon */}
                    <div className="p-2.5 rounded-xl bg-amber-500/10 shrink-0">
                      <Users className="h-5 w-5 text-amber-600" />
                    </div>

                    {/* Employee info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-base">{group.employee.name}</h3>
                        {group.employee.job_title && (
                          <span className="text-xs text-muted-foreground">— {group.employee.job_title}</span>
                        )}
                        <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border bg-amber-500/10 text-amber-700 border-amber-500/20">
                          <Clock className="h-3 w-3" />
                          {group.custodies.length} {group.custodies.length === 1 ? "بند" : "بنود"} معلقة
                        </span>
                      </div>

                      {/* Mini custody list preview (up to 3) */}
                      <div className="mt-2 flex flex-col gap-1">
                        {group.custodies.slice(0, 3).map(c => (
                          <div key={c.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Package className="h-3 w-3 shrink-0" />
                            <span className="truncate">{c.item}</span>
                            <span className="shrink-0 font-medium text-foreground">{formatAmount(c.amount)} EGP</span>
                            <span className="shrink-0">· {formatDate(c.date)}</span>
                            <span className="shrink-0 flex items-center gap-0.5 text-green-600">
                              <BadgeCheck className="h-3 w-3" />معتمدة
                            </span>
                          </div>
                        ))}
                        {group.custodies.length > 3 && (
                          <p className="text-xs text-muted-foreground/60 mt-0.5">
                            ... و{group.custodies.length - 3} بنود أخرى
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Total + detail button */}
                    <div className="flex items-center gap-4 shrink-0 mr-auto">
                      <div className="text-right">
                        <p className="text-xl font-bold text-amber-600">{formatAmount(group.total)}</p>
                        <p className="text-xs text-muted-foreground">EGP</p>
                      </div>
                      <CustodyDetailDialog
                        employeeName={group.employee.name}
                        jobTitle={group.employee.job_title}
                        custodies={group.custodies}
                      />
                    </div>

                  </div>
                </CardContent>
              </Card>
            ))}
          </>
        )}

        {/* ── Section 1.5: Pending Vendor POs ─────────────────────────────────── */}
        <div className="flex items-center gap-2 border-b border-border pb-2 mt-4">
          <Truck className="h-4 w-4 text-amber-600" />
          <h2 className="font-semibold text-sm">مطالبات الموردين المعلقة</h2>
          {vendorPendingGroups.length > 0 && (
            <span className="mr-auto text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/20">
              {safePendingVendorPOs.length} مطالبة · {vendorPendingGroups.length} مورد · {formatAmount(vendorPendingTotal)} EGP
            </span>
          )}
        </div>

        {vendorPendingGroups.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center p-8 text-center gap-2">
              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">لا توجد مطالبات موردين معلقة. جميع الفواتير مسددة!</p>
            </CardContent>
          </Card>
        ) : (
          <Link href={vendorPendingLink} scroll={false} className="block group">
            <Card className="bg-amber-500/5 hover:bg-amber-500/10 transition-all border-amber-500/20 group-hover:border-amber-500/40 shadow-sm group-hover:shadow-md cursor-pointer">
              <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-amber-500/10 shrink-0">
                    <Truck className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-base text-amber-700 dark:text-amber-400">
                      مطالبات الموردين المعلقة ({vendorPendingGroups.length} مورد)
                    </h3>
                    <p className="text-xs text-amber-600/80 mt-0.5">
                      تتطلب السداد والتسوية مع الموردين
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4 sm:ml-auto">
                  <span className="font-bold text-lg text-amber-700">{formatAmount(vendorPendingTotal)} EGP</span>
                  <span className="text-xs font-medium text-amber-600/70 group-hover:text-amber-600 transition-colors hidden sm:inline-block">
                    التفاصيل &rarr;
                  </span>
                </div>
              </CardContent>
            </Card>
          </Link>
        )}

        <Modal name="vendor-pending" title="مطالبات الموردين المعلقة" description={`تفاصيل المبالغ المعلقة للموردين والمقاولين. الإجمالي: ${formatAmount(vendorPendingTotal)} EGP`}>
          <div className="flex flex-col gap-3 max-h-[70vh] overflow-y-auto p-1">
            {vendorPendingGroups.map((group) => (
              <Link key={group.vendor.id} href={`/vendor-pos?vendor_id=${group.vendor.id}`} className="block group/item">
                <div className="flex flex-col gap-2 p-3 rounded-xl border border-border bg-card hover:bg-muted/50 transition-colors">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Truck className="h-4 w-4 text-amber-600" />
                      <h3 className="font-semibold text-sm group-hover/item:text-amber-600 transition-colors">{group.vendor.name}</h3>
                      <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                        {group.pos.length} مطالبة
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-sm text-amber-700">{formatAmount(group.total)} EGP</span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover/item:opacity-100 transition-opacity" />
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </Modal>

      </section>

      {/* ── Section 2: Paid custodies ────────────────────────────────────────── */}
      {safePaid.length > 0 && (
        <>
          <Link href={paidCustodiesLink} scroll={false} className="block group">
            <Card className="bg-green-500/5 hover:bg-green-500/10 transition-all border-green-500/20 group-hover:border-green-500/40 shadow-sm group-hover:shadow-md">
              <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-500/10 shrink-0">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  </div>
                  <h2 className="font-semibold text-base text-green-700 dark:text-green-400">عهد مصروفة — سجل المدفوعات</h2>
                </div>
                <div className="flex items-center gap-4 sm:ml-auto">
                  <span className="text-xs font-medium px-3 py-1 rounded-full bg-green-500/10 text-green-700 border border-green-500/20">
                    {safePaid.length} عهدة · إجمالي: {formatAmount(custodyPaidTotal)} EGP
                  </span>
                  <span className="text-xs font-medium text-green-600/70 group-hover:text-green-600 transition-colors hidden sm:inline-block">
                    عرض السجل &rarr;
                  </span>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Modal name="paid-custodies" title="عهد مصروفة — سجل المدفوعات" description={`سجل العهد التي تم صرفها للموظفين. الإجمالي: ${formatAmount(custodyPaidTotal)} EGP`}>
            <div className="flex flex-col gap-2">
            {safePaid.map((c: any) => {
              const employee        = c.employees       as any
              const bankAccount     = c.bank_accounts   as any
              const settlingExpense = c.settling_expense as any
              const isAdvanceSettled = !!c.settled_by_expense_id

              return (
                <div key={c.id} className="flex items-center justify-between p-3 rounded-xl border border-border bg-card hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-3 min-w-0 pr-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                    <span className="font-medium text-sm truncate">{c.item}</span>
                    <span className="hidden sm:inline-block text-muted-foreground mx-1">·</span>
                    <span className="text-xs text-muted-foreground truncate max-w-[120px] sm:max-w-[200px]">
                      {employee?.name}
                    </span>
                    {isAdvanceSettled && (
                      <span className="hidden md:inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full border bg-blue-500/10 text-blue-700 border-blue-500/20 shrink-0 mx-2">
                        سُويت بسلفة
                      </span>
                    )}
                  </div>
                  
                  <div className="flex items-center gap-4 pl-2 shrink-0">
                    <span className="font-bold text-sm text-green-700 dir-ltr">{formatAmount(Number(c.amount))} EGP</span>
                    <PaidCustodyDetailDialog 
                      custody={c}
                      employee={employee}
                      bankAccount={bankAccount}
                      settlingExpense={settlingExpense}
                      isAdvanceSettled={isAdvanceSettled}
                    />
                  </div>
                </div>
              )
            })}
          </div>
          </Modal>
        </>
      )}

      {/* ── Section 3: Employee Advances ─────────────────────────────────────── */}
      <Link href={employeeAdvancesLink} scroll={false} className="block group">
        <Card className="bg-blue-500/5 hover:bg-blue-500/10 transition-all border-blue-500/20 group-hover:border-blue-500/40 shadow-sm group-hover:shadow-md">
          <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-blue-500/10 shrink-0">
                <User className="h-5 w-5 text-blue-600" />
              </div>
              <h2 className="font-semibold text-base text-blue-700 dark:text-blue-400">سلف وتسبيقات الموظفين</h2>
            </div>
            
            <div className="flex flex-wrap items-center gap-4 sm:ml-auto">
              {employeeAdvances.length > 0 ? (
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <span className="text-xs font-medium px-3 py-1 rounded-full bg-blue-500/10 text-blue-600 border border-blue-500/20">
                    {employeeAdvances.length} دفعة · إجمالي: {formatAmount(employeeAdvanceTotal)} EGP
                  </span>
                  <span className={`text-xs font-medium px-3 py-1 rounded-full border ${advanceRemainingTotal > 0 ? "bg-green-500/10 text-green-700 border-green-500/20" : "bg-muted text-muted-foreground border-border"}`}>
                    متبقي للتسوية: {formatAmount(advanceRemainingTotal)} EGP
                  </span>
                </div>
              ) : (
                <span className="text-xs text-blue-600/70">لا توجد سلف</span>
              )}
              <span className="text-xs font-medium text-blue-600/70 group-hover:text-blue-600 transition-colors hidden sm:inline-block">
                عرض السجل &rarr;
              </span>
            </div>
          </CardContent>
        </Card>
      </Link>

      <Modal name="employee-advances" title="سلف وتسبيقات الموظفين" description={`سجل سلف الموظفين. الإجمالي: ${formatAmount(employeeAdvanceTotal)} EGP`}>
        {employeeAdvances.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center p-8 text-center gap-2">
              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                <User className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">لا توجد سلف مسجلة للموظفين.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
          {employeeAdvances.map((exp: any) => {
            const employee    = exp.employees     as any
            const bankAccount = exp.bank_accounts as any
            const settledAmt  = advanceSettledMap.get(exp.id) || 0
            const expRemaining = Number(exp.amount) - settledAmt
            const typeColor   = "bg-blue-500/10 text-blue-700 border-blue-500/20"

            return (
              <Card key={exp.id} className="hover:shadow-md transition-all">
                <CardContent className="p-4">
                  <div className="flex items-start gap-4 flex-wrap">
                    <div className="p-2.5 rounded-xl shrink-0 bg-blue-500/10">
                      <User className="h-5 w-5 text-blue-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-base">{exp.description}</h3>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${typeColor}`}>
                          {TYPE_LABEL[exp.payment_type] ?? exp.payment_type}
                        </span>
                      </div>
                      {exp.notes && <p className="text-sm text-muted-foreground mt-0.5">{exp.notes}</p>}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
                        {employee && (
                          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <User className="h-3.5 w-3.5" />{employee.name}
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
                      <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">الإجمالي (EGP)</p>
                      <div className={`mt-1 flex items-center justify-end gap-1 text-xs font-semibold ${expRemaining > 0 ? "text-green-600" : "text-muted-foreground"}`}>
                        <span>متبقي:</span>
                        <span className="dir-ltr">{formatAmount(expRemaining)}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
          </div>
        )}
      </Modal>

      {/* ── Section 4: Vendor Advances ───────────────────────────────────────── */}
      <Link href={vendorAdvancesLink} scroll={false} className="block group">
        <Card className="bg-purple-500/5 hover:bg-purple-500/10 transition-all border-purple-500/20 group-hover:border-purple-500/40 shadow-sm group-hover:shadow-md">
          <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-purple-500/10 shrink-0">
                <Truck className="h-5 w-5 text-purple-600" />
              </div>
              <h2 className="font-semibold text-base text-purple-700 dark:text-purple-400">تسبيقات الموردين والمقاولين</h2>
            </div>
            
            <div className="flex flex-wrap items-center gap-4 sm:ml-auto">
              {vendorAdvances.length > 0 ? (
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <span className="text-xs font-medium px-3 py-1 rounded-full bg-purple-500/10 text-purple-600 border border-purple-500/20">
                    {vendorAdvances.length} دفعة · إجمالي: {formatAmount(vendorAdvanceTotal)} EGP
                  </span>
                </div>
              ) : (
                <span className="text-xs text-purple-600/70">لا توجد تسبيقات</span>
              )}
              <span className="text-xs font-medium text-purple-600/70 group-hover:text-purple-600 transition-colors hidden sm:inline-block">
                عرض السجل &rarr;
              </span>
            </div>
          </CardContent>
        </Card>
      </Link>

      <Modal name="vendor-advances" title="تسبيقات الموردين والمقاولين" description={`سجل تسبيقات الموردين والمقاولين. الإجمالي: ${formatAmount(vendorAdvanceTotal)} EGP`}>
        {vendorAdvances.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center p-8 text-center gap-2">
              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                <Truck className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">لا توجد تسبيقات مسجلة للموردين.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="flex flex-col gap-3">
          {vendorAdvances.map((exp: any) => {
            const vendor      = exp.vendors       as any
            const bankAccount = exp.bank_accounts as any
            const typeColor   = "bg-purple-500/10 text-purple-700 border-purple-500/20"

            return (
              <Card key={exp.id} className="hover:shadow-md transition-all">
                <CardContent className="p-4">
                  <div className="flex items-start gap-4 flex-wrap">
                    <div className="p-2.5 rounded-xl shrink-0 bg-purple-500/10">
                      <Truck className="h-5 w-5 text-purple-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-base">{exp.description}</h3>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${typeColor}`}>
                          {TYPE_LABEL[exp.payment_type] ?? exp.payment_type}
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
                      <p className="text-[10px] text-muted-foreground mb-1 uppercase tracking-wider">الإجمالي (EGP)</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
          </div>
        )}
      </Modal>

    </div>
  )
}
