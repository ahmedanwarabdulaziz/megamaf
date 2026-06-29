import { Suspense } from "react"
import { LoginForm } from "./login-form"
import { createAdminClient } from "@/lib/supabase/admin"

async function checkNoUsers(): Promise<boolean> {
  try {
    const admin = createAdminClient()
    const { count, error } = await admin
      .from("employees")
      .select("id", { count: "exact", head: true })
    if (error) return false
    return (count ?? 0) === 0
  } catch {
    return false
  }
}

export default async function LoginPage() {
  const noUsers = await checkNoUsers()

  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4 bg-background">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card text-card-foreground shadow-sm">
        <div className="flex flex-col space-y-1.5 p-6 text-center">
          <h1 className="text-2xl font-semibold leading-none tracking-tight">
            تسجيل الدخول
          </h1>
          <p className="text-sm text-muted-foreground">
            أدخل اسم المستخدم وكلمة المرور أدناه
          </p>
        </div>
        <div className="p-6 pt-0">
          <Suspense>
            <LoginForm noUsers={noUsers} />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
