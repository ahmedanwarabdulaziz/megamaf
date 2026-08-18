'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CheckCircle2,
  CircleOff,
  Clock3,
  Copy,
  DatabaseBackup,
  Download,
  HardDrive,
  Loader2,
  MonitorCheck,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Star,
  XCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

type Device = {
  id: string
  name: string
  status: 'active' | 'revoked'
  is_primary: boolean
  paired_at: string
  last_seen_at: string | null
  hostname: string | null
  platform: string | null
  agent_version: string | null
  backup_path: string | null
  free_disk_bytes: number | null
  capabilities: { database?: boolean; r2?: boolean; source?: boolean } | null
  last_error: string | null
  revoked_at: string | null
}

type Job = {
  id: string
  device_id: string
  mode: 'database' | 'incremental' | 'full'
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  requested_at: string
  started_at: string | null
  completed_at: string | null
  archive_name: string | null
  archive_path: string | null
  archive_bytes: number | null
  archive_sha256: string | null
  source_commit: string | null
  error_message: string | null
  agent_message: string | null
}

type Pairing = { code: string; expiresAt: string; ttlMinutes: number }

const MODE_LABELS: Record<Job['mode'], string> = {
  database: 'قاعدة البيانات + المصدر عند تغيّره',
  incremental: 'نسخة يومية آمنة + ملفات R2 الجديدة أو المتغيرة',
  full: 'نسخة كاملة تشمل جميع ملفات R2',
}

const STATUS_LABELS: Record<Job['status'], string> = {
  queued: 'في الانتظار',
  running: 'جارٍ التنفيذ',
  completed: 'اكتملت',
  failed: 'فشلت',
  cancelled: 'ملغاة',
}

