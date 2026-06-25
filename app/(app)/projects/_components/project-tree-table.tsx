"use client"

import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  useReactTable,
  ExpandedState,
} from "@tanstack/react-table"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useState, useMemo, useTransition } from "react"
import { ChevronDown, ChevronRight, Pencil, Trash2, X, Check, AlertCircle } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { deleteProject } from "@/app/(app)/projects/actions"

interface Project {
  id: string
  name: string
  code: string | null
  node_type: string
  parent_id: string | null
  status: string
  project_owners: { name: string } | null
  is_main?: boolean
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

const nodeTypeLabel: Record<string, string> = {
  main_company: "الشركة الرئيسية",
  project: "مشروع",
  branch: "فرع",
  phase: "مرحلة"
}

function DeleteProjectButton({ projectId, projectName, isMain }: { projectId: string; projectName: string; isMain?: boolean }) {
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()

  if (isMain) return null

  const handleDelete = () => {
    setError(null)
    startTransition(async () => {
      const result = await deleteProject(projectId)
      if ('error' in result) {
        setError(result.error)
        setConfirming(false)
      } else {
        // Success — refresh the page data
        router.refresh()
      }
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {!confirming ? (
        <button
          onClick={() => { setError(null); setConfirming(true) }}
          className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
          title="حذف المشروع"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ) : (
        <div className="flex items-center gap-1">
          <span className="text-xs text-destructive font-medium ml-1">تاكيد؟</span>
          <button
            onClick={handleDelete}
            disabled={isPending}
            className="p-1.5 rounded bg-destructive text-destructive-foreground hover:bg-destructive/80 transition-colors disabled:opacity-50"
            title="نعم، احذف"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => { setConfirming(false); setError(null) }}
            disabled={isPending}
            className="p-1.5 rounded border border-border hover:bg-muted transition-colors"
            title="الغاء"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      {error && (
        <div className="flex items-start gap-1 max-w-[220px] text-right">
          <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
          <p className="text-xs text-destructive leading-tight">{error}</p>
        </div>
      )}
    </div>
  )
}

export function ProjectTreeTable({ data }: { data: Project[] }) {
  const [expanded, setExpanded] = useState<ExpandedState>(true)
  const treeData = useMemo(() => buildTree(data), [data])

  const columns: ColumnDef<any>[] = [
    {
      accessorKey: "name",
      header: "الاسم",
      cell: ({ row, getValue }) => (
        <div style={{ paddingRight: `${row.depth * 2}rem` }} className="flex items-center gap-2">
          {row.getCanExpand() ? (
            <button onClick={row.getToggleExpandedHandler()} className="cursor-pointer p-1 hover:bg-muted rounded">
              {row.getIsExpanded() ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
          ) : (
            <span className="w-6" />
          )}
          <Link href={`/projects/${row.original.id}`} className="text-primary hover:underline font-medium">
            {getValue<string>()}
          </Link>
        </div>
      ),
    },
    {
      accessorKey: "code",
      header: "الكود",
      cell: ({ row }) => row.getValue("code") || "-"
    },
    {
      accessorKey: "node_type",
      header: "النوع",
      cell: ({ row }) => nodeTypeLabel[row.getValue("node_type") as string] || row.getValue("node_type")
    },
    {
      accessorKey: "project_owners.name",
      header: "المالك",
      cell: ({ row }) => row.original.project_owners?.name || "-"
    },
    {
      accessorKey: "status",
      header: "الحالة",
      cell: ({ row }) => (
        <span className={`px-2 py-1 rounded-full text-xs ${row.getValue("status") === "open" ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" : "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-400"}`}>
          {row.getValue("status") === "open" ? "مفتوح" : "مغلق"}
        </span>
      )
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center justify-end gap-1">
          <Link
            href={`?modal=edit-project&id=${row.original.id}`}
            scroll={false}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground transition-colors"
            title="تعديل"
          >
            <Pencil className="h-4 w-4" />
          </Link>
          <DeleteProjectButton
            projectId={row.original.id}
            projectName={row.original.name}
            isMain={row.original.is_main}
          />
        </div>
      ),
    },
  ]

  const table = useReactTable({
    data: treeData,
    columns,
    state: { expanded },
    onExpandedChange: setExpanded,
    getSubRows: row => row.subRows,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  })

  return (
    <div className="rounded-md border bg-card">
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <TableHead key={header.id} className="text-right">
                  {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows?.length ? (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id} data-state={row.getIsSelected() && "selected"}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell colSpan={columns.length} className="h-24 text-center">
                لا يوجد مشاريع
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}