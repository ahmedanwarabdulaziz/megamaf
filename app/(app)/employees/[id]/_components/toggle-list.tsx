'use client'

import { useState, useTransition } from 'react'
import { Loader2 } from 'lucide-react'

type Item = { key: string; name: string }

export function ToggleList({
  employeeId,
  items,
  granted,
  action,
  emptyText,
}: {
  employeeId: string
  items: Item[]
  granted: string[]
  action: (employeeId: string, key: string, next: boolean) => Promise<any>
  emptyText?: string
}) {
  const [local, setLocal] = useState<Set<string>>(new Set(granted))
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [, startTransition] = useTransition()

  function toggle(key: string) {
    const next = !local.has(key)
    // optimistic update
    setLocal((prev) => {
      const s = new Set(prev)
      if (next) s.add(key)
      else s.delete(key)
      return s
    })
    setPendingKey(key)
    startTransition(async () => {
      try {
        await action(employeeId, key, next)
      } catch {
        // revert on failure
        setLocal((prev) => {
          const s = new Set(prev)
          if (next) s.delete(key)
          else s.add(key)
          return s
        })
      } finally {
        setPendingKey(null)
      }
    })
  }

  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground text-center py-3">{emptyText || 'لا يوجد عناصر'}</p>
  }

  return (
    <div className="space-y-1">
      {items.map((item) => {
        const on = local.has(item.key)
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => toggle(item.key)}
            className="w-full flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-accent transition-colors"
          >
            <span className="text-sm font-medium">{item.name}</span>
            <span className="flex items-center gap-2">
              {pendingKey === item.key && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
              <span
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  on ? 'bg-primary' : 'bg-muted-foreground/30'
                }`}
                aria-checked={on}
                role="switch"
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    on ? '-translate-x-5' : '-translate-x-0.5'
                  }`}
                />
              </span>
            </span>
          </button>
        )
      })}
    </div>
  )
}