export function BackupDevicesClient() {
  const [devices, setDevices] = useState<Device[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [deviceName, setDeviceName] = useState('')
  const [pairing, setPairing] = useState<Pairing | null>(null)
  const [now, setNow] = useState(0)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const response = await fetch('/api/admin/backup-devices', { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error ?? 'تعذر تحميل أجهزة النسخ الاحتياطي')
      setDevices(payload.devices ?? [])
      setJobs(payload.jobs ?? [])
    } catch (error) {
      if (!quiet) setMessage({ type: 'error', text: errorMessage(error) })
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [])

  useEffect(() => {
    setNow(Date.now())
    load()
    const timer = window.setInterval(() => {
      setNow(Date.now())
      load(true)
    }, 15_000)
    return () => window.clearInterval(timer)
  }, [load])

  const activeDevices = useMemo(() => devices.filter((device) => device.status === 'active'), [devices])

  async function action(name: string, payload: Record<string, unknown>) {
    setBusy(name)
    setMessage(null)
    try {
      const response = await fetch('/api/admin/backup-devices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error ?? 'تعذر تنفيذ الطلب')
      await load(true)
      return result
    } catch (error) {
      setMessage({ type: 'error', text: errorMessage(error) })
      return null
    } finally {
      setBusy(null)
    }
  }

  async function createPairing() {
    const name = deviceName.trim()
    if (!name) {
      setMessage({ type: 'error', text: 'اكتب اسماً واضحاً للكمبيوتر الجديد.' })
      return
    }
    const result = await action('pairing', { action: 'create_pairing', name })
    if (result) {
      setPairing(result)
      setMessage({ type: 'success', text: 'تم إنشاء رمز ربط آمن. استخدمه خلال 15 دقيقة.' })
    }
  }

  async function runBackup(device: Device, mode: Job['mode']) {
    if (mode === 'full' && !window.confirm('النسخة الكاملة قد تستغرق وقتاً ومساحة كبيرة. هل تريد المتابعة؟')) return
    const result = await action(`job:${device.id}:${mode}`, {
      action: 'create_job',
      deviceId: device.id,
      mode,
    })
    if (result) setMessage({ type: 'success', text: `تم إرسال طلب النسخ إلى ${device.name}.` })
  }

  async function revoke(device: Device) {
    if (!window.confirm(`إلغاء ربط ${device.name}؟ لن يتمكن هذا الكمبيوتر من استلام طلبات جديدة.`)) return
    const result = await action(`revoke:${device.id}`, { action: 'revoke_device', deviceId: device.id })
    if (result) setMessage({ type: 'success', text: 'تم إلغاء ربط الكمبيوتر وإبطال مفتاحه.' })
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6" dir="rtl">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold">
            <DatabaseBackup className="h-7 w-7" />
            النسخ الاحتياطي وأجهزة النسخ
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            ربط أجهزة Windows وتشغيل النسخ الاحتياطي عليها دون إرسال كلمات مرور قاعدة البيانات إلى التطبيق.
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Plus className="h-5 w-5" /> إضافة كمبيوتر نسخ جديد</CardTitle>
          <CardDescription>
            اكتب اسم الكمبيوتر، نزّل المثبّت عليه، ثم أدخل رمز الربط لمرة واحدة.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={deviceName}
              onChange={(event) => setDeviceName(event.target.value)}
              placeholder="مثال: كمبيوتر النسخ بالمكتب"
              maxLength={80}
            />
            <Button onClick={createPairing} disabled={busy === 'pairing'}>
              {busy === 'pairing' ? <Loader2 className="ml-2 h-4 w-4 animate-spin" /> : <ShieldCheck className="ml-2 h-4 w-4" />}
              إنشاء رمز الربط
            </Button>
          </div>

          {pairing && new Date(pairing.expiresAt).getTime() > now && (
            <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <p className="text-sm font-medium">رمز الربط — صالح حتى {formatDate(pairing.expiresAt)}</p>
                  <div className="mt-2 flex items-center gap-2" dir="ltr">
                    <code className="rounded-lg border bg-background px-4 py-2 text-xl font-bold tracking-widest">
                      {pairing.code}
                    </code>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="نسخ الرمز"
                      onClick={async () => {
                        await navigator.clipboard.writeText(pairing.code)
                        setMessage({ type: 'success', text: 'تم نسخ رمز الربط.' })
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <a href="/backup-agent/install-megamaf-backup-agent.ps1" download>
                  <Button type="button" variant="secondary">
                    <Download className="ml-2 h-4 w-4" />
                    تنزيل مثبّت Windows
                  </Button>
                </a>
              </div>
              <ol className="mt-4 list-decimal space-y-1 pr-5 text-sm text-muted-foreground">
                <li>
                  انقل الملف إلى الكمبيوتر الجديد، ثم شغّله من PowerShell بالأمر
                  <code className="mx-1 rounded bg-background px-1" dir="ltr">
                    powershell -ExecutionPolicy Bypass -File .\install-megamaf-backup-agent.ps1
                  </code>
                </li>
                <li>أدخل رابط التطبيق، رمز الربط، ومجلد حفظ النسخ.</li>
                <li>أدخل بيانات قاعدة البيانات محلياً على ذلك الكمبيوتر؛ لا تُرسل إلى التطبيق.</li>
                <li>بعد نجاح الاختبار سيظهر الكمبيوتر تلقائياً في القائمة أدناه.</li>
              </ol>
            </div>
          )}
        </CardContent>
      </Card>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-semibold">أجهزة النسخ المرتبطة</h2>
          <span className="text-sm text-muted-foreground">{activeDevices.length} جهاز نشط</span>
        </div>

        {loading && devices.length === 0 ? (
          <Card><CardContent className="flex items-center justify-center py-12"><Loader2 className="h-6 w-6 animate-spin" /></CardContent></Card>
        ) : devices.length === 0 ? (
          <Card><CardContent className="py-12 text-center text-muted-foreground">لم يتم ربط أي كمبيوتر بعد.</CardContent></Card>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            {devices.map((device) => (
              <DeviceCard
                key={device.id}
                device={device}
                now={now}
                busy={busy}
                onRun={runBackup}
                onPrimary={async () => {
                  const result = await action(`primary:${device.id}`, { action: 'set_primary', deviceId: device.id })
                  if (result) setMessage({ type: 'success', text: `أصبح ${device.name} جهاز النسخ الأساسي.` })
                }}
                onRevoke={revoke}
              />
            ))}
          </div>
        )}
      </section>

      <Card>
        <CardHeader>
          <CardTitle>سجل طلبات النسخ الأخيرة</CardTitle>
          <CardDescription>يتم تحديث الحالة تلقائياً كل 15 ثانية.</CardDescription>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">لا توجد طلبات نسخ حتى الآن.</p>
          ) : (
            <div className="space-y-3">
              {jobs.map((job) => {
                const device = devices.find((item) => item.id === job.device_id)
                return (
                  <div key={job.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2">
                        <JobIcon status={job.status} />
                        <span className="font-medium">{MODE_LABELS[job.mode]}</span>
                        <span className="text-muted-foreground">— {device?.name ?? 'جهاز غير معروف'}</span>
                      </div>
                      <span className="font-medium">{STATUS_LABELS[job.status]}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>الطلب: {formatDate(job.requested_at)}</span>
                      {job.completed_at && <span>الانتهاء: {formatDate(job.completed_at)}</span>}
                      {job.archive_bytes != null && <span>الحجم: {formatBytes(job.archive_bytes)}</span>}
                      {job.archive_name && <span dir="ltr">{job.archive_name}</span>}
                    </div>
                    {job.error_message && <p className="mt-2 rounded bg-red-50 p-2 text-xs text-red-700">{job.error_message}</p>}
                    {job.status === 'queued' && (
                      <Button
                        className="mt-2"
                        size="sm"
                        variant="outline"
                        disabled={busy === `cancel:${job.id}`}
                        onClick={async () => {
                          const result = await action(`cancel:${job.id}`, { action: 'cancel_job', jobId: job.id })
                          if (result) setMessage({ type: 'success', text: 'تم إلغاء الطلب.' })
                        }}
                      >
                        إلغاء الطلب
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function DeviceCard({
  device,
  now,
  busy,
  onRun,
  onPrimary,
  onRevoke,
}: {
  device: Device
  now: number
  busy: string | null
  onRun: (device: Device, mode: Job['mode']) => void
  onPrimary: () => void
  onRevoke: (device: Device) => void
}) {
  const online =
    device.status === 'active' &&
    !!device.last_seen_at &&
    now - new Date(device.last_seen_at).getTime() < 150_000
  const databaseReady = device.capabilities?.database === true
  const r2Ready = device.capabilities?.r2 === true

  return (
    <Card className={device.status === 'revoked' ? 'opacity-65' : ''}>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2">
              <MonitorCheck className="h-5 w-5" />
              {device.name}
              {device.is_primary && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">أساسي</span>}
            </CardTitle>
            <CardDescription className="mt-1" dir="ltr">{device.hostname ?? 'Waiting for first heartbeat'}</CardDescription>
          </div>
          <span className={`flex items-center gap-1 text-xs font-medium ${online ? 'text-emerald-700' : 'text-muted-foreground'}`}>
            <span className={`h-2 w-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-slate-400'}`} />
            {device.status === 'revoked' ? 'ملغي' : online ? 'متصل' : 'غير متصل'}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <Info label="آخر اتصال" value={device.last_seen_at ? formatDate(device.last_seen_at) : 'لم يتصل بعد'} />
          <Info label="المساحة المتاحة" value={device.free_disk_bytes != null ? formatBytes(device.free_disk_bytes) : '—'} />
          <Info label="قاعدة البيانات" value={databaseReady ? 'جاهزة' : 'غير مهيأة'} good={databaseReady} />
          <Info label="ملفات R2" value={r2Ready ? 'جاهزة' : 'غير مهيأة'} good={r2Ready} />
        </dl>
        {device.backup_path && <p className="truncate rounded bg-muted px-3 py-2 text-xs" dir="ltr" title={device.backup_path}>{device.backup_path}</p>}
        {device.last_error && <p className="rounded bg-red-50 p-2 text-xs text-red-700">{device.last_error}</p>}

        {device.status === 'active' && (
          <>
            <div className="grid gap-2 sm:grid-cols-3">
              <Button size="sm" disabled={!databaseReady || busy !== null} onClick={() => onRun(device, 'database')}>
                <Play className="ml-1 h-3.5 w-3.5" /> قاعدة البيانات
              </Button>
              <Button size="sm" variant="secondary" disabled={!databaseReady || !r2Ready || busy !== null} onClick={() => onRun(device, 'incremental')}>
                <Play className="ml-1 h-3.5 w-3.5" /> يومية آمنة
              </Button>
              <Button size="sm" variant="outline" disabled={!databaseReady || !r2Ready || busy !== null} onClick={() => onRun(device, 'full')}>
                <HardDrive className="ml-1 h-3.5 w-3.5" /> كاملة
              </Button>
            </div>
            <div className="flex flex-wrap gap-2 border-t pt-3">
              {!device.is_primary && (
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={onPrimary}>
                  <Star className="ml-1 h-3.5 w-3.5" /> تعيين كأساسي
                </Button>
              )}
              <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => onRevoke(device)}>
                <CircleOff className="ml-1 h-3.5 w-3.5" /> إلغاء الربط
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Info({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`mt-0.5 font-medium ${good ? 'text-emerald-700' : ''}`}>{value}</dd>
    </div>
  )
}

function JobIcon({ status }: { status: Job['status'] }) {
  if (status === 'completed') return <CheckCircle2 className="h-4 w-4 text-emerald-600" />
  if (status === 'failed') return <XCircle className="h-4 w-4 text-red-600" />
  if (status === 'running') return <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
  return <Clock3 className="h-4 w-4 text-amber-600" />
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ar-EG', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
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
  return error instanceof Error ? error.message : 'حدث خطأ غير متوقع'
}
