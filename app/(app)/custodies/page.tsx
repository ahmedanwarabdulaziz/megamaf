import { createClient } from "@/lib/supabase/server"
import { getProfile, getEmployeePermissions } from "@/lib/supabase/get-profile"
import { getBatchSignedUrls } from "@/lib/r2"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Plus, ClipboardList, Pencil, Calendar, User, Users,
  FileText, Package, BadgeCheck, ShieldAlert,
  TrendingDown, TrendingUp, Minus, Wallet, MoreVertical,
} from "lucide-react"
import Link from "next/link"
import { AddCustodyModal } from "@/components/modals/add-custody-modal"
import { EditCustodyModal } from "@/components/modals/edit-custody-modal"
// EmployeeFilter removed
import { CustodySummary } from "./_components/custody-summary"
import { ImageLightbox } from "@/components/ui/image-lightbox"
import { DeleteConfirmButton } from "@/components/ui/delete-confirm-button"
import { QuickActions } from "@/components/ui/quick-actions"
import { Modal } from "@/components/ui/modal"
import { approveCustody, unapproveCustody, deleteCustody } from "./actions"

function formatDate(dateStr: string | null) {
  if (!dateStr) return null
  return new Date(dateStr).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" })
}
function isImagePath(path: string | null) {
  if (!path) return false
  return /\.(jpg|jpeg|png|gif|webp)$/i.test(path)
}

