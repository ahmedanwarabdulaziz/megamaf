import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { FAB } from "@/components/ui/fab"
import { PWAInstallPrompt } from "@/components/ui/pwa-install-prompt"
import { getProfile } from "@/lib/supabase/get-profile"

export default async function HomePage() {
  const { user, profile } = await getProfile()

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">لوحة القيادة</h1>
        <p className="text-muted-foreground mt-2">
          مرحباً {profile?.full_name || user?.email || ""}، النظام جاهز للبناء من جديد.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>نقطة البداية</CardTitle>
          <CardDescription>
            تم تجهيز هيكل أساسي نظيف. الاتصالات (Supabase و R2) وتسجيل الدخول
            ما زالت تعمل. ابدأ بإضافة الجداول والصفحات من هنا.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            لا توجد بيانات بعد.
          </p>
        </CardContent>
      </Card>

      {/* FAB opens the profile modal defined in the layout. */}
      <FAB modalTrigger="profile-modal" />
      <PWAInstallPrompt />
    </div>
  )
}
