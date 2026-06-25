"use client"

import { useFormStatus } from "react-dom"
import { useSearchParams } from "next/navigation"
import { login } from "./actions"
import { Loader2 } from "lucide-react"

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

export function LoginForm() {
  const searchParams = useSearchParams()
  const message = searchParams.get("message")

  return (
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
  )
}
