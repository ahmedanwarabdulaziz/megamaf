import { createClient } from "@/lib/supabase/server"
import { createR2Client, R2_BUCKET } from "@/lib/r2"
import { GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Plus, ClipboardList, Pencil, Calendar, User,
  FileText, Package, BadgeCheck, ShieldAlert,
  TrendingDown, TrendingUp, Minus, Wallet,
} from "lucide-react"
import Link from "next/link"
import { AddCustodyModal } from "@/components/modals/add-custody-modal"
import { EditCustodyModal } from "@/components/modals/edit-custody-modal"
import { EmployeeFilter } from "./_components/employee-filter"
import { CustodySummary } from "./_components/custody-summary"
import { ImageLightbox } from "@/components/ui/image-lightbox"
import { DeleteConfirmButton } from "@/components/ui/delete-confirm-button"
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
  const supabase = await createClient()
  const { employee_id: filterEmployeeId, status: filterStatus = "" } = await searchParams

  // Fetch current user permissions
  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user!.id).single()

  let canApprove = false
  let canUnapprove = false
  let canEditApproved = false
  let seeAllCustodies = false   // false = only own custodies
  let myEmployeeId: string | null = null

  if (profile?.role === "admin" || profile?.role === "member") {
    canApprove = true; canUnapprove = true; canEditApproved = true; seeAllCustodies = true
  } else if (profile?.role === "employee") {
    const { data: emp } = await supabase
      .from("employees")
      .select("id, is_super_admin, can_approve_custodies")
      .eq("auth_user_id", user!.id)
      .single()
    myEmployeeId = emp?.id ?? null
    if (emp?.is_super_admin) {
      canApprove = true; canUnapprove = true; canEditApproved = true; seeAllCustodies = true
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
  if (!seeAllCustodies && myEmployeeId) {
    custodiesQuery = custodiesQuery.eq("employee_id", myEmployeeId) as any
  }

  const [{ data: custodies }, { data: employees }, { data: bankAccountsRaw }, { data: employeePayments }, { data: projects }] = await Promise.all([
    custodiesQuery,
    supabase.from("employees").select("id, name, job_title, can_have_custody").order("name"),
    supabase.from("bank_accounts").select("id, account_name, banks(name)").order("account_name"),
    // Fetch total payments made per employee (advances + direct custody payments)
    supabase.from("expenses").select("employee_id, amount, payment_type")
      .not("employee_id", "is", null),
    supabase.from("projects").select("id, name, is_company_branch").order("name"),
  ])

  const safeCustodies = (custodies || []).filter(c => !c.funded_at) // funded ones live on expenses page
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

  // Generate R2 signed URLs in parallel
  const filePaths = displayed.filter(c => c.file_path).map(c => c.file_path as string)
  const signedUrls: Record<string, string> = {}
  if (filePaths.length > 0) {
    const r2 = createR2Client()
    await Promise.all(filePaths.map(async (path) => {
      try {
        signedUrls[path] = await getSignedUrl(r2, new GetObjectCommand({ Bucket: R2_BUCKET, Key: path }), { expiresIn: 3600 })
      } catch { }
    }))
  }

  const notApprovedCount = displayed.filter(c => !c.approved_at).length
  const approvedCount = displayed.filter(c => !!c.approved_at).length
  const notApprovedAmount = displayed.filter(c => !c.approved_at).reduce((s, c) => s + Number(c.amount), 0)
  const approvedAmount = displayed.filter(c => !!c.approved_at).reduce((s, c) => s + Number(c.amount), 0)
  const totalAmount = notApprovedAmount + approvedAmount

  // ── Per-employee balance ──────────────────────────────────────────────────
  // Total approved custody amounts per employee (all custodies, funded or not)
  const allApprovedCustodies = (custodies || []).filter(c => !!c.approved_at)
  const custodyByEmployee: Record<string, { name: string; custodyTotal: number }> = {}
  for (const c of allApprovedCustodies) {
    const emp = (c as any).employees
    const name = emp?.name ?? "غير معروف"
    if (!custodyByEmployee[c.employee_id]) custodyByEmployee[c.employee_id] = { name, custodyTotal: 0 }
    custodyByEmployee[c.employee_id].custodyTotal += Number(c.amount)
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

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      {/* Header */}
      <div className="static md:sticky md:top-0 z-20 bg-background/95 backdrop-blur-md pb-4 border-b border-border -mx-4 px-4 -mt-4 pt-4 md:-mx-6 md:px-6 md:-mt-6 md:pt-6 mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold tracking-tight">العهد</h1>
          <Link href="?modal=add-custody" scroll={false} className="ml-auto">
            <Button variant="default" size="icon" className="h-8 w-8 rounded-full shrink-0" title="إضافة عهدة">
              <Plus className="h-4 w-4" />
            </Button>
          </Link>
        </div>
        <p className="text-muted-foreground mt-1.5">إدارة عهد الموظفين ومستنداتها.</p>
      </div>

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
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">رصيد الموظفين</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {balanceRows.map(row => {
              const isPositive = row.balance > 0
              const isNegative = row.balance < 0
              return (
                <Card key={row.eid} className={`border ${
                  isPositive ? "border-green-500/20 bg-green-500/5" :
                  isNegative ? "border-amber-500/20 bg-amber-500/5" :
                               "border-border"
                }`}>
                  <CardContent className="p-3 flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium truncate">{row.name}</span>
                      <span className={`flex items-center gap-1 text-xs font-bold px-2 py-0.5 rounded-full ${
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
                    <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Wallet className="h-3 w-3" />
                        مدفوع: <strong className="text-foreground">{row.paidTotal.toLocaleString("en-US")}</strong>
                      </span>
                      <span className="flex items-center gap-1">
                        <ClipboardList className="h-3 w-3" />
                        عهد: <strong className="text-foreground">{row.custodyTotal.toLocaleString("en-US")}</strong>
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {isPositive ? `✓ لديه ${row.balance.toLocaleString("en-US")} EGP رصيد زائد` :
                       isNegative ? `⚠ يحتاج ${Math.abs(row.balance).toLocaleString("en-US")} EGP إضافية` :
                                    "✓ الحساب متوازن"}
                    </p>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      )}

      {/* Employee Filter */}
      {seeAllCustodies && safeEmployees.length > 0 && (
        <div className="flex items-center gap-3">
          <User className="h-4 w-4 text-muted-foreground shrink-0" />
          <EmployeeFilter employees={safeEmployees} currentEmployeeId={filterEmployeeId} />
        </div>
      )}

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
              <Card key={custody.id} className={`transition-shadow hover:shadow-md ${isApproved ? "border-green-500/30 bg-green-500/5" : ""}`}>
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
                        {/* Approval badge */}
                        {isApproved ? (
                          <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-green-500/10 text-green-700 border border-green-500/20">
                            <BadgeCheck className="h-3 w-3" /> معتمد
                          </span>
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

                      {/* File */}
                      {signedUrl && (
                        <div className="mt-2">
                          {fileIsImage ? (
                            <ImageLightbox src={signedUrl} alt={custody.item} />
                          ) : (
                            <a href={signedUrl} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                              <FileText className="h-4 w-4" />عرض المستند
                            </a>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex flex-col gap-1 shrink-0">
                      {/* Approve — simple one-click, payment happens on /payments */}
                      {!isApproved && canApprove && (
                        <form action={async () => { "use server"; await approveCustody(custody.id) }}>
                          <Button type="submit" variant="ghost" size="icon"
                            className="h-8 w-8 text-green-600 hover:bg-green-500/10"
                            title="اعتماد العهدة">
                            <BadgeCheck className="h-4 w-4" />
                          </Button>
                        </form>
                      )}

                      {/* Unapprove — super admin only */}
                      {isApproved && canUnapprove && (
                        <form action={async () => { "use server"; await unapproveCustody(custody.id) }}>
                          <Button type="submit" variant="ghost" size="icon"
                            className="h-8 w-8 text-amber-600 hover:bg-amber-500/10"
                            title="إلغاء الاعتماد">
                            <ShieldAlert className="h-4 w-4" />
                          </Button>
                        </form>
                      )}

                      {/* Edit — hidden for approved unless canEditApproved */}
                      {(!isApproved || canEditApproved) && (
                        <Link href={`?modal=edit-custody&edit_custody=${custody.id}`} scroll={false}>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </Link>
                      )}

                      {/* Delete */}
                      {(!isApproved || canEditApproved) && (
                        <DeleteConfirmButton
                          itemName={custody.item}
                          action={async () => { "use server"; await deleteCustody(custody.id) }}
                        />
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
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
    </div>
  )
}
