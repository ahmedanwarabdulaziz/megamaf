import * as React from "react"
import Link from "next/link"
import { LogOut } from "lucide-react"
import { logout } from "@/app/(auth)/login/actions"
import { Modal } from "@/components/ui/modal"
import { QuickActions } from "@/components/ui/quick-actions"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/server"

import { SidebarNav } from "./_components/sidebar-nav"
import { MobileNav } from "./_components/mobile-nav"

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  let profile = null
  if (user) {
    const { data } = await supabase.from('profiles').select('*, companies(name)').eq('id', user.id).single()
    profile = data
  }

  // ─── Determine page access for employee accounts ─────────────────────────
  let allowedPages: string[] | "all" = "all"

  if (profile?.role === "employee") {
    // Find the employee record linked to this auth user
    const { data: employee } = await supabase
      .from("employees")
      .select("is_super_admin, employee_page_access(page_slug)")
      .eq("auth_user_id", user!.id)
      .single()

    if (employee) {
      if (employee.is_super_admin) {
        allowedPages = "all"
      } else {
        const pageAccess = (employee.employee_page_access as { page_slug: string }[]) || []
        allowedPages = pageAccess.map(a => a.page_slug)
      }
    } else {
      allowedPages = [] // no access until configured
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  const demoActions = [
    {
      id: "edit-profile",
      label: "تعديل الملف الشخصي",
      modalTrigger: "demo-modal"
    },
    {
      id: "admin-action",
      label: "إعدادات المسؤول",
      roles: ["admin"]
    }
  ]

  return (
    <div className="flex h-screen bg-background">
      {/* Desktop Sidebar */}
      <aside className="hidden md:flex w-64 flex-col border-l border-border bg-card text-card-foreground">
        <div className="flex h-14 items-center px-4 border-b border-border font-semibold">
          {profile?.companies?.name || "الشركة"}
        </div>
        <SidebarNav allowedPages={allowedPages} />
        <div className="p-4 border-t border-border">
          <div className="mb-4 truncate text-sm">
            <p className="font-medium">{profile?.full_name || user?.email}</p>
            <p className="text-muted-foreground">{profile?.role}</p>
          </div>
          <form action={logout}>
            <button className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors">
              <LogOut className="h-5 w-5" />
              تسجيل الخروج
            </button>
          </form>
        </div>
      </aside>

      {/* Main Content wrapped in QuickActions */}
      <QuickActions actions={demoActions} userRole={profile?.role || "member"} className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Mobile Header */}
        <header className="md:hidden flex h-14 items-center px-4 border-b border-border bg-card justify-between">
          <div className="font-semibold">{profile?.companies?.name || "الشركة"}</div>
          <form action={logout}>
            <button className="text-destructive p-2 rounded-md hover:bg-destructive/10">
              <LogOut className="h-5 w-5" />
            </button>
          </form>
        </header>

        {/* Scrollable Main Area */}
        <main className="flex-1 overflow-y-auto p-4 md:p-6 pb-24 md:pb-6">
          {children}
        </main>


      </QuickActions>

      {/* Mobile Bottom Navigation */}
      <MobileNav allowedPages={allowedPages} />

      {/* Global Modals */}
      <Modal name="demo-modal" title="تعديل الملف الشخصي" description="قم بتغيير تفاصيل ملفك الشخصي هنا.">
        <div className="flex flex-col gap-4 mt-4">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">الاسم الكامل</label>
            <input
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              defaultValue={profile?.full_name || ""}
            />
          </div>
          <div className="flex justify-end gap-2 mt-2">
            <Button variant="default">حفظ التغييرات</Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
