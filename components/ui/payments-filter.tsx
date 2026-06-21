"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { Filter, User, Briefcase, RotateCcw } from "lucide-react"

interface Props {
  employees: { id: string; name: string }[]
  projects: { id: string; name: string }[]
}

export function PaymentsFilter({ employees, projects }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const currentEmployee = searchParams.get("employeeId") || ""
  const currentProject = searchParams.get("projectId") || ""
  
  // Default to current month if not specified, unless it's explicitly "all"
  const defaultMonth = new Date().toISOString().slice(0, 7)
  const currentMonth = searchParams.has("month") ? searchParams.get("month")! : defaultMonth

  function handleFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams)
    if (value) {
      params.set(key, value)
    } else {
      params.delete(key)
    }
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex flex-row gap-3 p-3 rounded-xl border border-border bg-card shadow-sm">
      <div className="flex items-start md:items-center gap-1.5 text-sm font-medium text-muted-foreground pl-2 md:border-l border-border shrink-0 mt-2 md:mt-0">
        <Filter className="h-4 w-4" />
        تصفية
      </div>
      
      <div className="flex flex-col md:flex-row md:flex-wrap md:items-center gap-2 flex-1">
        <div className="relative flex-1 min-w-[140px] max-w-full md:max-w-[200px]">
          <User className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <select
            value={currentEmployee}
            onChange={(e) => handleFilter("employeeId", e.target.value)}
            className="h-9 w-full appearance-none rounded-md border border-input bg-background pl-3 pr-9 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">جميع الموظفين</option>
            {employees.map(e => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
        </div>

        <div className="relative flex-1 min-w-[140px] max-w-full md:max-w-[200px]">
          <Briefcase className="absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <select
            value={currentProject}
            onChange={(e) => handleFilter("projectId", e.target.value)}
            className="h-9 w-full appearance-none rounded-md border border-input bg-background pl-3 pr-9 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="">جميع المشاريع</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>

        <div className="flex flex-1 min-w-[180px] max-w-full md:max-w-[240px] items-center gap-1 md:border-r border-border md:pr-2 md:ml-auto">
          <input
            type="month"
            value={currentMonth === "all" ? "" : currentMonth}
            onChange={(e) => handleFilter("month", e.target.value || "all")}
            className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {currentMonth !== "all" && (
            <button
              onClick={() => handleFilter("month", "all")}
              className="text-xs text-muted-foreground hover:text-foreground px-2 shrink-0"
            >
              الكل
            </button>
          )}
        </div>

        {/* Reset Button */}
        {(currentEmployee || currentProject || currentMonth !== defaultMonth) && (
          <div className="flex shrink-0 w-full sm:w-auto mt-1 sm:mt-0 md:border-r border-border md:pr-2">
            <button
              onClick={() => router.push(pathname)}
              className="flex w-full sm:w-auto items-center justify-center gap-1.5 text-xs text-red-600 hover:text-red-700 bg-red-50 hover:bg-red-100 px-3 py-2 sm:py-1.5 rounded-md transition-colors"
              title="إعادة ضبط الفلاتر"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              إعادة ضبط
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
