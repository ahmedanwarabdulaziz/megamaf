import { createClient } from "@/lib/supabase/server"
import { FolderKanban } from "lucide-react"
import { ProjectBalanceForm } from "./client"

export default async function ProjectBalancesPage() {
  const supabase = await createClient()

  // Fetch all non-branch projects
  const { data: projects } = await supabase
    .from("projects")
    .select("id, name, is_company_branch")
    .eq("is_company_branch", false)
    .order("name", { ascending: true })

  // Fetch all legacy balances
  const { data: legacyBalancesRaw } = await supabase
    .from("project_legacy_balances")
    .select("*")

  const safeProjects = projects || []
  const legacyBalancesMap = new Map()
  for (const lb of legacyBalancesRaw || []) {
    legacyBalancesMap.set(lb.project_id, lb)
  }

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      <div className="flex items-center gap-3 border-b pb-4">
        <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center">
          <FolderKanban className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">الأرصدة الافتتاحية للمشروعات</h1>
          <p className="text-muted-foreground text-sm mt-1">
            إضافة أرصدة سابقة للمشروعات (عهد مصروفة، مدفوعات موردين، تمويل) التي تمت قبل استخدام هذا النظام. هذه الأرقام لن تؤثر على حسابات البنوك، ولكنها ستظهر في إحصائيات وتكاليف المشروع الإجمالية.
          </p>
        </div>
      </div>

      <div className="grid gap-4">
        {safeProjects.length === 0 ? (
          <div className="text-center p-12 border rounded-lg bg-muted/20">
            <p className="text-muted-foreground">لا توجد مشروعات متاحة.</p>
          </div>
        ) : (
          safeProjects.map(project => (
            <ProjectBalanceForm 
              key={project.id} 
              project={project} 
              legacyBalances={legacyBalancesMap.get(project.id) || null} 
            />
          ))
        )}
      </div>
    </div>
  )
}
