"use client"

import { useState, useTransition } from "react"
import { ChevronDown, ChevronUp, Phone, StickyNote, FolderKanban, Plus, Unlink, Pencil } from "lucide-react"
import { unassignProject } from "@/app/(app)/settings/owners/actions"
import { AssignProjectModal } from "./AssignProjectModal"
import { Button } from "@/components/ui/button"
import Link from "next/link"

interface Project {
  id: string
  name: string
  code: string | null
  node_type: string
  status: string
}

interface Owner {
  id: string
  name: string
  phone: string | null
  notes: string | null
  projects: Project[]
}

interface OwnerCardProps {
  owner: Owner
  availableProjects: Project[]
}

export function OwnerCard({ owner, availableProjects }: OwnerCardProps) {
  const [isOpen, setIsOpen] = useState(true)
  const [showAssign, setShowAssign] = useState(false)
  const [unassigning, setUnassigning] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const nodeTypeLabel = (t: string) => {
    if (t === "main_company") return "شركة رئيسية"
    if (t === "branch") return "فرع"
    if (t === "phase") return "مرحلة"
    return "مشروع"
  }

  const handleUnassign = (projectId: string) => {
    setUnassigning(projectId)
    startTransition(async () => {
      await unassignProject(projectId)
      setUnassigning(null)
    })
  }

  const editHref = `?modal=edit-owner&id=${owner.id}&name=${encodeURIComponent(owner.name)}&phone=${encodeURIComponent(owner.phone || "")}&notes=${encodeURIComponent(owner.notes || "")}`

  return (
    <>
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden transition-shadow hover:shadow-md">
        <div className="flex items-center justify-between p-4 sm:p-5">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-base shrink-0">
              {owner.name.charAt(0)}
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-base truncate">{owner.name}</h3>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-0.5">
                {owner.phone && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Phone className="h-3 w-3" />
                    {owner.phone}
                  </span>
                )}
                {owner.notes && (
                  <span className="flex items-center gap-1 text-xs text-muted-foreground truncate max-w-[200px]">
                    <StickyNote className="h-3 w-3 shrink-0" />
                    {owner.notes}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="hidden sm:inline-flex items-center gap-1 text-xs font-medium text-muted-foreground bg-muted rounded-full px-2.5 py-1">
              <FolderKanban className="h-3 w-3" />
              {owner.projects.length} مشروع
            </span>
            <Link href={editHref} scroll={false}>
              <Button variant="outline" size="sm" className="gap-1.5">
                <Pencil className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">تعديل</span>
              </Button>
            </Link>
            <button
              onClick={() => setIsOpen(v => !v)}
              className="h-8 w-8 flex items-center justify-center rounded-md hover:bg-accent transition-colors text-muted-foreground"
            >
              {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </div>
        </div>

        {isOpen && (
          <div className="border-t border-border">
            <div className="flex items-center justify-between px-4 sm:px-5 py-3 bg-muted/40">
              <span className="text-sm font-medium text-muted-foreground">
                المشاريع المسندة ({owner.projects.length})
              </span>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-xs h-7"
                onClick={() => setShowAssign(true)}
              >
                <Plus className="h-3.5 w-3.5" />
                اسناد مشروع
              </Button>
            </div>

            {owner.projects.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground gap-2">
                <FolderKanban className="h-8 w-8 opacity-30" />
                <p className="text-sm">لا توجد مشاريع مسندة لهذا المالك</p>
                <button
                  onClick={() => setShowAssign(true)}
                  className="text-xs text-primary hover:underline"
                >
                  اسناد مشروع الان
                </button>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {owner.projects.map(project => (
                  <div key={project.id} className="flex items-center gap-3 px-4 sm:px-5 py-3 hover:bg-muted/30 transition-colors">
                    <FolderKanban className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{project.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {nodeTypeLabel(project.node_type)}{project.code ? ` - ${project.code}` : ""}
                      </p>
                    </div>
                    <span className={`text-xs rounded-full px-2.5 py-0.5 font-medium shrink-0 ${
                      project.status === "open"
                        ? "bg-emerald-500/10 text-emerald-600"
                        : "bg-muted text-muted-foreground"
                    }`}>
                      {project.status === "open" ? "مفتوح" : "مغلق"}
                    </span>
                    <button
                      onClick={() => handleUnassign(project.id)}
                      disabled={isPending && unassigning === project.id}
                      className="flex items-center gap-1 text-xs text-destructive hover:text-destructive/80 hover:bg-destructive/10 rounded px-2 py-1 transition-colors disabled:opacity-50"
                    >
                      <Unlink className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">
                        {isPending && unassigning === project.id ? "..." : "ازالة"}
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {showAssign && (
        <AssignProjectModal
          ownerId={owner.id}
          ownerName={owner.name}
          availableProjects={availableProjects}
          onClose={() => setShowAssign(false)}
        />
      )}
    </>
  )
}