import { createClient } from "@/lib/supabase/server"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Plus, Truck, Pencil, Trash2, Phone, Mail, FileText,
  Banknote, FolderKanban, ShieldCheck, BadgeCheck
} from "lucide-react"
import Link from "next/link"
import { AddVendorModal } from "@/components/modals/add-vendor-modal"
import { EditVendorModal } from "@/components/modals/edit-vendor-modal"
import { AddVendorPOModal } from "@/components/modals/add-vendor-po-modal"
import { deleteVendor } from "./actions"

function formatAmount(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default async function VendorsPage() {
  const supabase = await createClient()

  const [
    { data: vendors },
    { data: projects },
    { data: vendorProjectAccess },
    { data: vendorPos },
    { data: expenses }
  ] = await Promise.all([
    supabase.from("vendors").select("*").order("name", { ascending: true }),
    supabase.from("projects").select("id, name").order("name", { ascending: true }),
    supabase.from("vendor_project_access").select("vendor_id, project_id"),
    supabase.from("vendor_pos").select("vendor_id, amount"),
    supabase.from("expenses").select("vendor_id, amount").eq("payment_type", "vendor_payment"),
  ])

  const safeVendors = vendors || []
  const safeProjects = projects || []
  const safeProjectAccess = vendorProjectAccess || []
  const safeVendorPos = vendorPos || []
  const safeExpenses = expenses || []

  const projectMap = Object.fromEntries(safeProjects.map(p => [p.id, p.name]))

  // Calculate balances
  // Balance = Payments Made - POs Billed
  // > 0 means prepayment (vendor holds our money)
  // < 0 means payable (we owe the vendor)
  const vendorBalances = new Map<string, number>()
  for (const v of safeVendors) {
    vendorBalances.set(v.id, 0)
  }

  for (const exp of safeExpenses) {
    if (exp.vendor_id) {
      const current = vendorBalances.get(exp.vendor_id) || 0
      vendorBalances.set(exp.vendor_id, current + Number(exp.amount))
    }
  }

  for (const po of safeVendorPos) {
    if (po.vendor_id) {
      const current = vendorBalances.get(po.vendor_id) || 0
      vendorBalances.set(po.vendor_id, current - Number(po.amount))
    }
  }

  const suppliersCount = safeVendors.filter(v => v.type === "supplier" || v.type === "both").length
  const contractorsCount = safeVendors.filter(v => v.type === "contractor" || v.type === "both").length
  
  let totalPrepayments = 0
  let totalPayables = 0
  for (const bal of Array.from(vendorBalances.values())) {
    if (bal > 0) totalPrepayments += bal
    else if (bal < 0) totalPayables += Math.abs(bal)
  }

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      {/* Header */}
      <div className="static md:sticky md:top-0 z-20 bg-background/95 backdrop-blur-md pb-4 border-b border-border -mx-4 px-4 -mt-4 pt-4 md:-mx-6 md:px-6 md:-mt-6 md:pt-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">الموردون والمقاولون</h1>
          <p className="text-muted-foreground mt-2">إدارة الموردين والمقاولين، مشروعاتهم، وحساباتهم.</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="?modal=add-vendor" scroll={false}>
            <Button variant="default">
              <Plus className="mr-2 h-4 w-4" />
              إضافة مورد / مقاول
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">الإجمالي</p>
            <p className="text-3xl font-bold">{safeVendors.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">موردون / مقاولون</p>
            <p className="text-3xl font-bold text-primary">{suppliersCount} / {contractorsCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">دفعات مقدمة (لنا)</p>
            <p className="text-xl font-bold text-green-600">{formatAmount(totalPrepayments)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">مستحقات (علينا)</p>
            <p className="text-xl font-bold text-red-600">{formatAmount(totalPayables)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Vendors List */}
      {safeVendors.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed">
          <Truck className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-medium">لا يوجد موردون بعد</h3>
          <p className="text-muted-foreground mt-2 max-w-sm">
            قم بإضافة أول مورد أو مقاول للبدء في إدارة حساباته.
          </p>
          <Link href="?modal=add-vendor" scroll={false} className="mt-6">
            <Button>إضافة مورد جديد</Button>
          </Link>
        </Card>
      ) : (
        <div className="grid gap-4">
          {safeVendors.map(vendor => {
            const accessibleProjectNames = safeProjectAccess
              .filter(a => a.vendor_id === vendor.id)
              .map(a => projectMap[a.project_id])
              .filter(Boolean)

            const balance = vendorBalances.get(vendor.id) || 0

            return (
              <Card key={vendor.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    {/* Icon */}
                    <div className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0 bg-primary/10 text-primary">
                      <Truck className="h-5 w-5" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      {/* Name + badges */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-base">{vendor.name}</h3>
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full border bg-secondary text-secondary-foreground border-border">
                          {vendor.type === "supplier" ? "مورد" : vendor.type === "contractor" ? "مقاول" : "مورد ومقاول"}
                        </span>
                      </div>

                      {/* Details */}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5">
                        {vendor.phone && (
                          <span className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Phone className="h-3.5 w-3.5" /> {vendor.phone}
                          </span>
                        )}
                        {vendor.tax_number && (
                          <span className="flex items-center gap-1 text-sm text-muted-foreground">
                            <FileText className="h-3.5 w-3.5" /> ضريبي: {vendor.tax_number}
                          </span>
                        )}
                      </div>
                      
                      {/* Balance info */}
                      <div className="mt-2 flex items-center gap-2">
                        <span className="text-sm font-medium">الرصيد:</span>
                        {balance === 0 ? (
                          <span className="text-sm text-muted-foreground font-bold">0.00 EGP (مسوى)</span>
                        ) : balance > 0 ? (
                          <span className="text-sm text-green-600 font-bold dir-ltr">+{formatAmount(balance)} EGP (دفعة مقدمة)</span>
                        ) : (
                          <span className="text-sm text-red-600 font-bold dir-ltr">{formatAmount(balance)} EGP (مستحق للمورد)</span>
                        )}
                      </div>

                      {/* Project access */}
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {accessibleProjectNames.length > 0 ? (
                          accessibleProjectNames.map(name => (
                            <span key={name} className="flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-primary/5 text-primary border border-primary/20">
                              <FolderKanban className="h-3 w-3" /> {name}
                            </span>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground italic">غير مرتبط بأي مشروع</span>
                        )}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-col gap-1 shrink-0">
                      {/* Add PO */}
                      <Link href={`?modal=add-vendor-po&vendor_id=${vendor.id}`} scroll={false}>
                        <Button variant="outline" size="sm" className="w-full gap-1" title="إضافة فاتورة / مطالبة (PO)">
                          <FileText className="h-4 w-4" />
                          <span className="hidden sm:inline">إضافة مطالبة</span>
                        </Button>
                      </Link>

                      <div className="flex items-center gap-1 mt-1 justify-end">
                        {/* Edit vendor */}
                        <Link href={`?modal=edit-vendor&edit_vendor=${vendor.id}`} scroll={false}>
                          <Button variant="ghost" size="icon" className="h-8 w-8" title="تعديل بيانات المورد">
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </Link>
                        {/* Delete */}
                        <form action={async () => { "use server"; await deleteVendor(vendor.id) }}>
                          <Button type="submit" variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" title="حذف المورد">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </form>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Modals */}
      <AddVendorModal projects={safeProjects} />
      <EditVendorModal vendors={safeVendors} projects={safeProjects} vendorProjectAccess={safeProjectAccess} />
      <AddVendorPOModal vendors={safeVendors} projects={safeProjects} vendorProjectAccess={safeProjectAccess} />
    </div>
  )
}
