'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'

type BackupHealth = {
  status: 'healthy' | 'unhealthy'
  message: string
  checkedAt: string
  lastScheduledAt: string | null
  lastUploadedAt: string | null
  runInProgress: boolean
}

export function BackupHealthIndicator() {
  const [health, setHealth] = useState<BackupHealth | null>(null)
  const [open, setOpen] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/backup-health', { cache: 'no-store' })
      if (!response.ok) throw new Error('Backup health request failed')
      setHealth((await response.json()) as BackupHealth)
    } catch {
      setHealth({
        status: 'unhealthy',
        message: 'تعذر التحقق من النسخ الاحتياطي. اتصل بالمطور.',
        checkedAt: new Date().toISOString(),
        lastScheduledAt: null,
        lastUploadedAt: null,
        runInProgress: false,
      })
    }
  }, [])

  useEffect(() => {
    const firstCheck = window.setTimeout(refresh, 0)
    const timer = window.setInterval(refresh, 5 * 60 * 1_000)
    return () => {
      window.clearTimeout(firstCheck)
      window.clearInterval(timer)
    }
  }, [refresh])

  const healthy = health?.status === 'healthy'
  const label = health
    ? healthy
      ? 'النسخ الاحتياطي يعمل'
      : 'مشكلة في النسخ الاحتياطي'
    : 'جاري فحص النسخ الاحتياطي'

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className={`flex h-9 items-center gap-2 rounded-full border px-2.5 text-xs font-medium transition-colors ${
          !health
            ? 'border-border bg-muted text-muted-foreground'
            : healthy
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border-red-300 bg-red-50 text-red-800'
        }`}
        aria-expanded={open}
        aria-label={label}
        title={health?.message ?? label}
      >
        {!health ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <span
            className={`h-3 w-3 shrink-0 rounded-full ${
              healthy
                ? 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.16)]'
                : 'animate-pulse bg-red-600 shadow-[0_0_0_3px_rgba(220,38,38,0.16)]'
            }`}
            aria-hidden="true"
          />
        )}
        <span className="hidden sm:inline">{label}</span>
      </button>

      {open && health && (
        <div
          className={`absolute left-0 top-11 z-50 w-72 rounded-lg border bg-card p-3 text-right shadow-lg ${
            healthy ? 'border-emerald-200' : 'border-red-300'
          }`}
          dir="rtl"
          role="status"
        >
          <div className="flex items-start gap-2">
            {healthy ? (
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            ) : (
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
            )}
            <div className="min-w-0">
              <p
                className={`text-sm font-semibold ${
                  healthy ? 'text-emerald-800' : 'text-red-800'
                }`}
              >
                {label}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {health.message}
              </p>
              {health.lastUploadedAt && (
                <p className="mt-2 text-[11px] text-muted-foreground">
                  آخر رفع إلى R2: {formatDate(health.lastUploadedAt)}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ar-EG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}
