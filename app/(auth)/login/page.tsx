import { login } from "./actions"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ message: string }>
}) {
  const message = (await searchParams).message
  
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl">تسجيل الدخول إلى حسابك</CardTitle>
          <CardDescription>
            أدخل اسم المستخدم وكلمة المرور أدناه
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form className="flex-1 flex flex-col w-full justify-center gap-4 text-foreground">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="username">
                اسم المستخدم
              </label>
              <Input
                name="username"
                placeholder="ahmed"
                required
              />
            </div>
            
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium" htmlFor="password">
                كلمة المرور
              </label>
              <Input
                type="password"
                name="password"
                placeholder="••••••••"
                required
              />
            </div>

            <div className="flex flex-col gap-2 mt-4">
              <Button formAction={login} variant="default" className="w-full">
                تسجيل الدخول
              </Button>
            </div>
            
            {message && (
              <p className="mt-4 p-4 bg-destructive/10 text-destructive text-center rounded-md text-sm">
                {message}
              </p>
            )}
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
