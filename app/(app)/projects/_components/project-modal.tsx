"use client"

import { Modal } from "@/components/ui/modal"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { saveProject } from "@/app/(app)/projects/actions"
import { useTransition, useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Info } from "lucide-react"

export function ProjectModal({ owners, projects }: { owners: any[], projects: any[] }) {
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const searchParams = useSearchParams()
  
  const isOpen = searchParams.get("modal") === "add-project" || searchParams.get("modal") === "edit-project"
  const isEdit = searchParams.get("modal") === "edit-project"
  
  const id = searchParams.get("id") || ""
  
  // Find project if editing
  const editingProject = isEdit ? projects.find(p => p.id === id) : null

  const [nodeType, setNodeType] = useState(editingProject?.node_type || "project")
  const [selectedParentId, setSelectedParentId] = useState(editingProject?.parent_id || "")
  const [selectedOwnerId, setSelectedOwnerId] = useState(editingProject?.owner_id || "")
  const [ownerInherited, setOwnerInherited] = useState(false)

  useEffect(() => {
    if (editingProject) {
      setNodeType(editingProject.node_type)
      setSelectedParentId(editingProject.parent_id || "")
      setSelectedOwnerId(editingProject.owner_id || "")
      setOwnerInherited(false)
    } else {
      setNodeType("project")
      setSelectedParentId("")
      setSelectedOwnerId("")
      setOwnerInherited(false)
    }
  }, [editingProject])

  // When parent changes, auto-fill owner from parent if none selected
  useEffect(() => {
    if (isEdit) return
    if (!selectedParentId) return
    const parent = projects.find(p => p.id === selectedParentId)
    if (parent?.owner_id) {
      setSelectedOwnerId(parent.owner_id)
      setOwnerInherited(true)
    } else {
      setOwnerInherited(false)
    }
  }, [selectedParentId, isEdit, projects])

  const action = (formData: FormData) => {
    startTransition(async () => {
      await saveProject(formData)
      const params = new URLSearchParams(searchParams.toString())
      params.delete("modal")
      params.delete("id")
      router.push(`?${params.toString()}`, { scroll: false })
    })
  }

  if (!isOpen) return null

  // Filter possible parents
  const possibleParents = projects.filter(p => {
    if (nodeType === 'branch') return p.node_type === 'project'
    if (nodeType === 'phase') return p.node_type === 'branch'
    return p.node_type === 'main_company' // for project
  })

  const isMainCompany = editingProject?.node_type === 'main_company'

  return (
    <Modal name={searchParams.get("modal")!} title={isEdit ? "تعديل " + (isMainCompany ? "الشركة" : "المشروع") : "إضافة عقد / مشروع"}>
      <form action={action} className="space-y-4">
        {isEdit && <input type="hidden" name="id" value={id} />}
        
        <div className="space-y-2">
          <label className="text-sm font-medium">الاسم</label>
          <Input name="name" defaultValue={editingProject?.name || ""} required />
        </div>
        
        <div className="space-y-2">
          <label className="text-sm font-medium">الكود (اختياري)</label>
          <Input name="code" defaultValue={editingProject?.code || ""} />
        </div>

        {!isMainCompany && (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium">النوع</label>
              <Select name="node_type" value={nodeType} onChange={(e) => setNodeType(e.target.value)} disabled={isEdit}>
                <option value="project">مشروع / عقد</option>
                <option value="branch">فرع (داخل مشروع)</option>
                <option value="phase">مرحلة (داخل فرع)</option>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">التبعية (الأب)</label>
              <Select
                name="parent_id"
                value={selectedParentId}
                onChange={(e) => setSelectedParentId(e.target.value)}
                required
                disabled={isEdit && nodeType !== 'project'}
              >
                {possibleParents.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">المالك</label>
                {ownerInherited && (
                  <span className="flex items-center gap-1 text-xs text-primary">
                    <Info className="h-3 w-3" />
                    موروث من المشروع الأب
                  </span>
                )}
              </div>
              <Select
                name="owner_id"
                value={selectedOwnerId}
                onChange={(e) => {
                  setSelectedOwnerId(e.target.value)
                  setOwnerInherited(false)
                }}
              >
                <option value="">بدون مالك (يرث من الأب تلقائياً)</option>
                {owners.map(o => (
                  <option key={o.id} value={o.id}>{o.name}</option>
                ))}
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">الحالة</label>
              <Select name="status" defaultValue={editingProject?.status || "open"}>
                <option value="open">مفتوح (جاري)</option>
                <option value="closed">مغلق (منتهي)</option>
              </Select>
            </div>
          </>
        )}

        <div className="space-y-2">
          <label className="text-sm font-medium">ملاحظات</label>
          <Input name="notes" defaultValue={editingProject?.notes || ""} />
        </div>

        <div className="pt-4 flex justify-end gap-2">
          <Button 
            type="button" 
            variant="outline" 
            onClick={() => {
              const params = new URLSearchParams(searchParams.toString())
              params.delete("modal")
              router.push(`?${params.toString()}`, { scroll: false })
            }}
          >
            إلغاء
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? "جاري الحفظ..." : "حفظ"}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
