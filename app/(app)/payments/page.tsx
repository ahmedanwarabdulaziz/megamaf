import { createClient } from "@/lib/supabase/server"
import { Card, CardContent } from "@/components/ui/card"
import {
  Banknote, BadgeCheck, User,
  Calendar, Clock, Package, AlertTriangle,
  Receipt, CheckCircle2, ArrowRight, Landmark,
} from "lucide-react"
import { PayCustodyButton } from "@/components/ui/pay-custody-button"
import { AddPaymentModal } from "@/components/modals/add-payment-modal"

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
  direct:           "دفعة مباشرة",
}

export default async function PaymentsPage() {
  const supabase = await createClient()

  const [
    { data: pendingCustodies },
    { data: paidCustodies },
    { data: advancePayments },
    { data: bankAccountsRaw },
    { data: employees },
  ] = await Promise.all([
    // 1. Approved + unfunded = waiting to be paid
    supabase
      .from("employee_custodies")
      .select(`
        id, item, amount, date, approved_at,
        employees(id, name, job_title)
      `)
      .not("approved_at", "is", null)
      .is("funded_at", null)
      .order("approved_at", { ascending: true }),

    // 2. Funded custodies — show as completed payments with their source reference
    supabase
      .from("employee_custodies")
      .select(`
        id, item, amount, date, approved_at, funded_at, bank_account_id,
        employees(id, name, job_title),
        bank_accounts(id, account_name, banks(name)),
        settled_by_expense_id,
        settling_expense:expenses!settled_by_expense_id(
          id, description, amount, expense_date, payment_type,
          bank_accounts(id, account_name, banks(name))
        )
      `)
      .not("funded_at", "is", null)
      .order("funded_at", { ascending: false }),

    // 3. Manual advance payments (non-custody)
    supabase
      .from("expenses")
      .select(`
        id, description, amount, expense_date, payment_type, notes,
        employees(id, name),
        bank_accounts(id, account_name, banks(name))
      `)
      .in("payment_type", ["employee_advance", "direct"])
      .order("expense_date", { ascending: false }),

    supabase.from("bank_accounts").select("id, account_name, banks(name)").order("account_name"),
    supabase.from("employees").select("id, name, job_title").order("name"),
  ])

  const safePending  = pendingCustodies || []
  const safePaid     = paidCustodies    || []
  const safeAdvances = advancePayments  || []
  const bankAccounts = (bankAccountsRaw || []).map((a: any) => ({
    id: a.id, account_name: a.account_name, bank_name: a.banks?.name ?? "",
  }))

  const custodyPendingTotal = safePending.reduce((s, c) => s + Number(c.amount), 0)
  const custodyPaidTotal    = safePaid.reduce((s, c) => s + Number(c.amount), 0)
  const advanceTotal        = safeAdvances.reduce((s, e) => s + Number(e.amount), 0)

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="static md:sticky md:top-0 z-20 bg-background/95 backdrop-blur-md pb-4 border-b border-border -mx-4 px-4 -mt-4 pt-4 md:-mx-6 md:px-6 md:-mt-6 md:pt-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-2">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">المصروفات</h1>
          <p className="text-muted-foreground mt-1">صرف العهد المعتمدة وإضافة سلف وتسبيقات.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {custodyPendingTotal > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs">
              <Clock className="h-3.5 w-3.5 text-amber-600" />
              <span className="text-muted-foreground">معلق</span>
              <span className="font-bold text-amber-600">{formatAmount(custodyPendingTotal)} EGP</span>
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
            employees={employees || []}
            bankAccounts={bankAccounts}
          />
        </div>
      </div>

      {/* ── Section 1: Pending custody queue ─────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <Clock className="h-4 w-4 text-amber-600" />
          <h2 className="font-semibold text-sm">عهد معتمدة — تنتظر الصرف</h2>
          {safePending.length > 0 && (
            <span className="mr-auto text-xs font-medium px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 border border-amber-500/20">
              {safePending.length} في الانتظار · {formatAmount(custodyPendingTotal)} EGP
            </span>
          )}
        </div>

        {safePending.length === 0 ? (
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
            {safePending.map((c: any) => {
              const employee = c.employees as any
              return (
                <Card key={c.id} className="hover:shadow-md transition-all border-amber-500/10 hover:border-amber-500/25">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4 flex-wrap">
                      <div className="p-2.5 rounded-xl bg-amber-500/10 shrink-0">
                        <Banknote className="h-5 w-5 text-amber-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h3 className="font-semibold text-base">{c.item}</h3>
                          <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border bg-green-500/10 text-green-700 border-green-500/20">
                            <BadgeCheck className="h-3 w-3" />معتمدة
                          </span>
                          <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border bg-amber-500/10 text-amber-700 border-amber-500/20">
                            <Clock className="h-3 w-3" />لم تُصرف
                          </span>
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                          {employee && (
                            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                              <User className="h-3.5 w-3.5" />{employee.name}
                              {employee.job_title && <span className="text-xs opacity-70">— {employee.job_title}</span>}
                            </span>
                          )}
                          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Package className="h-3.5 w-3.5" />تاريخ العهدة: {formatDate(c.date)}
                          </span>
                          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <BadgeCheck className="h-3.5 w-3.5 text-green-600" />اعتُمد: {formatDate(c.approved_at)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-4 shrink-0 mr-auto">
                        <div className="text-right">
                          <p className="text-xl font-bold">{formatAmount(Number(c.amount))}</p>
                          <p className="text-xs text-muted-foreground">EGP</p>
                        </div>
                        <PayCustodyButton
                          custodyId={c.id} custodyItem={c.item}
                          custodyAmount={Number(c.amount)} employeeName={employee?.name ?? ""}
                          bankAccounts={bankAccounts}
                        />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </>
        )}
      </section>

      {/* ── Section 2: Paid custodies history ───────────────────────────────── */}
      {safePaid.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2 border-b border-border pb-2">
            <CheckCircle2 className="h-4 w-4 text-green-600" />
            <h2 className="font-semibold text-sm">عهد مصروفة — سجل المدفوعات</h2>
            <span className="mr-auto text-xs font-medium px-2 py-0.5 rounded-full bg-green-500/10 text-green-700 border border-green-500/20">
              {safePaid.length} عهدة · {formatAmount(custodyPaidTotal)} EGP
            </span>
          </div>

          {safePaid.map((c: any) => {
            const employee        = c.employees       as any
            const bankAccount     = c.bank_accounts   as any
            const settlingExpense = c.settling_expense as any // advance that settled this custody
            const isAdvanceSettled = !!c.settled_by_expense_id

            return (
              <Card key={c.id} className="border-green-500/10 hover:shadow-sm transition-all">
                <CardContent className="p-4">
                  <div className="flex items-start gap-4 flex-wrap">

                    {/* Icon */}
                    <div className="p-2.5 rounded-xl bg-green-500/10 shrink-0">
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    </div>

                    {/* Details */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-base">{c.item}</h3>
                        <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border bg-green-500/10 text-green-700 border-green-500/20">
                          <CheckCircle2 className="h-3 w-3" />مصروفة
                        </span>
                        {isAdvanceSettled && (
                          <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border bg-blue-500/10 text-blue-700 border-blue-500/20">
                            <Banknote className="h-3 w-3" />سُويت بسلفة
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
                        {employee && (
                          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <User className="h-3.5 w-3.5" />{employee.name}
                          </span>
                        )}
                        <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                          <Calendar className="h-3.5 w-3.5" />تاريخ العهدة: {formatDate(c.date)}
                        </span>
                        <span className="flex items-center gap-1.5 text-sm text-green-700 font-medium">
                          <CheckCircle2 className="h-3.5 w-3.5" />صُرفت: {formatDate(c.funded_at)}
                        </span>
                      </div>

                      {/* Payment reference block */}
                      <div className="mt-2 flex items-start gap-2 p-2.5 rounded-lg bg-muted/50 border border-border">
                        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5 rotate-180" />
                        <div className="text-xs text-muted-foreground">
                          {isAdvanceSettled && settlingExpense ? (
                            <>
                              <span className="font-medium text-foreground">
                                {TYPE_LABEL[settlingExpense.payment_type] ?? "دفعة"}: {settlingExpense.description}
                              </span>
                              <span className="mx-1.5">·</span>
                              <span className="flex items-center gap-1 inline-flex">
                                <Landmark className="h-3 w-3" />
                                {settlingExpense.bank_accounts?.banks?.name} — {settlingExpense.bank_accounts?.account_name}
                              </span>
                              <span className="mx-1.5">·</span>
                              {formatAmount(Number(settlingExpense.amount))} EGP
                              <span className="mx-1.5">·</span>
                              {formatDate(settlingExpense.expense_date)}
                            </>
                          ) : bankAccount ? (
                            <>
                              <span className="font-medium text-foreground">صرف مباشر</span>
                              <span className="mx-1.5">·</span>
                              <span className="flex items-center gap-1 inline-flex">
                                <Landmark className="h-3 w-3" />
                                {bankAccount.banks?.name} — {bankAccount.account_name}
                              </span>
                            </>
                          ) : (
                            <span>تم الصرف</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Amount */}
                    <div className="text-right shrink-0">
                      <p className="text-xl font-bold text-green-700">{formatAmount(Number(c.amount))}</p>
                      <p className="text-xs text-muted-foreground">EGP</p>
                    </div>

                  </div>
                </CardContent>
              </Card>
            )
          })}
        </section>
      )}

      {/* ── Section 3: Advance payments ──────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <Receipt className="h-4 w-4 text-purple-600" />
          <h2 className="font-semibold text-sm">السلف والتسبيقات المدفوعة</h2>
          {safeAdvances.length > 0 && (
            <span className="mr-auto text-xs font-medium px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-600 border border-purple-500/20">
              {safeAdvances.length} دفعة · {formatAmount(advanceTotal)} EGP
            </span>
          )}
        </div>

        {safeAdvances.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center p-8 text-center gap-2">
              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                <Receipt className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">لا توجد سلف مسجلة. استخدم زر "إضافة دفعة" أعلاه.</p>
            </CardContent>
          </Card>
        ) : (
          safeAdvances.map((exp: any) => {
            const employee    = exp.employees     as any
            const bankAccount = exp.bank_accounts as any
            const typeColor   =
              exp.payment_type === "employee_advance" ? "bg-blue-500/10 text-blue-700 border-blue-500/20" :
                                                        "bg-amber-500/10 text-amber-700 border-amber-500/20"
            const PersonIcon  = User

            return (
              <Card key={exp.id} className="hover:shadow-md transition-all">
                <CardContent className="p-4">
                  <div className="flex items-start gap-4 flex-wrap">
                    <div className="p-2.5 rounded-xl bg-purple-500/10 shrink-0">
                      <PersonIcon className="h-5 w-5 text-purple-600" />
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
                      <p className="text-xs text-muted-foreground">EGP</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })
        )}
      </section>

    </div>
  )
}
