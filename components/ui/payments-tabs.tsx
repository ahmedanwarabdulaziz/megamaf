"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"

interface Tab {
  key: string
  label: string
  badge?: number
}

export function PaymentsTabs({ tabs }: { tabs: Tab[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const activeTab = searchParams.get("tab") || tabs[0]?.key

  function setTab(key: string) {
    const params = new URLSearchParams(searchParams)
    params.set("tab", key)
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex gap-1 p-1 rounded-xl bg-muted/60 border border-border">
      {tabs.map(tab => {
        const isActive = activeTab === tab.key
        return (
          <button
            key={tab.key}
            onClick={() => setTab(tab.key)}
            className={`
              flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all
              ${isActive
                ? "bg-background text-foreground shadow-sm border border-border"
                : "text-muted-foreground hover:text-foreground hover:bg-background/60"
              }
            `}
          >
            {tab.label}
            {tab.badge !== undefined && tab.badge > 0 && (
              <span className={`
                inline-flex items-center justify-center h-5 min-w-5 px-1.5 rounded-full text-xs font-bold
                ${isActive ? "bg-primary text-primary-foreground" : "bg-muted-foreground/20 text-muted-foreground"}
              `}>
                {tab.badge}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
