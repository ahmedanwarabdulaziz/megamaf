"use client"

import Link from "next/link"
import { Button } from "@/components/ui/button"

export function EmployeeFilter({
  employees,
  currentEmployeeId,
}: {
  employees: { id: string; name: string }[]
  currentEmployeeId?: string
}) {
  return (
    <div className="flex items-center gap-2">
      <select
        name="employee_id"
        value={currentEmployeeId || ""}
        onChange={e => {
          const url = new URL(window.location.href)
          if (e.target.value) url.searchParams.set("employee_id", e.target.value)
          else url.searchParams.delete("employee_id")
          window.location.href = url.toString()
        }}
        className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="">جميع الموظفين</option>
        {employees.map(e => (
          <option key={e.id} value={e.id}>{e.name}</option>
        ))}
      </select>

      {currentEmployeeId && (
        <Link href="/custodies">
          <Button variant="ghost" size="sm">مسح الفلتر</Button>
        </Link>
      )}
    </div>
  )
}
