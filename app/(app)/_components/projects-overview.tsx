"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { FolderKanban } from "lucide-react"

type Project = {
  id: string
  name: string
}

type ProjectFund = {
  project_id: string
  amount: number
}

type Expense = {
  project_id: string
  amount: number
}

export function ProjectsOverview({
  projects,
  funds,
  expenses,
}: {
  projects: Project[]
  funds: ProjectFund[]
  expenses: Expense[]
}) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>("all")

  const totals = useMemo(() => {
    let totalIn = 0
    let totalOut = 0

    const targetFunds = selectedProjectId === "all" ? funds : funds.filter(f => f.project_id === selectedProjectId)
    const targetExpenses = selectedProjectId === "all" ? expenses : expenses.filter(e => e.project_id === selectedProjectId)

    for (const f of targetFunds) {
      totalIn += Number(f.amount)
    }

    for (const e of targetExpenses) {
      totalOut += Number(e.amount)
    }

    return {
      in: totalIn,
      out: totalOut,
      net: totalIn - totalOut
    }
  }, [funds, expenses, selectedProjectId])

  return (
    <Card className="col-span-full shadow-sm bg-card border-border/60">
      <CardHeader className="pb-2 pt-3 px-4 sm:px-5 border-b border-border/30">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base font-bold tracking-tight">
            <FolderKanban className="h-4 w-4 text-primary" />
            تدفقات المشروعات (هذا الشهر)
          </CardTitle>

          {/* Tags / Filter */}
          {projects.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => setSelectedProjectId("all")}
                className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors border ${
                  selectedProjectId === "all"
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-background text-muted-foreground hover:bg-muted border-border"
                }`}
              >
                الجميع
              </button>
              {projects.map((proj) => (
                <button
                  key={proj.id}
                  onClick={() => setSelectedProjectId(proj.id)}
                  className={`px-3 py-1 rounded-full text-[11px] font-semibold transition-colors border flex items-center gap-1 ${
                    selectedProjectId === proj.id
                      ? "bg-primary text-primary-foreground border-primary shadow-sm"
                      : "bg-background text-muted-foreground hover:bg-muted border-border"
                  }`}
                >
                  {proj.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        <div className="flex flex-col divide-y divide-border/30">
          <div className="p-3 px-4 sm:px-5">
            <div className="flex items-center gap-2 mb-2">
              <span className="px-2 py-0.5 bg-muted rounded text-[10px] font-bold text-muted-foreground tracking-wider uppercase border border-border/50">
                EGP
              </span>
            </div>

            {/* Table Layout: One line for text, one line for numbers */}
            <div className="grid grid-cols-3 text-center">
              {/* Headers Line */}
              <div className="text-xs font-bold text-muted-foreground pb-1 border-b border-border/20">الوارد (تمويل)</div>
              <div className="text-xs font-bold text-muted-foreground pb-1 border-b border-border/20">المنصرف (مصروفات)</div>
              <div className="text-xs font-bold text-muted-foreground pb-1 border-b border-border/20">صافي التدفقات</div>
              
              {/* Numbers Line */}
              <div className="text-base sm:text-lg font-bold text-green-600 dark:text-green-500 dir-ltr pt-1">
                {totals.in.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </div>
              <div className="text-base sm:text-lg font-bold text-red-600 dark:text-red-500 dir-ltr pt-1">
                {totals.out.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </div>
              <div className={`text-base sm:text-lg font-bold dir-ltr pt-1 ${
                totals.net > 0 ? "text-primary" : totals.net < 0 ? "text-orange-600 dark:text-orange-500" : "text-foreground"
              }`}>
                {totals.net.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
