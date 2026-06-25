import { Suspense } from "react"
import { LoginForm } from "./login-form"

export default function LoginPage() {
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
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  )
}
