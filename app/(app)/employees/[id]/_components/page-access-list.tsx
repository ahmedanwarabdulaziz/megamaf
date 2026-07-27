'use client'

import { useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'

type Item = { key: string; name: string }
type Level = 'none' | 'view' | 'edit'

const OPTIONS: { value: Level; label: string }[] = [
  { value: 'none', label: 'بدون' },
  { value: 'view', label: 'عرض' },
  { value: 'edit', label: 'عرض وتعديل' },
]

export function PageAccessList({
  employeeId,
  items,
  levels,
  action,
}: {
  employeeId: string
  items: Item[]
  levels: Record<string, Level>
  action: (employeeId: string, key: string, level: Level) => Promise<any>
}) {
  const [local, setLocal] = useState<Record<string, Level>>(levels)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function setLevel(key: string, level: Level) {
    const prevLevel = local[key] ?? 'none'
    if (prevLevel === level) return

    setLocal((prev) => ({ ...prev, [key]: level }))
    setPendingKey(key)
    startTransition(async () => {
      try {
        await action(employeeId, key, level)
      } catch {
        setLocal((prev) => ({ ...prev, [key]: prevLevel }))
      } finally {
        setPendingKey(null)
      }
    })
  }

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-3">لا يوجد عناصر</p>
  }

  return (
    <div className="space-y-1">
      {items.map((item) => {
        const current = local[item.key] ?? 'none'
        return (
          <div key={item.key} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5">
            <span className="text-sm font-medium">{item.name}</span>
            <div className="flex items-center gap-1">
              {pendingKey === item.key && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              <div className="flex rounded-md border overflow-hidden">
                {OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setLevel(item.key, opt.value)}
                    className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                      current === opt.value
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-transparent text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
