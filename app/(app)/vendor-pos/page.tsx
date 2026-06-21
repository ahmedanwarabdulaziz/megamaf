import { createClient } from "@/lib/supabase/server"
import { getProfile, getEmployeePermissions } from "@/lib/supabase/get-profile"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  FileText, FolderKanban, Truck, Calendar, Trash2
} from "lucide-react"
import Link from "next/link"
import { AddVendorPOModal } from "@/components/modals/add-vendor-po-modal"
import { VendorFilter } from "./_components/vendor-filter"
import { DeleteConfirmButton } from "@/components/ui/delete-confirm-button"
import { deleteVendorPO } from "./actions"

function formatDate(dateStr: string | null) {
  if (!dateStr) return null
  return new Date(dateStr).toLocaleDateString("ar-EG", { year: "numeric", month: "short", day: "numeric" })
}

function formatAmount(n: number) {
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)
}

export default async function VendorPOsPage({
  searchParams,
}: {
  searchParams: Promise<{ vendor_id?: string; project_id?: string; month?: string }>
}) {
  const { user, profile, supabase } = await getProfile()
  const searchParamsResolved = await searchParams
  const filterVendorId = searchParamsResolved.vendor_id
  const filterProjectId = searchParamsResolved.project_id
  
  const currentMonth = new Date().toISOString().substring(0, 7)
  const filterMonth = searchParamsResolved.month ?? currentMonth

  let seeAllProjects = false
  let myEmployeeId: string | null = null

  if (profile?.role === "admin" || profile?.role === "member") {
    seeAllProjects = true
  } else if (profile?.role === "employee" && user) {
    const emp = await getEmployeePermissions(user.id)
    myEmployeeId = emp?.id ?? null
    if (emp?.is_super_admin) {
      seeAllProjects = true
    }
  }

  // Fetch POs
  let posQuery = supabase
    .from("vendor_pos")
    .select("*, vendors(id, name, type), projects(id, name)")
    .order("po_date", { ascending: false })
    .order("created_at", { ascending: false })

  if (filterVendorId) {
    posQuery = posQuery.eq("vendor_id", filterVendorId) as any
  }
  if (filterProjectId) {
    posQuery = posQuery.eq("project_id", filterProjectId) as any
  }
  if (filterMonth) {
    const startOfMonth = `${filterMonth}-01`
    // to get end of month, we can just do < next month
    const [y, m] = filterMonth.split("-")
    const nextM = Number(m) === 12 ? 1 : Number(m) + 1
    const nextY = Number(m) === 12 ? Number(y) + 1 : Number(y)
    const endOfMonth = `${nextY}-${nextM.toString().padStart(2, "0")}-01`
    posQuery = posQuery.gte("po_date", startOfMonth).lt("po_date", endOfMonth) as any
  }

  // Restrict projects for regular employees
  let projectsQuery = supabase.from("projects").select("id, name").order("name")
  if (!seeAllProjects && myEmployeeId) {
    const { data: access } = await supabase
      .from("employee_project_access")
      .select("project_id")
      .eq("employee_id", myEmployeeId)
    
    const allowedProjectIds = access?.map(a => a.project_id) || []
    if (allowedProjectIds.length > 0) {
      projectsQuery = projectsQuery.in("id", allowedProjectIds) as any
      posQuery = posQuery.in("project_id", allowedProjectIds) as any
    } else {
      projectsQuery = projectsQuery.eq("id", "00000000-0000-0000-0000-000000000000") as any
      posQuery = posQuery.eq("project_id", "00000000-0000-0000-0000-000000000000") as any
    }
  }

  const [{ data: pos }, { data: vendors }, { data: projects }] = await Promise.all([
    posQuery,
    supabase.from("vendors").select("id, name").order("name"),
    projectsQuery,
  ])

  const safePos = pos || []
  const safeVendors = vendors || []
  const safeProjects = projects || []
  
  // Need project access for the Add modal
  const { data: projectAccess } = await supabase.from("vendor_project_access").select("vendor_id, project_id")
  const safeProjectAccess = projectAccess || []

  const totalAmount = safePos.reduce((sum, po) => sum + Number(po.amount), 0)

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" />
            مطالبات الموردين والمقاولين
          </h1>
          <p className="text-muted-foreground mt-1">سجل فواتير ومطالبات الموردين والمقاولين.</p>
        </div>
        <Link href="?modal=add-vendor-po" scroll={false}>
          <Button className="w-full sm:w-auto shadow-sm gap-2">
            <FileText className="h-4 w-4" />
            إضافة مطالبة
          </Button>
        </Link>
      </div>

      <VendorFilter vendors={safeVendors} projects={safeProjects} />

      <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-4">
        <div className="p-3 bg-primary/10 text-primary rounded-xl shrink-0">
          <FileText className="h-6 w-6" />
        </div>
        <div>
          <div className="text-sm font-medium text-muted-foreground">إجمالي المطالبات في هذه القائمة</div>
          <div className="text-2xl font-bold font-mono">{formatAmount(totalAmount)} EGP</div>
        </div>
      </div>

      {safePos.length === 0 ? (
        <div className="text-center py-16 bg-card border border-border rounded-xl shadow-sm">
          <FileText className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
          <h3 className="text-lg font-semibold mb-1">لا توجد مطالبات</h3>
          <p className="text-muted-foreground">لم يتم العثور على مطالبات مطابقة لبحثك.</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {safePos.map((po: any) => {
            const vendor = po.vendors as any
            const project = po.projects as any
            const totalAmt = Number(po.amount)
            const paidAmt = Number(po.paid_amount || 0)
            const isFullyPaid = paidAmt >= totalAmt
            const isPartiallyPaid = paidAmt > 0 && paidAmt < totalAmt

            return (
              <Card key={po.id} className="hover:shadow-md transition-all group">
                <CardContent className="p-4">
                  <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <div className="p-2.5 rounded-xl bg-purple-500/10 shrink-0 mt-0.5">
                        <Truck className="h-5 w-5 text-purple-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <h3 className="font-semibold text-base">{po.description}</h3>
                          {isFullyPaid ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-green-500/30 bg-green-500/10 text-green-700">مدفوعة</span>
                          ) : isPartiallyPaid ? (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-700">مدفوعة جزئياً ({formatAmount(paidAmt)} EGP)</span>
                          ) : (
                            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-500/30 bg-amber-500/10 text-amber-700">غير مدفوعة</span>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-2">
                          {vendor && (
                            <span className="flex items-center gap-1.5 text-sm text-muted-foreground font-medium">
                              <Truck className="h-3.5 w-3.5" />{vendor.name}
                            </span>
                          )}
                          {project && (
                            <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                              <FolderKanban className="h-3.5 w-3.5" />{project.name}
                            </span>
                          )}
                          <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                            <Calendar className="h-3.5 w-3.5" />{formatDate(po.po_date)}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center justify-between sm:justify-end w-full sm:w-auto gap-4 mt-2 sm:mt-0 pt-3 sm:pt-0 border-t sm:border-0 border-border">
                      <div className="font-bold text-lg font-mono dir-ltr">{formatAmount(Number(po.amount))} EGP</div>
                      {profile?.role === "admin" && (
                        <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                          <DeleteConfirmButton 
                            action={async () => { "use server"; await deleteVendorPO(po.id) }} 
                            itemName="هذه المطالبة" 
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Add PO Modal reusing existing component */}
      <AddVendorPOModal vendors={safeVendors} projects={safeProjects} vendorProjectAccess={safeProjectAccess} />
    </div>
  )
}
