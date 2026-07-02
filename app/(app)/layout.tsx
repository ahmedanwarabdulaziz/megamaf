import * as React from "react"
import Link from "next/link"
import { Home, LogOut, Landmark, Receipt, CheckSquare, Users, Settings, FolderKanban, Wallet, FileText, FileSignature, Contact, Warehouse, ArrowLeftRight } from "lucide-react"
import { logout } from "@/app/(auth)/login/actions"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { getProfile } from "@/lib/supabase/get-profile"
import { PasskeyManager } from "@/components/profile/passkey-manager"
import { NotificationBell } from "@/components/ui/notification-bell"
import { MobileNav } from "@/components/layout/mobile-nav"
import { DesktopNav } from "@/components/layout/desktop-nav"

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { user, profile: employee } = await getProfile()
  // employee now includes is_super_admin, can_approve, employee_page_access — no second query needed
  const isSuperAdmin = employee?.is_super_admin || false
  const grantedPages = (employee?.employee_page_access as any[])?.map((p: any) => p.page_slug) || []

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

        <DesktopNav
          canSeeProjects={canSeeProjects}
          canSeeBanks={canSeeBanks}
          canSeeDeposits={canSeeDeposits}
          canSeeTreasury={canSeeTreasury}
          canSeeExpenses={canSeeExpenses}
          canApprove={isSuperAdmin || employee?.can_approve}
          canSeeVendors={canSeeVendors}
          canSeeClaims={canSeeClaims}
          canSeeInventory={canSeeInventory}
          canSeeEmployees={canSeeEmployees}
          canSeeSettings={canSeeSettings}
          canSeeOwners={canSeeOwners}
          isSuperAdmin={isSuperAdmin}
        />

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
            {/* Mobile: hamburger (MobileNav renders the button) */}
            <MobileNav
              employeeName={employee?.full_name || user?.email || ''}
              employeeRole={employee?.role === 'owner' ? 'المدير العام' : 'موظف'}
              canSeeProjects={canSeeProjects}
              canSeeBanks={canSeeBanks}
              canSeeDeposits={canSeeDeposits}
              canSeeTreasury={canSeeTreasury}
              canSeeExpenses={canSeeExpenses}
              canApprove={!!(isSuperAdmin || employee?.can_approve)}
              canSeeVendors={canSeeVendors}
              canSeeClaims={canSeeClaims}
              canSeeInventory={canSeeInventory}
              canSeeEmployees={canSeeEmployees}
              canSeeSettings={canSeeSettings}
              canSeeOwners={canSeeOwners}
              isSuperAdmin={isSuperAdmin}
            />
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
