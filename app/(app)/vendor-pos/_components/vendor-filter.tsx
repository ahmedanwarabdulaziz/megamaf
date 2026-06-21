"use client"

import { useRouter, useSearchParams } from "next/navigation"
import { Search } from "lucide-react"

interface Props {
  vendors: { id: string; name: string }[]
  projects: { id: string; name: string }[]
}

export function VendorFilter({ vendors, projects }: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const selectedVendor = searchParams.get("vendor_id") || ""
  const selectedProject = searchParams.get("project_id") || ""
  
  const currentMonth = new Date().toISOString().substring(0, 7)
  const selectedMonth = searchParams.get("month") ?? currentMonth

  const updateFilters = (key: string, value: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    router.push(`?${params.toString()}`, { scroll: false })
  }

  return (
    <div className="flex flex-col sm:flex-row gap-3">
      <div className="relative flex-1">
        <input
          type="month"
          value={selectedMonth}
          onChange={(e) => updateFilters("month", e.target.value)}
          className="w-full px-3 py-2 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary"
        />
      </div>
      <div className="relative flex-[1.5]">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <select
          value={selectedVendor}
          onChange={(e) => updateFilters("vendor_id", e.target.value)}
          className="w-full pl-3 pr-9 py-2 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary appearance-none"
        >
          <option value="">جميع الموردين / المقاولين</option>
          {vendors.map((v) => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>
      </div>
      <div className="relative flex-[1.5]">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <select
          value={selectedProject}
          onChange={(e) => updateFilters("project_id", e.target.value)}
          className="w-full pl-3 pr-9 py-2 rounded-xl border border-border bg-card text-sm focus:outline-none focus:ring-2 focus:ring-primary appearance-none"
        >
          <option value="">جميع المشروعات</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
    </div>
  )
}
