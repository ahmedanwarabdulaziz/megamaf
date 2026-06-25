"use client"

import { useMemo } from "react"
import { ProjectCard } from "./project-card"
import { deleteProject } from "@/app/(app)/projects/actions"
import { useRouter } from "next/navigation"

interface Project {
  id: string
  name: string
  code: string | null
  node_type: string
  parent_id: string | null
  status: string
  project_owners: { name: string } | null
  is_main?: boolean
  v_project_financial_position: any[]
}

function buildTree(projects: Project[]): any[] {
  const map = new Map<string, any>()
  const roots: any[] = []
  projects.forEach(p => map.set(p.id, { ...p, subRows: [] }))
  projects.forEach(p => {
    if (p.parent_id && map.has(p.parent_id)) {
      map.get(p.parent_id).subRows.push(map.get(p.id))
    } else {
      roots.push(map.get(p.id))
    }
  })
  return roots
}

export function ProjectCards({ data }: { data: Project[] }) {
  const treeData = useMemo(() => buildTree(data), [data])
  const router = useRouter()

  const handleDelete = async (id: string) => {
    await deleteProject(id)
    router.refresh()
  }

  // Render a node and its children recursively
  const renderNode = (node: any, depth: number = 0) => {
    return (
      <div key={node.id} className="w-full flex flex-col gap-4">
        {/* Render the card itself */}
        <div style={{ marginRight: depth > 0 ? `${depth * 2}rem` : '0', width: depth > 0 ? `calc(100% - ${depth * 2}rem)` : '100%' }}>
          <ProjectCard project={node} onDelete={() => handleDelete(node.id)} />
        </div>
        
        {/* Render children */}
        {node.subRows && node.subRows.length > 0 && (
          <div className="flex flex-col gap-4">
            {node.subRows.map((child: any) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {treeData.length > 0 ? (
        treeData.map(root => renderNode(root, 0))
      ) : (
        <div className="p-8 text-center text-muted-foreground border rounded-xl bg-card">
          لا يوجد مشاريع
        </div>
      )}
    </div>
  )
}
