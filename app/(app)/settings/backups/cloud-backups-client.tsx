'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  Clock3,
  Cloud,
  DatabaseBackup,
  Download,
  Loader2,
  Play,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

type WorkflowRun = {
  id: number
  event: string | null
  status: string | null
  conclusion: string | null
  createdAt: string | null
  updatedAt: string | null
  url: string | null
  runNumber: number
}

type StoredBackup = {
  key: string
  name: string
  bytes: number
  createdAt: string | null
}

export function CloudBackupsClient() {
  const [runs, setRuns] = useState<WorkflowRun[]>([])
  const [backups, setBackups] = useState<StoredBackup[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [triggering, setTriggering] = useState(false)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [message, setMessage] = useState<{
    type: 'success' | 'error'
    text: string
  } | null>(null)

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const response = await fetch('/api/admin/cloud-backups', {
        cache: 'no-store',
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error ?? 'تعذر تحميل حالة النسخ الاحتياطي.')
      }
      setRuns(payload.runs ?? [])
      setBackups(payload.backups ?? [])
      setWarnings(payload.warnings ?? [])
    } catch (error) {
      if (!quiet) {
        setMessage({ type: 'error', text: errorMessage(error) })
      }
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const timer = window.setInterval(() => load(true), 15_000)
    return () => window.clearInterval(timer)
  }, [load])

  const activeRun = useMemo(
    () => runs.find((run) => run.status && run.status !== 'completed'),
    [runs],
  )

  async function triggerBackup() {
    setTriggering(true)
    setMessage(null)
    try {
      const response = await fetch('/api/admin/cloud-backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'trigger' }),
      })
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error ?? 'تعذر بدء النسخ الاحتياطي.')
      }
      setMessage({
        type: 'success',
        text: 'تم إرسال الطلب. سيظهر التنفيذ هنا خلال ثوانٍ، ويمكنك إغلاق الصفحة بأمان.',
      })
      window.setTimeout(() => load(true), 3000)
    } catch (error) {
      setMessage({ type: 'error', text: errorMessage(error) })
    } finally {
      setTriggering(false)
    }
  }

  async function downloadBackup(backup: StoredBackup) {
    setDownloading(backup.key)
    setMessage(null)
    try {
      const response = await fetch('/api/admin/cloud-backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'download', key: backup.key }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.url) {
        throw new Error(payload.error ?? 'تعذر تجهيز رابط التنزيل.')
      }
      window.location.assign(payload.url)
    } catch (error) {
      setMessage({ type: 'error', text: errorMessage(error) })
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6" dir="rtl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <DatabaseBackup className="h-7 w-7" />
            النسخ الاحتياطي السحابي
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            أنشئ نسخة كاملة من بيانات قاعدة الإنتاج من أي كمبيوتر، ثم نزّلها على جهازك.
          </p>
        </div>
        <Button variant="outline" onClick={() => load()} disabled={loading}>
          <RefreshCw className={`ml-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          تحديث
        </Button>
      </div>

      {message && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            message.type === 'success'
              ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
              : 'border-red-300 bg-red-50 text-red-800'
          }`}
        >
          {message.text}
        </div>
      )}

      {warnings.map((warning) => (
        <div
          key={warning}
          className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          {warning}
        </div>
      ))}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Cloud className="h-5 w-5" />
              إنشاء نسخة الآن
            </CardTitle>
            <CardDescription>
              تتم العملية بالكامل في السحابة. لا يحتاج الكمبيوتر الحالي إلى أي برنامج أو إعداد.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-lg border bg-muted/40 p-4 text-sm">
              <div className="flex items-center gap-2 font-medium text-emerald-700">
                <ShieldCheck className="h-5 w-5" />
                تشمل الأدوار والمخطط وجميع بيانات الجداول مع التحقق من الملف
              </div>
              <p className="mt-2 text-muted-foreground">
                لا تشمل ملفات R2 أو كود التطبيق. تُحفظ النسخة في مساحة خاصة ولا يظهر رابط التنزيل إلا للمدير العام.
              </p>
            </div>
            <Button
              size="lg"
              onClick={triggerBackup}
              disabled={triggering || Boolean(activeRun)}
            >
              {triggering || activeRun ? (
                <Loader2 className="ml-2 h-5 w-5 animate-spin" />
              ) : (
                <Play className="ml-2 h-5 w-5" />
              )}
              {activeRun ? 'النسخ قيد التنفيذ' : triggering ? 'جاري إرسال الطلب' : 'إنشاء نسخة قاعدة البيانات'}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Clock3 className="h-5 w-5" />
              النسخ التلقائي
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="font-medium text-emerald-700">يومياً في السحابة</p>
            <p className="text-muted-foreground">
              يعمل حتى لو كانت جميع أجهزة المكتب مغلقة. النسخة اليدوية تستخدم النظام نفسه.
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>آخر عمليات النسخ</CardTitle>
          <CardDescription>حالة العمل السحابي المسؤول عن إنشاء النسخة والتحقق منها.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading && runs.length === 0 ? (
            <LoadingRow />
          ) : runs.length === 0 ? (
            <EmptyRow text="لا توجد عمليات مسجلة بعد." />
          ) : (
            <div className="divide-y rounded-lg border">
              {runs.slice(0, 8).map((run) => (
                <div
                  key={run.id}
                  className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3">
                    <RunIcon run={run} />
                    <div>
                      <p className="text-sm font-medium">
                        نسخة {run.event === 'schedule' ? 'تلقائية' : 'يدوية'} #{run.runNumber}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {run.createdAt ? formatDate(run.createdAt) : '—'}
                      </p>
                    </div>
                  </div>
                  <span className="text-sm">{runLabel(run)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>ملفات قاعدة البيانات الجاهزة</CardTitle>
          <CardDescription>
            اضغط تنزيل لحفظ النسخة مباشرة على الكمبيوتر الذي تستخدمه الآن.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading && backups.length === 0 ? (
            <LoadingRow />
          ) : backups.length === 0 ? (
            <EmptyRow text="لا توجد نسخة سحابية جاهزة بعد." />
          ) : (
            <div className="divide-y rounded-lg border">
              {backups.map((backup) => (
                <div
                  key={backup.key}
                  className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="text-sm font-medium" dir="ltr">{backup.name}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {backup.createdAt ? formatDate(backup.createdAt) : '—'} · {formatBytes(backup.bytes)}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    onClick={() => downloadBackup(backup)}
                    disabled={downloading !== null}
                  >
                    {downloading === backup.key ? (
                      <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="ml-2 h-4 w-4" />
                    )}
                    تنزيل على هذا الكمبيوتر
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function RunIcon({ run }: { run: WorkflowRun }) {
  if (run.status !== 'completed') {
    return <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
  }
  if (run.conclusion === 'success') {
    return <CheckCircle2 className="h-5 w-5 text-emerald-600" />
  }
  return <XCircle className="h-5 w-5 text-red-600" />
}

function runLabel(run: WorkflowRun) {
  if (run.status === 'queued') return 'في الانتظار'
  if (run.status === 'in_progress') return 'جاري إنشاء النسخة'
  if (run.conclusion === 'success') return 'اكتملت وتم التحقق'
  if (run.conclusion === 'cancelled') return 'أُلغيت'
  if (run.status === 'completed') return 'فشلت'
  return 'غير معروفة'
}

function LoadingRow() {
  return (
    <div className="flex items-center justify-center py-10">
      <Loader2 className="h-6 w-6 animate-spin" />
    </div>
  )
}

function EmptyRow({ text }: { text: string }) {
  return <div className="py-10 text-center text-sm text-muted-foreground">{text}</div>
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ar-EG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value < 0) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let amount = value
  let unit = 0
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024
    unit += 1
  }
  return `${amount.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'حدث خطأ غير متوقع.'
}
