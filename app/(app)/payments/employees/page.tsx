import { createClient } from '@/lib/supabase/server'
import Link from 'next/link'
import {
  User,
  Clock,
  CheckCircle2,
  Banknote,
  Package,
  BadgeCheck,
  Calendar,
  Landmark,
  ArrowRight,
  AlertTriangle,
  Receipt,
  ChevronLeft,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PaymentsFilter } from '@/components/ui/payments-filter'
import { PaymentsTabs } from '@/components/ui/payments-tabs'
import { CustodyDetailDialog } from '@/components/ui/custody-detail-dialog'
import { PaidCustodyDetailDialog } from '@/components/ui/paid-custody-detail-dialog'
import { AddPaymentModal } from '@/components/modals/add-payment-modal'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('ar-EG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatAmount(n: number) {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Employee {
  id: string
  name: string
  job_title?: string | null
}

interface BankAccount {
  id: string
  account_name: string
  banks?: { name: string } | null
}

interface PendingCustody {
  id: string
  item: string
  amount: number
  date: string
  approved_at: string | null
  funded_amount?: number | null
  employees: { id: string; name: string; job_title?: string | null }
}

interface PaidCustody {
  id: string
  item: string
  amount: number
  date: string
  approved_at: string | null
  funded_at: string | null
  bank_account_id: string | null
  employees: { id: string; name: string; job_title?: string | null }
  bank_accounts?: BankAccount | null
  settled_by_expense_id?: string | null
  settling_expense?: {
    id: string
    description: string
    amount: number
    expense_date: string
    payment_type: string
    bank_accounts?: BankAccount | null
  } | null
}

interface AdvanceExpense {
  id: string
  description: string
  amount: number
  expense_date: string
  payment_type: string
  notes?: string | null
  employees?: { id: string; name: string } | null
  bank_accounts?: BankAccount | null
}

