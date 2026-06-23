import * as React from "react"
import Link from "next/link"
import { Home, LogOut } from "lucide-react"
import { logout } from "@/app/(auth)/login/actions"
import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { getProfile } from "@/lib/supabase/get-profile"
import { PasskeyManager } from "@/components/profile/passkey-manager"

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // getProfile() is memoized via React.cache() — calling it here and in a page
  // component will only ever produce ONE DB round-trip per request.
  const { user, profile } = await getProfile()

  return (
    <div className="flex h-screen bg-background">
      {/* Desktop Sidebar — minimal skeleton */}
      <aside className="hidden md:flex w-64 flex-col border-l border-border bg-card text-card-foreground">
        <div className="flex h-14 items-center px-4 border-b border-border font-semibold">
          {profile?.companies?.name || "الشركة"}
        </div>

        <nav className="flex-1 space-y-1 p-2">
          <Link
            href="/"
            className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
          >
            <Home className="h-5 w-5" />
            الرئيسية
          </Link>
        </nav>

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
                defaultValue={profile?.full_name || ""}
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
