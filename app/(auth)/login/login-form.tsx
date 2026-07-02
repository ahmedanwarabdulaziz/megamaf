"use client"

import { useFormStatus } from "react-dom"
import { useSearchParams } from "next/navigation"
import { login } from "./actions"
import { Loader2, ShieldAlert } from "lucide-react"

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex w-full items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 h-10"
    >
      {pending ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : null}
      {pending ? "جارٍ تسجيل الدخول..." : "تسجيل الدخول"}
    </button>
  )
}

interface LoginFormProps {
  noUsers?: boolean
}

export function LoginForm({ noUsers = false }: LoginFormProps) {
  const searchParams = useSearchParams()
  const message = searchParams.get("message")

  return (
    <div className="flex flex-col gap-4">
      {/* ── First-run banner: only shown when no employees exist ── */}
      {noUsers && (
        <a
          href="/api/seed-admin"
          className="group flex flex-col items-center gap-2 rounded-lg border border-amber-400/60 bg-amber-50 dark:bg-amber-950/30 px-4 py-4 text-center transition-all hover:border-amber-500 hover:bg-amber-100 dark:hover:bg-amber-950/50"
        >
          <span className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-semibold text-sm">
            <ShieldAlert className="h-5 w-5 shrink-0" />
            لا يوجد مستخدمون في النظام
          </span>
          <span className="text-xs text-amber-600 dark:text-amber-500 leading-relaxed">
            اضغط هنا لإنشاء أول حساب مسؤول
            <br />
            <span className="font-mono font-bold">admin / 123456</span>
          </span>
          <span className="mt-1 inline-flex items-center justify-center rounded-md bg-amber-500 px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors group-hover:bg-amber-600">
            إنشاء حساب المسؤول
          </span>
        </a>
      )}

      <form action={login} className="flex flex-col w-full gap-4" suppressHydrationWarning>
        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="username">
            اسم المستخدم
          </label>
          <input
            id="username"
            name="username"
            placeholder="admin"
            required
            autoComplete="username"
            suppressHydrationWarning
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-sm font-medium" htmlFor="password">
            كلمة المرور (PIN)
          </label>
          <input
            id="password"
            type="password"
            name="password"
            placeholder="••••••••"
            required
            autoComplete="current-password"
            suppressHydrationWarning
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          />
        </div>

        <div className="mt-2">
          <SubmitButton />
        </div>

        {message && (
          <p className="p-3 bg-destructive/10 text-destructive text-center rounded-md text-sm">
            {decodeURIComponent(message)}
          </p>
        )}
      </form>
    </div>
  )
}