interface EmployeeGroup {
  employee: Employee
  custodies: PendingCustody[]
  total: number
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default async function EmployeePaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; employeeId?: string; projectId?: string; month?: string }>
}) {
  const params = await searchParams
  const tab = params.tab ?? 'pending'
  const employeeId = params.employeeId
  const projectId = params.projectId

  // Month defaults to current month YYYY-MM
  const now = new Date()
  const defaultMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const month = params.month ?? defaultMonth

  const [year, mon] = month !== 'all' ? month.split('-').map(Number) : [0, 0]

  // Date range — only apply when a specific month is explicitly selected
  const applyDateFilter = month !== 'all'
  const start = applyDateFilter ? new Date(year, mon - 1, 1).toISOString() : null
  const end   = applyDateFilter ? new Date(year, mon,     1).toISOString() : null

  const supabase = await createClient()

  // ── Employees & Projects lists (for filter) ──────────────────────────────
  const [{ data: employees }, { data: projects }, { data: bankAccountsRaw }] = await Promise.all([
    supabase.from('employees').select('id, name, job_title').order('name'),
    supabase.from('projects').select('id, name').order('name'),
    supabase.from('bank_accounts').select('id, account_name, banks(name)').order('account_name'),
  ])

  const bankAccounts = (bankAccountsRaw || []).map((a: any) => ({
    id: a.id, account_name: a.account_name, bank_name: a.banks?.name ?? "",
  }))

  const paidCustodySelect = `id, item, amount, funded_amount, date, approved_at, funded_at, bank_account_id,
     employees!inner(id, name, job_title),
     bank_accounts(id, account_name, banks(name))`

  // ── Pending (approved, funded_at null) ────────────────────────────────────
  let pendingQuery = supabase
    .from('employee_custodies')
    .select('id, item, amount, date, approved_at, funded_amount, employees!inner(id, name, job_title)')
    .not('approved_at', 'is', null)
    .is('funded_at', null)
    .order('date', { ascending: false })

  if (start) pendingQuery = pendingQuery.gte('date', start) as any
  if (end)   pendingQuery = pendingQuery.lt('date', end) as any
  if (employeeId) pendingQuery = pendingQuery.eq('employees.id', employeeId)

  // ── Paid path A: paid via button → funded_at IS NOT NULL ─── filter by funded_at (payment date)
  let paidByButtonQuery = supabase
    .from('employee_custodies')
    .select(paidCustodySelect)
    .not('funded_at', 'is', null)
    .order('funded_at', { ascending: false })

  if (start) paidByButtonQuery = paidByButtonQuery.gte('funded_at', start) as any
  if (end)   paidByButtonQuery = paidByButtonQuery.lt('funded_at', end) as any
  if (employeeId) paidByButtonQuery = paidByButtonQuery.eq('employees.id', employeeId)

  // ── Paid path B: fully settled via advance auto-settlement ────────────────
  // funded_at stays null, but funded_amount = amount (fully covered by advances)
  let paidByAdvanceQuery = supabase
    .from('employee_custodies')
    .select(paidCustodySelect)
    .not('approved_at', 'is', null)
    .is('funded_at', null)
    .not('funded_amount', 'is', null)
    .order('date', { ascending: false })

  if (start) paidByAdvanceQuery = paidByAdvanceQuery.gte('date', start) as any
  if (end)   paidByAdvanceQuery = paidByAdvanceQuery.lt('date', end) as any
  if (employeeId) paidByAdvanceQuery = paidByAdvanceQuery.eq('employees.id', employeeId)

  const [{ data: pendingCustodiesRaw }, { data: paidByButton }, { data: paidByAdvanceRaw }] = await Promise.all([
    pendingQuery,
    paidByButtonQuery,
    paidByAdvanceQuery,
  ])

  // Filter path B to only fully settled (funded_amount >= amount)
  const paidByAdvance = (paidByAdvanceRaw || []).filter(
    (c: any) => Number(c.funded_amount || 0) >= Number(c.amount)
  )

  // Merge & deduplicate by id, sort newest first
  const paidMap = new Map<string, any>()
  for (const c of [...(paidByButton || []), ...paidByAdvance]) {
    paidMap.set((c as any).id, c)
  }
  const paidCustodies = Array.from(paidMap.values())
    .sort((a, b) => new Date(b.funded_at ?? b.date).getTime() - new Date(a.funded_at ?? a.date).getTime())

  // Exclude fully-advance-settled custodies from the pending list
  const paidByAdvanceIds = new Set(paidByAdvance.map((c: any) => c.id))
  const pendingCustodies = (pendingCustodiesRaw || []).filter(
    (c: any) => !paidByAdvanceIds.has(c.id)
  )

  // ── Employee advances ────────────────────────────────────────────────────
  let advanceQuery = supabase
    .from('expenses')
    .select('id, description, amount, expense_date, payment_type, notes, employees(id, name), bank_accounts(id, account_name, banks(name))')
    .in('payment_type', ['employee_advance', 'direct'])
    .order('expense_date', { ascending: false })

  if (start) advanceQuery = advanceQuery.gte('expense_date', start) as any
  if (end)   advanceQuery = advanceQuery.lt('expense_date', end) as any
  if (employeeId) advanceQuery = advanceQuery.eq('employees.id', employeeId) as any

  const { data: advanceExpenses } = await advanceQuery

  // ── Group pending by employee ────────────────────────────────────────────
  const employeeMap = new Map<string, EmployeeGroup>()
  for (const custody of (pendingCustodies as unknown as PendingCustody[]) ?? []) {
    const emp = custody.employees
    if (!employeeMap.has(emp.id)) {
      employeeMap.set(emp.id, { employee: emp, custodies: [], total: 0 })
    }
    const group = employeeMap.get(emp.id)!
    group.custodies.push(custody)
    group.total += custody.amount - (custody.funded_amount ?? 0)
  }
  const pendingGroups = Array.from(employeeMap.values())

  const pendingCount = (pendingCustodies ?? []).length
  const paidCount = (paidCustodies ?? []).length
  const advanceCount = (advanceExpenses ?? []).length

  const paidCustodiesTyped = (paidCustodies || []) as unknown as PaidCustody[]
  const advanceExpensesTyped = (advanceExpenses || []) as unknown as AdvanceExpense[]

  const paidTotal = paidCustodiesTyped.reduce((s, c) => s + Number(c.amount), 0)
  const advanceTotal = advanceExpensesTyped.reduce((s, e) => s + Number(e.amount), 0)
  const pendingTotal = pendingGroups.reduce((s, g) => s + g.total, 0)

  const tabs = [
    { key: 'pending', label: 'عهد معلقة', badge: pendingCount },
    { key: 'paid', label: 'عهد مصروفة', badge: paidCount },
    { key: 'advances', label: 'سلف وتسبيقات', badge: advanceCount },
  ]

  const hasBankAccounts = (bankAccounts ?? []).length > 0

  // ── Payment type label helper ────────────────────────────────────────────
  function paymentTypeLabel(type: string) {
    switch (type) {
      case 'employee_advance': return 'سلفة موظف'
      case 'direct': return 'دفع مباشر'
      default: return type
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950" dir="rtl">
      {/* ─── Header ─────────────────────────────────────────────────────── */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 gap-3">
            {/* Back */}
            <Link
              href="/payments"
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
            >
              <ArrowRight className="h-4 w-4" />
              <span>المدفوعات</span>
            </Link>

            {/* Title */}
            <div className="flex items-center gap-2 flex-1 justify-center sm:justify-start">
              <div className="p-2 rounded-lg bg-blue-50 dark:bg-blue-950/40">
                <User className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              </div>
              <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">
                مدفوعات الموظفين
              </h1>
            </div>

            {/* Add payment button */}
            <AddPaymentModal
              employees={employees ?? []}
              vendors={[]}
              bankAccounts={bankAccounts}
            />
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-5">
        {/* ─── Filter ───────────────────────────────────────────────────── */}
        <PaymentsFilter employees={employees ?? []} projects={projects ?? []} />

        {/* ─── Tabs ─────────────────────────────────────────────────────── */}
        <PaymentsTabs tabs={tabs} />

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* TAB: PENDING ─────────────────────────────────────────────────  */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {tab === 'pending' && (
          <section className="space-y-4">
            {/* Section header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-amber-500" />
                <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">
                  العهد المعلقة
                </h2>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                  {pendingCount}
                </span>
              </div>
              {pendingCount > 0 && (
                <div className="text-sm font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-1 rounded-full border border-amber-200 dark:border-amber-800">
                  الإجمالي: {formatAmount(pendingTotal)} ج.م
                </div>
              )}
            </div>

            {/* No bank accounts warning */}
            {!hasBankAccounts && (
              <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-400">
                <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>لا توجد حسابات بنكية مسجّلة. يرجى إضافة حساب بنكي قبل تسوية العهد.</span>
              </div>
            )}

            {/* Info notice */}
            {pendingCount > 0 && (
              <div className="flex items-start gap-3 p-3 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 text-sm text-blue-700 dark:text-blue-400">
                <Receipt className="h-4 w-4 mt-0.5 shrink-0" />
                <span>اضغط زر "إضافة دفعة" لتسوية العهد المعلقة وتحويلها إلى مصروفات.</span>
              </div>
            )}

            {/* Empty state */}
            {pendingGroups.length === 0 && (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
                  <div className="p-4 rounded-full bg-amber-50 dark:bg-amber-950/30">
                    <Clock className="h-8 w-8 text-amber-400" />
                  </div>
                  <p className="text-base font-medium text-gray-600 dark:text-gray-400">
                    لا توجد عهد معلقة
                  </p>
                  <p className="text-sm text-gray-400 dark:text-gray-600">
                    ستظهر هنا العهد المعتمدة التي لم يتم صرفها بعد.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Pending custodies — row list */}
            {pendingGroups.length > 0 && (
              <Card className="overflow-hidden border-amber-500/20">
                <div className="divide-y divide-border">
                  {pendingGroups.flatMap(({ employee, custodies }) =>
                    custodies.map((c) => (
                      <div key={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
                        {/* Icon */}
                        <div className="h-8 w-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0">
                          <Package className="h-4 w-4 text-amber-600" />
                        </div>
                        {/* Item name */}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{c.item}</p>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <User className="h-3 w-3" />{employee.name}
                            </span>
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Calendar className="h-3 w-3" />{formatDate(c.date)}
                            </span>
                          </div>
                        </div>
                        {/* Amounts: total + remaining */}
                        <div className="shrink-0 text-left">
                          <div className="flex items-center gap-1.5 justify-end">
                            <span className="text-[11px] text-muted-foreground">الإجمالي</span>
                            <span className="text-xs font-medium text-muted-foreground line-through">
                              {formatAmount(c.amount)} EGP
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 justify-end mt-0.5">
                            <span className="text-[11px] text-amber-600">المتبقي</span>
                            <span className="text-sm font-bold text-amber-700 dark:text-amber-400">
                              {formatAmount(c.amount - (c.funded_amount ?? 0))} EGP
                            </span>
                          </div>
                        </div>
                        {/* Detail */}
                        <CustodyDetailDialog
                          employeeName={employee.name}
                          jobTitle={employee.job_title}
                          custodies={custodies}
                        />
                      </div>
                    ))
                  )}
                </div>
              </Card>
            )}
          </section>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* TAB: PAID ────────────────────────────────────────────────────  */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {tab === 'paid' && (
          <section className="space-y-4">
            {/* Section header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-500" />
                <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">
                  العهد المصروفة
                </h2>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">
                  {paidCount}
                </span>
              </div>
              {paidCount > 0 && (
                <div className="text-sm font-medium text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/20 px-3 py-1 rounded-full border border-green-200 dark:border-green-800">
                  الإجمالي: {formatAmount(paidTotal)} ج.م
                </div>
              )}
            </div>

            {/* Empty state */}
            {(paidCustodies ?? []).length === 0 && (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
                  <div className="p-4 rounded-full bg-green-50 dark:bg-green-950/30">
                    <CheckCircle2 className="h-8 w-8 text-green-400" />
                  </div>
                  <p className="text-base font-medium text-gray-600 dark:text-gray-400">
                    لا توجد عهد مصروفة
                  </p>
                  <p className="text-sm text-gray-400 dark:text-gray-600">
                    ستظهر هنا العهد التي تم صرفها وتسويتها.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Paid custodies — row list */}
            {paidCustodiesTyped.length > 0 && (
              <Card className="overflow-hidden border-green-500/20">
                <div className="divide-y divide-border">
                  {paidCustodiesTyped.map((custody) => {
                    const emp = (custody as any).employees as any
                    const bankAccount = (custody as any).bank_accounts as any
                    return (
                      <div key={custody.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
                        <div className="h-8 w-8 rounded-lg bg-green-500/10 flex items-center justify-center shrink-0">
                          <BadgeCheck className="h-4 w-4 text-green-600" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{custody.item}</p>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <User className="h-3 w-3" />{emp?.name}
                            </span>
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Calendar className="h-3 w-3" />{formatDate(custody.funded_at)}
                            </span>
                            {bankAccount && (
                              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                                <Landmark className="h-3 w-3" />{bankAccount.account_name}
                              </span>
                            )}
                          </div>
                        </div>
                        {/* Amounts: paid + original total */}
                        <div className="shrink-0 text-left">
                          <div className="flex items-center gap-1.5 justify-end">
                            <span className="text-[11px] text-muted-foreground">الإجمالي</span>
                            <span className="text-xs font-medium text-muted-foreground">
                              {formatAmount(Number(custody.amount))} EGP
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5 justify-end mt-0.5">
                            <span className="text-[11px] text-green-600">المصروف</span>
                            <span className="text-sm font-bold text-green-700 dark:text-green-400">
                              {formatAmount(Number((custody as any).funded_amount ?? custody.amount))} EGP
                            </span>
                          </div>
                        </div>
                        <PaidCustodyDetailDialog
                          custody={custody}
                          employee={emp}
                          bankAccount={bankAccount}
                        />
                      </div>
                    )
                  })}
                </div>
              </Card>
            )}
          </section>
        )}

        {/* ═══════════════════════════════════════════════════════════════ */}
        {/* TAB: ADVANCES ────────────────────────────────────────────────  */}
        {/* ═══════════════════════════════════════════════════════════════ */}
        {tab === 'advances' && (
          <section className="space-y-4">
            {/* Section header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Banknote className="h-5 w-5 text-blue-500" />
                <h2 className="text-base font-semibold text-gray-800 dark:text-gray-200">
                  السلف والتسبيقات
                </h2>
                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400">
                  {advanceCount}
                </span>
              </div>
              {advanceCount > 0 && (
                <div className="text-sm font-medium text-blue-700 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 px-3 py-1 rounded-full border border-blue-200 dark:border-blue-800">
                  الإجمالي: {formatAmount(advanceTotal)} ج.م
                </div>
              )}
            </div>

            {/* Empty state */}
            {(advanceExpenses ?? []).length === 0 && (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-16 text-center gap-3">
                  <div className="p-4 rounded-full bg-blue-50 dark:bg-blue-950/30">
                    <Banknote className="h-8 w-8 text-blue-400" />
                  </div>
                  <p className="text-base font-medium text-gray-600 dark:text-gray-400">
                    لا توجد سلف أو تسبيقات
                  </p>
                  <p className="text-sm text-gray-400 dark:text-gray-600">
                    ستظهر هنا السلف والمدفوعات المباشرة للموظفين.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Advances — row list */}
            {advanceExpensesTyped.length > 0 && (
              <Card className="overflow-hidden border-blue-500/20">
                <div className="divide-y divide-border">
                  {advanceExpensesTyped.map((expense) => (
                    <div key={expense.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors">
                      <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center shrink-0">
                        <Receipt className="h-4 w-4 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium truncate">{expense.description}</p>
                          <span className="shrink-0 text-[11px] font-medium bg-blue-500/10 text-blue-700 border border-blue-500/20 px-1.5 py-0.5 rounded-full">
                            {paymentTypeLabel(expense.payment_type)}
                          </span>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                          {expense.employees && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <User className="h-3 w-3" />{expense.employees.name}
                            </span>
                          )}
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Calendar className="h-3 w-3" />{formatDate(expense.expense_date)}
                          </span>
                          {expense.bank_accounts && (
                            <span className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Landmark className="h-3 w-3" />
                              {expense.bank_accounts.account_name}
                              {expense.bank_accounts.banks?.name ? ` — ${expense.bank_accounts.banks.name}` : ''}
                            </span>
                          )}
                          {expense.notes && (
                            <span className="text-xs text-muted-foreground truncate max-w-[200px]">{expense.notes}</span>
                          )}
                        </div>
                      </div>
                      <span className="shrink-0 text-sm font-bold text-blue-700 dark:text-blue-400">
                        {formatAmount(Number(expense.amount))} EGP
                      </span>
                    </div>
                  ))}
                </div>
              </Card>
            )}
          </section>
        )}
      </div>

      <AddPaymentModal
        employees={employees ?? []}
        vendors={[]}
        bankAccounts={bankAccounts}
      />
    </div>
  )
}
