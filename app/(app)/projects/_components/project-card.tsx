"use client"

import { formatMoney } from "@/lib/money"
import { Building2, Home, GitBranch, Layers, ChevronLeft, Pencil, Trash2, TrendingUp, TrendingDown, ArrowLeftRight } from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { Progress } from "@/components/ui/progress"

const colorStyles = {
  main_company: "from-blue-500/10 to-indigo-500/10 border-blue-200/50 dark:border-blue-800/30",
  project: "from-emerald-500/10 to-teal-500/10 border-emerald-200/50 dark:border-emerald-800/30",
  branch: "from-purple-500/10 to-fuchsia-500/10 border-purple-200/50 dark:border-purple-800/30",
  phase: "from-amber-500/10 to-orange-500/10 border-amber-200/50 dark:border-amber-800/30"
}

const iconMap = {
  main_company: Building2,
  project: Home,
  branch: GitBranch,
  phase: Layers
}

const labelMap = {
  main_company: "الشركة الرئيسية",
  project: "مشروع",
  branch: "فرع",
  phase: "مرحلة"
}

export function ProjectCard({ project, onDelete }: { project: any; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const nodeType = project.node_type as keyof typeof colorStyles
  const Icon = iconMap[nodeType] || Home
  
  const fin = project.v_project_financial_position?.[0] || {}
  
  // Extract financial data
  const ownerBilled = Number(fin.owner_billed || 0)
  const ownerPaid = Number(fin.owner_paid || 0)
  
  const vendorClaimsBilled = Number(fin.vendor_claims_billed || 0)
  const vendorClaimsPaid = Number(fin.vendor_claims_paid || 0)
  
  const invoicesBilled = Number(fin.invoices_billed || 0)
  const invoicesPaid = Number(fin.invoices_paid || 0)
  
  const empExpBilled = Number(fin.employee_expenses_billed || 0)
  const empExpPaid = Number(fin.employee_expenses_paid || 0)
  
  const totalExpBilled = vendorClaimsBilled + invoicesBilled + empExpBilled
  const totalExpPaid = vendorClaimsPaid + invoicesPaid + empExpPaid
  
  const inventoryValue = Number(fin.inventory_asset_value || 0)
  
  const netExpenses = totalExpBilled - inventoryValue
  const netProfit = ownerBilled - netExpenses
  const profitMargin = ownerBilled > 0 ? (netProfit / ownerBilled) * 100 : 0

  const getPercentage = (paid: number, billed: number) => {
    if (billed === 0) return 0
    return Math.min(100, Math.round((paid / billed) * 100))
  }

  return (
    <div className={`group relative overflow-hidden rounded-2xl border bg-gradient-to-br ${colorStyles[nodeType] || colorStyles.project} shadow-sm transition-all hover:shadow-md`}>
      <div className="absolute inset-0 bg-background/60 backdrop-blur-3xl -z-10" />
      
      {/* Header section */}
      <div className="p-5 border-b border-border/50 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-background shadow-sm border border-border/50">
            <Icon className="w-5 h-5 text-primary" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <Link href={`/projects/${project.id}`} className="text-xl font-bold hover:text-primary transition-colors">
                {project.name}
              </Link>
              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border">
                {labelMap[nodeType] || "مشروع"}
              </span>
              {project.status === "closed" && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-destructive/10 text-destructive border border-destructive/20">
                  مغلق
                </span>
              )}
            </div>
            <div className="text-sm text-muted-foreground mt-1 flex items-center gap-3">
              {project.code && <span>كود: {project.code}</span>}
              {project.project_owners?.name && <span>المالك: {project.project_owners.name}</span>}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
          <Link href={`?modal=edit-project&id=${project.id}`} scroll={false} className="p-2 rounded-lg hover:bg-muted text-muted-foreground transition-colors">
            <Pencil className="w-4 h-4" />
          </Link>
          {!project.is_main && (
            confirming ? (
              <div className="flex items-center gap-1 bg-destructive/10 rounded-lg p-1 border border-destructive/20">
                <span className="text-xs text-destructive px-2 font-medium">حذف؟</span>
                <button onClick={onDelete} className="text-xs bg-destructive text-destructive-foreground px-2 py-1 rounded-md hover:bg-destructive/90">نعم</button>
                <button onClick={() => setConfirming(false)} className="text-xs bg-background text-foreground px-2 py-1 rounded-md border hover:bg-muted">لا</button>
              </div>
            ) : (
              <button onClick={() => setConfirming(true)} className="p-2 rounded-lg hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            )
          )}
          <Link href={`/projects/${project.id}`} className="flex items-center gap-1 text-sm font-medium text-primary bg-primary/10 hover:bg-primary/20 px-4 py-2 rounded-lg transition-colors">
            التفاصيل <ChevronLeft className="w-4 h-4" />
          </Link>
        </div>
      </div>

      {/* Financial Details */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 p-5">
        
        {/* Column 1: Income (Owner Claims) */}
        <div className="space-y-4">
          <h3 className="font-semibold text-sm text-muted-foreground flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-blue-500" />
            مستخلصات المالك (الإيرادات)
          </h3>
          <div className="p-4 rounded-xl bg-background border border-border/50 shadow-sm">
            <div className="flex justify-between items-end mb-2">
              <div>
                <p className="text-xs text-muted-foreground mb-1">المعتمد</p>
                <p className="font-bold text-lg">{formatMoney(ownerBilled)}</p>
              </div>
              <div className="text-left">
                <p className="text-xs text-muted-foreground mb-1">المدفوع فعلياً</p>
                <p className="font-bold text-blue-600 dark:text-blue-400">{formatMoney(ownerPaid)}</p>
              </div>
            </div>
            <Progress value={getPercentage(ownerPaid, ownerBilled)} className="h-1.5" indicatorColor="bg-blue-500" />
            <p className="text-[10px] text-muted-foreground mt-1.5 text-left">{getPercentage(ownerPaid, ownerBilled)}% محصل</p>
          </div>
        </div>

        {/* Column 2: Expenses Breakdown */}
        <div className="space-y-4 lg:col-span-2">
          <h3 className="font-semibold text-sm text-muted-foreground flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-500" />
            تفاصيل المصروفات
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {/* Vendor Claims */}
            <div className="p-3 rounded-xl bg-background border border-border/50 shadow-sm">
              <p className="text-xs font-medium mb-2">مستخلصات المقاولين</p>
              <div className="flex justify-between items-baseline mb-1">
                <span className="text-[10px] text-muted-foreground">معتمد:</span>
                <span className="text-sm font-semibold">{formatMoney(vendorClaimsBilled)}</span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-[10px] text-muted-foreground">مدفوع:</span>
                <span className="text-sm font-bold text-amber-600 dark:text-amber-400">{formatMoney(vendorClaimsPaid)}</span>
              </div>
              <Progress value={getPercentage(vendorClaimsPaid, vendorClaimsBilled)} className="h-1 mt-2" indicatorColor="bg-amber-500" />
            </div>
            
            {/* Vendor POs */}
            <div className="p-3 rounded-xl bg-background border border-border/50 shadow-sm">
              <p className="text-xs font-medium mb-2">فواتير ومشتريات</p>
              <div className="flex justify-between items-baseline mb-1">
                <span className="text-[10px] text-muted-foreground">معتمد:</span>
                <span className="text-sm font-semibold">{formatMoney(invoicesBilled)}</span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-[10px] text-muted-foreground">مدفوع:</span>
                <span className="text-sm font-bold text-amber-600 dark:text-amber-400">{formatMoney(invoicesPaid)}</span>
              </div>
              <Progress value={getPercentage(invoicesPaid, invoicesBilled)} className="h-1 mt-2" indicatorColor="bg-amber-500" />
            </div>

            {/* Employee Expenses */}
            <div className="p-3 rounded-xl bg-background border border-border/50 shadow-sm">
              <p className="text-xs font-medium mb-2">مصروفات الموظفين</p>
              <div className="flex justify-between items-baseline mb-1">
                <span className="text-[10px] text-muted-foreground">معتمد:</span>
                <span className="text-sm font-semibold">{formatMoney(empExpBilled)}</span>
              </div>
              <div className="flex justify-between items-baseline">
                <span className="text-[10px] text-muted-foreground">مدفوع:</span>
                <span className="text-sm font-bold text-amber-600 dark:text-amber-400">{formatMoney(empExpPaid)}</span>
              </div>
              <Progress value={getPercentage(empExpPaid, empExpBilled)} className="h-1 mt-2" indicatorColor="bg-amber-500" />
            </div>
          </div>
        </div>

        {/* Column 3: Summary & Profit */}
        <div className="space-y-4">
          <h3 className="font-semibold text-sm text-muted-foreground flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500" />
            الملخص والأرباح
          </h3>
          <div className="p-4 rounded-xl bg-background border border-border/50 shadow-sm space-y-3">
            <div className="flex justify-between items-center pb-2 border-b border-border/50">
              <span className="text-xs text-muted-foreground">إجمالي المصروفات</span>
              <span className="text-sm font-bold text-red-500">{formatMoney(totalExpBilled)}</span>
            </div>
            <div className="flex justify-between items-center pb-2 border-b border-border/50">
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <ArrowLeftRight className="w-3 h-3" />
                خصم قيمة المخزن
              </span>
              <span className="text-sm font-bold text-emerald-500">+{formatMoney(inventoryValue)}</span>
            </div>
            
            <div className="pt-2">
              <div className="flex justify-between items-end">
                <span className="text-sm font-semibold">صافي الربح</span>
                <div className="text-left">
                  <div className={`text-lg font-black ${netProfit >= 0 ? 'text-emerald-500' : 'text-destructive'} flex items-center gap-1`}>
                    {netProfit >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                    {formatMoney(netProfit)}
                  </div>
                  <span className={`text-xs font-bold ${netProfit >= 0 ? 'text-emerald-600/70 dark:text-emerald-400/70' : 'text-destructive/70'}`}>
                    {profitMargin.toFixed(1)}% هامش
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
