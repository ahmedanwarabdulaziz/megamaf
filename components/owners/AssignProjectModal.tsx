"use client"

import { useState, useTransition } from "react"
import { X, FolderKanban, Search } from "lucide-react"
import { assignProjectToOwner } from "@/app/(app)/settings/owners/actions"
import { Button } from "@/components/ui/button"

interface Project {
  id: string
  name: string
  code: string | null
  node_type: string
  status: string
}

interface AssignProjectModalProps {
  ownerId: string
  ownerName: string
  availableProjects: Project[]
  onClose: () => void
}

export function AssignProjectModal({ ownerId, ownerName, availableProjects, onClose }: AssignProjectModalProps) {
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const filtered = availableProjects.filter(p =>
    p.name.toLowerCase().includes(query.toLowerCase()) ||
    (p.code && p.code.toLowerCase().includes(query.toLowerCase()))
  )

  const nodeTypeLabel = (t: string) => {
    if (t === "main_company") return "شركة رئيسية"
    if (t === "branch") return "فرع"
    if (t === "phase") return "مرحلة"
    return "مشروع"
  }

  const handleAssign = () => {
    if (!selectedId) return
    startTransition(async () => {
      await assignProjectToOwner(selectedId, ownerId)
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center pb-16 sm:pb-0">
      <div className="fixed inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-[70] w-full sm:max-w-lg bg-card rounded-t-2xl sm:rounded-xl border-t-4 sm:border-2 border-primary shadow-2xl animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-0 sm:zoom-in-95 max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between bg-primary text-primary-foreground p-4 sm:px-6 shrink-0">
          <div>
            <h2 className="text-lg font-semibold">اسناد مشروع</h2>
            <p className="text-sm text-primary-foreground/80 mt-0.5">للمالك: {ownerName}</p>
          </div>
          <button onClick={onClose} className="rounded-full p-2 hover:bg-primary-foreground/20 transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4 sm:p-6 flex flex-col gap-4 overflow-hidden flex-1">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="بحث عن مشروع..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full h-10 pr-10 pl-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              autoFocus
            />
          </div>
          <div className="overflow-y-auto flex-1 rounded-md border border-border divide-y divide-border">
            {filtered.length === 0 ? (
              <div className="p-6 text-center text-muted-foreground text-sm">
                {availableProjects.length === 0 ? "لا توجد مشاريع غير مسندة" : "لا توجد نتائج"}
              </div>
            ) : (
              filtered.map(p => (
                <button
                  key={p.id}
                  onClick={() => setSelectedId(p.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-right transition-colors hover:bg-accent ${
                    selectedId === p.id ? "bg-primary/10 border-r-2 border-r-primary" : ""
                  }`}
                >
                  <FolderKanban className={`h-4 w-4 shrink-0 ${selectedId === p.id ? "text-primary" : "text-muted-foreground"}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-medium truncate ${selectedId === p.id ? "text-primary" : ""}`}>{p.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {nodeTypeLabel(p.node_type)}{p.code ? ` - ${p.code}` : ""}
                    </p>
                  </div>
                  {p.status === "closed" && (
                    <span className="text-xs bg-muted text-muted-foreground rounded px-2 py-0.5">مغلق</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
        <div className="px-4 sm:px-6 pb-4 sm:pb-6 flex justify-end gap-2 shrink-0">
          <Button variant="outline" onClick={onClose} disabled={isPending}>الغاء</Button>
          <Button onClick={handleAssign} disabled={!selectedId || isPending}>
            {isPending ? "جاري الاسناد..." : "اسناد المشروع"}
          </Button>
        </div>
      </div>
    </div>
  )
}