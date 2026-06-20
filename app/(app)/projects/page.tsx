import { createClient } from "@/lib/supabase/server"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import {
  Plus, Building2, FolderKanban, Pencil, Trash2, Calendar, Banknote, ShieldCheck, AlertCircle
} from "lucide-react"
import Link from "next/link"
import { AddProjectModal } from "@/components/modals/add-project-modal"
import { EditProjectModal } from "@/components/modals/edit-project-modal"
import { deleteProject } from "./actions"

function formatDate(dateStr: string | null) {
  if (!dateStr) return null
  return new Date(dateStr).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" })
}

export default async function ProjectsPage() {
  const supabase = await createClient()

  // Get projects
  const { data: projects } = await supabase
    .from("projects")
    .select("*")
    .order("is_company_branch", { ascending: false }) // Show branches first
    .order("name", { ascending: true })

  const safeProjects = projects || []

  const totalCount = safeProjects.length
  const branchesCount = safeProjects.filter(p => p.is_company_branch).length
  const activeCount = safeProjects.filter(p => p.status === "active" && !p.is_company_branch).length
  const completedCount = safeProjects.filter(p => p.status === "completed" && !p.is_company_branch).length

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-6">
      {/* Header */}
      <div className="static md:sticky md:top-0 z-20 bg-background/95 backdrop-blur-md pb-4 border-b border-border -mx-4 px-4 -mt-4 pt-4 md:-mx-6 md:px-6 md:-mt-6 md:pt-6 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">المشروعات والفروع</h1>
          <p className="text-muted-foreground mt-2">إدارة المشروعات الخاصة بالشركة، فروعها، وميزانياتها.</p>
        </div>
        <Link href="?modal=add-project" scroll={false}>
          <Button variant="default">
            <Plus className="mr-2 h-4 w-4" />
            إضافة مشروع / فرع
          </Button>
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4 flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">الإجمالي</p>
            <p className="text-3xl font-bold">{totalCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">فروع الشركة</p>
            <p className="text-3xl font-bold text-primary">{branchesCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">مشروعات نشطة</p>
            <p className="text-3xl font-bold text-green-600">{activeCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">مشروعات مكتملة</p>
            <p className="text-3xl font-bold text-muted-foreground">{completedCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Projects List */}
      {safeProjects.length === 0 ? (
        <Card className="flex flex-col items-center justify-center p-12 text-center border-dashed">
          <FolderKanban className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
          <h3 className="text-lg font-medium">لا توجد مشروعات بعد</h3>
          <p className="text-muted-foreground mt-2 max-w-sm">
            قم بإضافة مشروع لبدء إدارة بياناته وميزانيته.
          </p>
          <Link href="?modal=add-project" scroll={false} className="mt-6">
            <Button>إضافة مشروع جديد</Button>
          </Link>
        </Card>
      ) : (
        <div className="grid gap-4">
          {safeProjects.map(project => {
            const isBranch = project.is_company_branch

            let statusColor = "bg-muted text-muted-foreground border-border"
            let statusText = "غير محدد"
            if (project.status === "active") {
              statusColor = "bg-green-500/10 text-green-600 border-green-500/20"
              statusText = "نشط"
            } else if (project.status === "completed") {
              statusColor = "bg-blue-500/10 text-blue-600 border-blue-500/20"
              statusText = "مكتمل"
            } else if (project.status === "on_hold") {
              statusColor = "bg-amber-500/10 text-amber-600 border-amber-500/20"
              statusText = "قيد الانتظار"
            } else if (project.status === "cancelled") {
              statusColor = "bg-red-500/10 text-red-600 border-red-500/20"
              statusText = "ملغى"
            }

            return (
              <Card key={project.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    {/* Icon */}
                    <div className={`h-10 w-10 rounded-lg flex items-center justify-center shrink-0 ${isBranch ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"}`}>
                      {isBranch ? <Building2 className="h-5 w-5" /> : <FolderKanban className="h-5 w-5" />}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-base">{project.name}</h3>
                        <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-secondary text-secondary-foreground">
                          {project.code || "بدون كود"}
                        </span>
                        {!isBranch && (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${statusColor}`}>
                            {statusText}
                          </span>
                        )}
                        {isBranch && (
                          <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full border bg-primary/10 text-primary border-primary/20">
                            <ShieldCheck className="h-3 w-3" /> فرع شركة (دائم)
                          </span>
                        )}
                      </div>

                      {project.description && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                          {project.description}
                        </p>
                      )}

                      {/* Details */}
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                        {project.start_date && (
                          <span className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Calendar className="h-3.5 w-3.5" /> تبدأ: {formatDate(project.start_date)}
                          </span>
                        )}
                        {project.end_date && (
                          <span className="flex items-center gap-1 text-sm text-muted-foreground">
                            <Calendar className="h-3.5 w-3.5" /> تنتهي: {formatDate(project.end_date)}
                          </span>
                        )}
                        {project.budget && (
                          <span className="flex items-center gap-1 text-sm font-medium">
                            <Banknote className="h-3.5 w-3.5 text-primary" /> 
                            {Number(project.budget).toLocaleString("en-US")} EGP
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-col gap-1 shrink-0">
                      {/* Edit */}
                      <Link href={`?modal=edit-project&edit_project=${project.id}`} scroll={false}>
                        <Button variant="ghost" size="icon" className="h-8 w-8" title="تعديل">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </Link>
                      
                      {/* Delete */}
                      {!isBranch && (
                        <form action={async () => { "use server"; await deleteProject(project.id) }}>
                          <Button type="submit" variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:bg-destructive/10" title="حذف">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </form>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Modals */}
      <AddProjectModal />
      <EditProjectModal projects={safeProjects} />
    </div>
  )
}