export default async function CustodiesPage({
  searchParams,
}: {
  searchParams: Promise<{ employee_id?: string; status?: string }>
}) {
  // Use React.cache()-memoized helpers — if getProfile() was already called by the
  // layout in the same request, this returns the cached result (zero extra DB calls).
  const { user, profile, supabase } = await getProfile()
  const { employee_id: filterEmployeeId, status: filterStatus = "" } = await searchParams

  let canApprove = false
  let canUnapprove = false
  let canEditApproved = false
  let seeAllCustodies = false   // false = only own custodies
  let seeAllProjects = false    // false = only assigned projects
  let myEmployeeId: string | null = null

  if (profile?.role === "admin" || profile?.role === "member") {
    canApprove = true; canUnapprove = true; canEditApproved = true; seeAllCustodies = true; seeAllProjects = true;
  } else if (profile?.role === "employee" && user) {
    // getEmployeePermissions() is also memoized — reuses layout's fetch if already called
    const emp = await getEmployeePermissions(user.id)
    myEmployeeId = emp?.id ?? null
    if (emp?.is_super_admin) {
      canApprove = true; canUnapprove = true; canEditApproved = true; seeAllCustodies = true; seeAllProjects = true;
    } else if (emp?.can_approve_custodies) {
      canApprove = true; seeAllCustodies = true
    }
    // else: regular employee — seeAllCustodies stays false, only sees their own
  }

  // Build custody query — restrict to own records for regular employees
  let custodiesQuery = supabase
    .from("employee_custodies")
    .select("*, employees(id, name, job_title)")
    .order("date", { ascending: false })
    .order("created_at", { ascending: false })
  if (!seeAllCustodies && myEmployeeId) {
    custodiesQuery = custodiesQuery.eq("employee_id", myEmployeeId) as any
  }

  // Build projects query — restrict to assigned projects for regular employees
  let projectsQuery = supabase.from("projects").select("id, name, is_company_branch").order("name")
  if (!seeAllProjects && myEmployeeId) {
    const { data: access } = await supabase
      .from("employee_project_access")
      .select("project_id")
      .eq("employee_id", myEmployeeId)
    
    const allowedProjectIds = access?.map(a => a.project_id) || []
    if (allowedProjectIds.length > 0) {
      projectsQuery = projectsQuery.in("id", allowedProjectIds) as any
    } else {
      projectsQuery = projectsQuery.eq("id", "00000000-0000-0000-0000-000000000000") as any
    }
  }

  const [{ data: custodies }, { data: employees }, { data: bankAccountsRaw }, { data: employeePayments }, { data: projects }] = await Promise.all([
    custodiesQuery,
    supabase.from("employees").select("id, name, job_title, can_have_custody").order("name"),
    supabase.from("bank_accounts").select("id, account_name, banks(name)").order("account_name"),
    // Fetch total payments made per employee (advances + direct custody payments)
    supabase.from("expenses").select("employee_id, amount, payment_type")
      .not("employee_id", "is", null),
    projectsQuery,
  ])

  const safeCustodies = (custodies || []).filter(c => Number(c.funded_amount || 0) < Number(c.amount)) // fully funded ones live on expenses page
  const safeEmployees = employees || []
  const safeProjects = projects || []
  const eligibleEmployees = safeEmployees.filter(e => e.can_have_custody)

  // Apply employee filter
  const afterEmployeeFilter = seeAllCustodies && filterEmployeeId
    ? safeCustodies.filter(c => c.employee_id === filterEmployeeId)
    : safeCustodies

  // Apply status filter
  const displayed =
    filterStatus === "pending"  ? afterEmployeeFilter.filter(c => !c.approved_at) :
    filterStatus === "approved" ? afterEmployeeFilter.filter(c => !!c.approved_at) :
    afterEmployeeFilter

  // Get R2 signed URLs via the cached helper (55-min TTL via unstable_cache).
  // Repeated page visits within 55 min reuse the cached URL — no outbound R2 call.
  const filePaths = displayed.filter(c => c.file_path).map(c => c.file_path as string)
  const signedUrls = await getBatchSignedUrls(filePaths)

  const notApprovedCount = displayed.filter(c => !c.approved_at).length
  const approvedCount = displayed.filter(c => !!c.approved_at).length
  const notApprovedAmount = displayed.filter(c => !c.approved_at).reduce((s, c) => s + Number(c.amount), 0)
  const approvedAmount = displayed.filter(c => !!c.approved_at).reduce((s, c) => s + Number(c.amount), 0)
  const totalAmount = notApprovedAmount + approvedAmount

  // ── Per-employee balance ──────────────────────────────────────────────────
  // Total approved custody amounts per employee (all custodies, funded or not)
  const custodyByEmployee: Record<string, { name: string; custodyTotal: number }> = {}
  for (const c of custodies || []) {
    const emp = (c as any).employees
    const name = emp?.name ?? "غير معروف"
    if (!custodyByEmployee[c.employee_id]) custodyByEmployee[c.employee_id] = { name, custodyTotal: 0 }
    if (c.approved_at) {
      custodyByEmployee[c.employee_id].custodyTotal += Number(c.amount)
    }
  }

  // Total payments received per employee from expenses
  const paymentByEmployee: Record<string, number> = {}
  for (const p of (employeePayments || [])) {
    const eid = (p as any).employee_id
    if (!eid) continue
    paymentByEmployee[eid] = (paymentByEmployee[eid] || 0) + Number((p as any).amount)
  }

  // Build balance rows only for employees who have either custody or payment records
  const allEmpIds = new Set([...Object.keys(custodyByEmployee), ...Object.keys(paymentByEmployee)])
  const balanceRows = Array.from(allEmpIds).map(eid => {
    const custodyTotal = custodyByEmployee[eid]?.custodyTotal ?? 0
    const paidTotal    = paymentByEmployee[eid] ?? 0
    const balance      = paidTotal - custodyTotal
    const name         = custodyByEmployee[eid]?.name
      ?? safeEmployees.find(e => e.id === eid)?.name
      ?? "موظف"
    return { eid, name, custodyTotal, paidTotal, balance }
  }).sort((a, b) => Math.abs(b.balance) - Math.abs(a.balance)) // largest imbalance first

  // Targeted employee balance for top summary
  const targetEmployeeId = seeAllCustodies ? filterEmployeeId : myEmployeeId
  let targetEmployeeBalance = null
  if (targetEmployeeId) {
    const row = balanceRows.find(r => r.eid === targetEmployeeId)
    if (row) {
      targetEmployeeBalance = row
    } else {
      const name = safeEmployees.find(e => e.id === targetEmployeeId)?.name ?? "موظف"
      targetEmployeeBalance = { eid: targetEmployeeId, name, custodyTotal: 0, paidTotal: 0, balance: 0 }
    }
  }

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      {/* Header */}
      <div className="static md:sticky md:top-0 z-20 bg-background/95 backdrop-blur-md pb-4 border-b border-border -mx-4 px-4 -mt-4 pt-4 md:-mx-6 md:px-6 md:-mt-6 md:pt-6 mb-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 shrink-0">
          <h1 className="text-2xl font-bold tracking-tight">العهد</h1>
        </div>
        
        <Link href="?modal=add-custody" scroll={false} className="shrink-0 ml-auto">
          <Button variant="default" size="icon" className="h-8 w-8 rounded-full" title="إضافة عهدة">
            <Plus className="h-4 w-4" />
          </Button>
        </Link>
      </div>

      {/* Target Employee Prominent Balance */}
      {targetEmployeeBalance && (
        <Card className={`border-2 ${
          targetEmployeeBalance.balance > 0 ? "border-green-500/40 bg-green-500/5 shadow-green-500/5" :
          targetEmployeeBalance.balance < 0 ? "border-amber-500/40 bg-amber-500/5 shadow-amber-500/5" :
          "border-border bg-muted/20"
        }`}>
          <CardContent className="p-6 flex flex-col sm:flex-row items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <div className={`h-14 w-14 rounded-full flex items-center justify-center ${
                targetEmployeeBalance.balance > 0 ? "bg-green-500/20 text-green-700" :
                targetEmployeeBalance.balance < 0 ? "bg-amber-500/20 text-amber-700" :
                "bg-muted text-muted-foreground"
              }`}>
                <Wallet className="h-7 w-7" />
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">
                  رصيد {targetEmployeeBalance.name} الحالي
                </p>
                <div className="flex items-baseline gap-1.5 mt-0.5">
                  <h2 className={`text-3xl font-bold ${
                    targetEmployeeBalance.balance > 0 ? "text-green-700" :
                    targetEmployeeBalance.balance < 0 ? "text-amber-700" :
                    "text-foreground"
                  }`}>
                    {targetEmployeeBalance.balance > 0 ? "+" : ""}
                    {targetEmployeeBalance.balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </h2>
                  <span className="text-sm font-medium text-muted-foreground">EGP</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {targetEmployeeBalance.balance > 0 ? "رصيد زائد متوفر مع الموظف" :
                   targetEmployeeBalance.balance < 0 ? "رصيد مستحق للموظف يجب تسويته" :
                   "الحساب متوازن تماماً"}
                </p>
              </div>
            </div>
            
            <div className="flex items-center gap-8 text-sm">
              <div className="flex flex-col items-end">
                <span className="text-muted-foreground mb-1 flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5 text-green-600" /> إجمالي سلف / دفعات
                </span>
                <span className="font-bold text-base">
                  {targetEmployeeBalance.paidTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP
                </span>
              </div>
              <div className="w-px h-10 bg-border"></div>
              <div className="flex flex-col items-end">
                <span className="text-muted-foreground mb-1 flex items-center gap-1.5">
                  <TrendingDown className="h-3.5 w-3.5 text-amber-600" /> إجمالي عهد معتمدة
                </span>
                <span className="font-bold text-base">
                  {targetEmployeeBalance.custodyTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EGP
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Clickable Summary */}
      <CustodySummary
        notApprovedAmount={notApprovedAmount}
        notApprovedCount={notApprovedCount}
        approvedAmount={approvedAmount}
        approvedCount={approvedCount}
        totalAmount={totalAmount}
        totalCount={afterEmployeeFilter.length}
      />

      {/* ── Per-employee balance panel ──────────────────────────────────── */}
      {seeAllCustodies && balanceRows.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">رصيد الموظفين</p>
            <Link href="?modal=employee-balances" scroll={false}>
              <Button variant="ghost" size="icon" className="h-5 w-5 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted" title="عرض قائمة تفصيلية بجميع أرصدة الموظفين">
                <Users className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
          <div className="flex overflow-x-auto gap-2 pb-2 no-scrollbar -mx-4 px-4 md:-mx-6 md:px-6">
            {balanceRows.map(row => {
              const isPositive = row.balance > 0
              const isNegative = row.balance < 0
              const isActive = filterEmployeeId === row.eid

              // Toggle filter: if active, remove it. Otherwise set it.
              const sp = new URLSearchParams()
              if (filterStatus) sp.set("status", filterStatus)
              if (!isActive) sp.set("employee_id", row.eid)
              const href = `?${sp.toString()}`

              return (
                <QuickActions key={row.eid} menuContent={
                  <div className="p-3 min-w-[200px] flex flex-col gap-2 pointer-events-none">
                    <span className="text-sm font-semibold truncate text-right">{row.name}</span>
                    <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground mt-1 text-right">
                      <span className="flex items-center gap-1 justify-end">
                        <strong className="text-foreground">{row.paidTotal.toLocaleString("en-US")}</strong> :مدفوع
                        <Wallet className="h-3 w-3" />
                      </span>
                      <span className="flex items-center gap-1 justify-end">
                        <strong className="text-foreground">{row.custodyTotal.toLocaleString("en-US")}</strong> :عهد
                        <ClipboardList className="h-3 w-3" />
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 text-right">
                      {isPositive ? `✓ لديه ${row.balance.toLocaleString("en-US")} EGP رصيد زائد` :
                       isNegative ? `⚠ يحتاج ${Math.abs(row.balance).toLocaleString("en-US")} EGP إضافية` :
                                    "✓ الحساب متوازن"}
                    </p>
                  </div>
                }>
                  <Link href={href} scroll={false} className="shrink-0 focus:outline-none cursor-context-menu">
                    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all hover:shadow-sm cursor-context-menu ${
                      isActive ? "ring-2 ring-primary shadow-sm" : "hover:border-primary/40"
                    } ${
                      isPositive ? "border-green-500/30 bg-green-500/10" :
                      isNegative ? "border-amber-500/30 bg-amber-500/10" :
                                   "border-border bg-muted/30"
                    }`}>
                      <span className={`text-sm whitespace-nowrap ${isActive ? "font-bold text-primary" : "font-medium"}`}>
                        {row.name}
                      </span>
                      <span className={`flex items-center gap-1 text-xs font-bold px-1.5 py-0.5 rounded-full ${
                        isPositive ? "bg-green-500/20 text-green-700" :
                        isNegative ? "bg-amber-500/20 text-amber-700" :
                                     "bg-muted-foreground/20 text-muted-foreground"
                      }`}>
                        {isPositive ? <TrendingUp className="h-3 w-3" /> :
                         isNegative ? <TrendingDown className="h-3 w-3" /> :
                                      <Minus className="h-3 w-3" />}
                        <span className="dir-ltr">{isPositive ? "+" : ""}{row.balance.toLocaleString("en-US", { minimumFractionDigits: 0 })} EGP</span>
                      </span>
                    </div>
                  </Link>
                </QuickActions>
              )
            })}
          </div>
        </div>
      )}

      {/* Removed old EmployeeFilter dropdown */}

      {/* List */}
      {displayed.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed">
          <ClipboardList className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-medium">لا توجد عهد بعد</h3>
          <p className="text-muted-foreground mt-2 max-w-sm">
            {eligibleEmployees.length === 0
              ? 'فعّل خيار "مسموح له بالعهد" لأحد الموظفين أولاً.'
              : "اضغط على إضافة عهدة لتسجيل أول عهدة."}
          </p>
          <Link href="?modal=add-custody" scroll={false} className="mt-6">
            <Button>إضافة عهدة</Button>
          </Link>
        </Card>
      ) : (
        <div className="grid gap-4">
          {displayed.map(custody => {
            const signedUrl = custody.file_path ? signedUrls[custody.file_path] : null
            const fileIsImage = isImagePath(custody.file_path)
            const isApproved = !!custody.approved_at

            return (
              <QuickActions key={custody.id} menuContent={
                <div className="flex flex-col gap-0.5 w-full">
                  {!isApproved && canApprove && (
                    <form action={async () => { "use server"; await approveCustody(custody.id) }}>
                      <Button type="submit" variant="ghost" className="w-full justify-start h-9 px-2 text-green-600 hover:text-green-700 hover:bg-green-500/10">
                        <BadgeCheck className="h-4 w-4 ml-2" />
                        اعتماد العهدة
                      </Button>
                    </form>
                  )}

                  {isApproved && canUnapprove && (
                    <form action={async () => { "use server"; await unapproveCustody(custody.id) }}>
                      <Button type="submit" variant="ghost" className="w-full justify-start h-9 px-2 text-amber-600 hover:text-amber-700 hover:bg-amber-500/10">
                        <ShieldAlert className="h-4 w-4 ml-2" />
                        إلغاء الاعتماد
                      </Button>
                    </form>
                  )}

                  {(!isApproved || canEditApproved) && (
                    <Link href={`?modal=edit-custody&edit_custody=${custody.id}`} scroll={false} className="w-full">
                      <Button variant="ghost" className="w-full justify-start h-9 px-2">
                        <Pencil className="h-4 w-4 ml-2" />
                        تعديل
                      </Button>
                    </Link>
                  )}

                  {(!isApproved || canEditApproved) && (
                    <div className="w-full flex items-center pr-1 hover:bg-muted rounded-md transition-colors">
                      <DeleteConfirmButton
                        itemName={custody.item}
                        action={async () => { "use server"; await deleteCustody(custody.id) }}
                      />
                      <span className="text-sm font-medium text-destructive pointer-events-none pr-1">حذف العهدة</span>
                    </div>
                  )}
                </div>
              }>
                <Card className={`transition-shadow hover:shadow-md cursor-context-menu ${isApproved ? "border-green-500/30 bg-green-500/5" : ""}`}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-4">
                      {/* Icon */}
                      <div className={`h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${isApproved ? "bg-green-500/15" : "bg-blue-500/10"}`}>
                        {isApproved
                          ? <BadgeCheck className="h-5 w-5 text-green-600" />
                          : <Package className="h-5 w-5 text-blue-600" />}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-base">{custody.item}</span>
                          <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 border border-blue-500/20 dir-ltr">
                            {Number(custody.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })} EGP
                          </span>
                          {/* File Icon */}
                          {signedUrl && (
                            <div className="flex items-center shrink-0">
                              {fileIsImage ? (
                                <ImageLightbox src={signedUrl} alt={custody.item} iconOnly />
                              ) : (
                                <a href={signedUrl} target="_blank" rel="noopener noreferrer" title="عرض المستند"
                                  className="h-6 w-6 rounded-full flex items-center justify-center bg-primary/10 border border-primary/25 hover:bg-primary/20 transition-colors shrink-0 group">
                                  <FileText className="h-3.5 w-3.5 text-primary group-hover:scale-110 transition-transform" />
                                </a>
                              )}
                            </div>
                          )}
                          {/* Approval badge */}
                          {isApproved ? (
                            <>
                              <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-500/10 text-green-700 border border-green-500/20">
                                <BadgeCheck className="h-3 w-3" /> معتمد
                              </span>
                              {Number(custody.funded_amount) > 0 && (
                                <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-700">
                                  صرف جزئي ({Number(custody.funded_amount).toLocaleString("en-US", { minimumFractionDigits: 2 })})
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                              في الانتظار
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
                          <span className="flex items-center gap-1 text-sm text-muted-foreground">
                            <User className="h-3.5 w-3.5" />{(custody.employees as any)?.name || "—"}
                          </span>
                          <span className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Calendar className="h-3.5 w-3.5" />{formatDate(custody.date)}
                          </span>
                          {isApproved && (
                            <span className="text-xs text-green-700">
                              اعتمد في {formatDate(custody.approved_at)}
                            </span>
                          )}
                        </div>

                        {custody.notes && (
                          <p className="text-sm text-muted-foreground mt-1.5 italic">{custody.notes}</p>
                        )}

                        {/* Removed File section to top row */}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </QuickActions>
            )
          })}
        </div>
      )}

      <AddCustodyModal
        eligibleEmployees={eligibleEmployees}
        preselectedEmployeeId={!seeAllCustodies ? myEmployeeId : null}
        projects={safeProjects}
      />
      <EditCustodyModal
        custodies={safeCustodies}
        eligibleEmployees={eligibleEmployees}
        projects={safeProjects}
      />

      <Modal name="employee-balances" title="القائمة التفصيلية لأرصدة الموظفين" description="اختر موظفاً من القائمة لعرض وتصفية العهد الخاصة به.">
        <div className="flex flex-col gap-2 mt-4 max-h-[60vh] overflow-y-auto pr-1">
          {balanceRows.map(row => {
            const isPositive = row.balance > 0
            const isNegative = row.balance < 0
            const isActive = filterEmployeeId === row.eid

            const sp = new URLSearchParams()
            if (filterStatus) sp.set("status", filterStatus)
            if (!isActive) sp.set("employee_id", row.eid)
            const href = `?${sp.toString()}`

            return (
              <Link key={row.eid} href={href} scroll={false} className="block focus:outline-none">
                <Card className={`border transition-all hover:shadow-md cursor-pointer ${
                  isActive ? "ring-2 ring-primary shadow-sm" : "hover:border-primary/40"
                } ${
                  isPositive ? "border-green-500/20 bg-green-500/5" :
                  isNegative ? "border-amber-500/20 bg-amber-500/5" :
                               "border-border"
                }`}>
                  <CardContent className="p-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className={`text-sm truncate ${isActive ? "font-bold text-primary" : "font-medium"}`}>
                        {row.name}
                      </span>
                      <span className={`flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full shrink-0 ${
                        isPositive ? "bg-green-500/10 text-green-700" :
                        isNegative ? "bg-amber-500/10 text-amber-700" :
                                     "bg-muted text-muted-foreground"
                      }`}>
                        {isPositive ? <TrendingUp className="h-3 w-3" /> :
                         isNegative ? <TrendingDown className="h-3 w-3" /> :
                                      <Minus className="h-3 w-3" />}
                        {isPositive ? "+" : ""}{row.balance.toLocaleString("en-US", { minimumFractionDigits: 0 })} EGP
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground mt-1">
                      <span className="flex items-center gap-1">
                        <Wallet className="h-3 w-3" />
                        مدفوع: <strong className="text-foreground">{row.paidTotal.toLocaleString("en-US")}</strong>
                      </span>
                      <span className="flex items-center gap-1">
                        <ClipboardList className="h-3 w-3" />
                        عهد: <strong className="text-foreground">{row.custodyTotal.toLocaleString("en-US")}</strong>
                      </span>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            )
          })}
        </div>
      </Modal>
    </div>
  )
}
