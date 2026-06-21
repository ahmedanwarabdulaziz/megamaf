import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { FAB } from "@/components/ui/fab"
import { PWAInstallPrompt } from "@/components/ui/pwa-install-prompt"

export default function HomePage() {
  return (
    <div className="max-w-4xl mx-auto flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">لوحة القيادة</h1>
        <p className="text-muted-foreground mt-2">
          مرحباً بك في نظام الإدارة.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>مرحباً</CardTitle>
            <CardDescription>ابدأ مع المرحلة الأولى</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              استخدم القائمة الجانبية للتنقل بين الأقسام.
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Only show FAB and PWA install prompt on the home page */}
      <FAB modalTrigger="profile-modal" />
      <PWAInstallPrompt />
    </div>
  )
}
