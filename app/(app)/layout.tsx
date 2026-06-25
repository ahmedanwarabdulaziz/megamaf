import * as React from "react"
import Link from "next/link"
import { Home, LogOut, Landmark, Receipt, CheckSquare, Users, Settings, FolderKanban, Wallet, FileText, FileSignature, Contact, Warehouse, ArrowLeftRight } from "lucide-react"
import { logout } from "@/app/(auth)/login/actions"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { getProfile, getEmployeePermissions } from "@/lib/supabase/get-profile"
import { PasskeyManager } from "@/components/profile/passkey-manager"
import { NotificationBell } from "@/components/ui/notification-bell"

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, profile: employee } = await getProfile()
  const permissions = user ? await getEmployeePermissions(user.id) : null
  const isSuperAdmin = permissions?.is_super_admin || false
  const grantedPages = permissions?.employee_page_access?.map((p: any) => p.page_slug) || []

  const canSeeProjects = isSuperAdmin || grantedPages.includes('projects')
  const canSeeBanks = isSuperAdmin || grantedPages.includes('banks')
  const canSeeExpenses = isSuperAdmin || employee?.has_custody_access || grantedPages.includes('expenses')
  const canSeeTreasury = isSuperAdmin || grantedPages.includes('treasury/custody')
  const canSeeEmployees = isSuperAdmin || grantedPages.includes('employees')
  const canSeeSettings = isSuperAdmin || grantedPages.includes('settings')
  const canSeeVendors = isSuperAdmin || grantedPages.includes('vendors')
  const canSeeClaims = isSuperAdmin || grantedPages.includes('claims')
  const canSeeDeposits = isSuperAdmin || grantedPages.includes('deposits')
  const canSeeInventory = isSuperAdmin || grantedPages.includes('inventory')
  const canSeeOwners = isSuperAdmin || grantedPages.includes('owners')

  return (
    <div className="flex h-screen bg-background">
      {/* Desktop Sidebar — minimal skeleton */}
      <aside className="hidden md:flex w-64 flex-col border-l border-border bg-card text-card-foreground">
        <div className="flex h-14 items-center px-4 border-b border-border font-semibold">
          ميجا ماف
        </div>

        <nav className="flex-1 space-y-1 p-2">
          <Link
            href="/"
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Home className="h-5 w-5" />
            الرئيسية
          </Link>
          {canSeeProjects && (
            <Link
              href="/projects"
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="m8 6 4-4 4 4"/><path d="M12 2v10.3a4 4 0 0 1-1.172 2.872L4 22"/><path d="m20 22-5-5"/></svg>
              المشاريع
            </Link>
          )}
          {canSeeBanks && (
            <Link
              href="/banks"
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Landmark className="h-5 w-5" />
              البنوك
            </Link>
          )}
          {canSeeDeposits && (
            <Link
              href="/deposits"
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Wallet className="h-5 w-5" />
              الودائع والشهادات
            </Link>
          )}
          {canSeeTreasury && (
            <Link
              href="/treasury"
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <ArrowLeftRight className="h-5 w-5" />
              الخزينة والمدفوعات
            </Link>
          )}
          {canSeeTreasury && (
            <Link
              href="/treasury?tab=receivables"
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground pr-8"
            >
              <FileText className="h-4 w-4" />
              سندات القبض (تحصيل)
            </Link>
          )}
          {canSeeTreasury && (
            <Link
              href="/treasury?tab=payables"
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground pr-8"
            >
              <FileText className="h-4 w-4" />
              سندات الصرف (دفع)
            </Link>
          )}
          {canSeeTreasury && (
            <Link
              href="/treasury/custody"
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Wallet className="h-5 w-5" />
              صرف العهد
            </Link>
          )}
          {canSeeExpenses && (
            <Link
              href="/expenses"
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Receipt className="h-5 w-5" />
              المصروفات و العهد
            </Link>
          )}
          {(isSuperAdmin || employee?.can_approve) && (
            <Link
              href="/expenses/approvals"
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <CheckSquare className="h-5 w-5" />
              اعتمادات المصروفات
            </Link>
          )}
          {canSeeVendors && (
            <Link
              href="/vendors"
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Users className="h-5 w-5" />
              المقاولين والموردين
            </Link>
          )}
          {canSeeVendors && (
            <Link
              href="/invoices"
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <FileText className="h-5 w-5" />
              فواتير الموردين
            </Link>
          )}
          {canSeeClaims && (
            <Link
              href="/claims"
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <FileSignature className="h-5 w-5" />
              المستخلصات
            </Link>
          )}
          {canSeeInventory && (
            <Link
              href="/inventory"
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Warehouse className="h-5 w-5" />
              المخازن
            </Link>
          )}
          {canSeeEmployees && (
            <Link
              href="/employees"
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Users className="h-5 w-5" />
              الموظفين
            </Link>
          )}
          {canSeeSettings && (
            <Link
              href="/settings"
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg>
              الإعدادات
            </Link>
          )}
          {isSuperAdmin && (
            <Link
              href="/settings/expenses"
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Receipt className="h-5 w-5" />
              فئات المصروفات
            </Link>
          )}
          {canSeeOwners && (
            <Link
              href="/settings/owners"
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <Contact className="h-5 w-5" />
              الملاك
            </Link>
          )}
          {isSuperAdmin && (
            <Link
              href="/reports"
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>
              التقارير
            </Link>
          )}
        </nav>

        <div className="p-4 border-t border-border">
          <div className="mb-4 truncate text-sm">
            <p className="font-medium">{employee?.full_name || user?.email}</p>
            <p className="text-muted-foreground">{employee?.role === 'owner' ? 'المدير العام' : 'موظف'}</p>
          </div>
          <form action={logout}>
            <button className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors">
              <LogOut className="h-5 w-5" />
              تسجيل الخروج
            </button>
          </form>
        </div>
      </aside>

      {/* Main Content wrapped in React.Suspense so it doesn't block the initial
          server render of the surrounding layout. */}
      <React.Suspense
        fallback={
          <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
            <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6">
              {children}
            </main>
          </div>
        }
      >
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
          {/* Mobile Header + Global Desktop Topbar */}
          <header className="flex h-14 items-center justify-between border-b border-border bg-card px-4 md:justify-end">
            <div className="font-semibold md:hidden">
              ميجا ماف
            </div>
            <div className="flex items-center gap-2">
              <NotificationBell />
            </div>
          </header>

          <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6">
            {children}
          </main>
        </div>
      </React.Suspense>

      {/* Global Modals — Modal calls useSearchParams(), wrap in Suspense
          so it doesn't interrupt the static render of the rest of the layout. */}
      <React.Suspense fallback={null}>
        <Modal
          name="profile-modal"
          title="تعديل الملف الشخصي"
          description="إدارة معلومات الحساب وتفضيلات الأمان."
        >
          <div className="flex flex-col gap-6 mt-4">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">الاسم الكامل</label>
              <input
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                defaultValue={employee?.full_name || ""}
              />
              <div className="flex justify-end gap-2 mt-2">
                <Button variant="default">حفظ التغييرات</Button>
              </div>
            </div>

            <div className="h-px bg-border w-full" />

            <PasskeyManager />
          </div>
        </Modal>
      </React.Suspense>
    </div>
  )
}
