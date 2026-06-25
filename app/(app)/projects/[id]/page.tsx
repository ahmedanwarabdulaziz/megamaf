import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Building2, Plus, Calendar, FileText, Pencil } from 'lucide-react'
import { formatMoney } from '@/lib/money'
import { DeleteScheduleRowButton } from './delete-schedule-row-button'
import { AddScheduleRowForm } from './add-schedule-row-form'
import { ClaimApproveRejectButtons } from '@/components/claims/approve-reject-buttons'
import { ClaimHistory } from '@/components/claims/claim-history'
import { ProjectModal } from '../_components/project-modal'
import { OpeningBalanceForm } from './opening-balance-form'

export default async function ProjectDetailPage({ 
  params,
  searchParams 
}: { 
  params: Promise<{ id: string }>,
  searchParams: Promise<{ tab?: string }>
}) {
  const { id } = await params
  const { tab = 'overview' } = await searchParams
  const supabase = await createClient()

  const { data: project } = await supabase
    .from('projects')
    .select(`*, project_owners(name)`)
    .eq('id', id)
    .single()

  if (!project) notFound()

  const { data: { user } } = await supabase.auth.getUser()
  const { data: profile } = await supabase
    .from('employees')
    .select('can_approve, is_super_admin')
    .eq('auth_user_id', user?.id ?? '')
    .single()
  const canEdit = !!profile?.is_super_admin

  // Owners + all projects (for the edit modal: owner dropdown + parent lookup)
  const [{ data: owners }, { data: allProjects }] = await Promise.all([
    supabase.from('project_owners').select('id, name').order('name'),
    supabase.from('projects').select('*').order('sort_order'),
  ])

  // Fetch financial position
  const { data: finances } = await supabase
    .from('v_project_financial_position')
    .select('*')
    .eq('project_id', id)
    .single()

  // Fetch owner claims
  const { data: ownerClaims } = await supabase
    .from('claims')
    .select(`*`)
    .eq('project_id', id)
    .eq('claim_type', 'owner')
    .order('claim_number', { ascending: false })

  if (ownerClaims && ownerClaims.length > 0) {
    const claimIds = ownerClaims.map(c => c.id)
    const { data: claimTotals } = await supabase.from('v_claim_totals').select('*').in('claim_id', claimIds)
    const { data: claimPaid } = await supabase.from('v_claim_paid').select('*').in('claim_id', claimIds)
    ownerClaims.forEach((c: any) => {
      c.v_claim_totals = claimTotals?.filter(t => t.claim_id === c.id) || []
      c.v_claim_paid = claimPaid?.filter(p => p.claim_id === c.id) || []
    })
  }

  // Fetch schedule
  const { data: scheduleRows } = await supabase
    .from('owner_payment_schedule')
    .select('*')
    .eq('project_id', id)
    .order('due_date', { ascending: true })

  const isMainCompany = project.node_type === 'main_company';

  // ── Opening Balance data (only for non-main-company when admin) ──
  let financialBalance: any = null
  let vendorPriorClaims: any[] = []
  let openingStockEntries: any[] = []
  let vendors: any[] = []
  let warehouses: any[] = []
  let inventoryItems: any[] = []

  if (!isMainCompany && canEdit) {
    const [
      { data: ob },
      { data: vpc },
      { data: ose },
      { data: v },
      { data: wh },
      { data: items },
    ] = await Promise.all([
      supabase.from('project_opening_balances').select('*').eq('project_id', id).maybeSingle(),
      supabase.from('vendor_prior_claims').select('*, vendors(name)').eq('project_id', id).order('created_at'),
      supabase.from('opening_stock_entries').select('*, warehouses(name), inventory_items(name,unit)').eq('project_id', id).order('created_at'),
      supabase.from('vendors').select('id, name').order('name'),
      supabase.from('warehouses').select('id, name, project_id'),
      supabase.from('inventory_items').select('id, name, unit, code').order('name'),
    ])
    financialBalance = ob || null
    vendorPriorClaims = (vpc || []).map((c: any) => ({
      ...c,
      vendor_name: c.vendors?.name,
    }))
    openingStockEntries = (ose || []).map((e: any) => ({
      ...e,
      warehouse_name: e.warehouses?.name,
      item_name: e.inventory_items?.name,
      item_unit: e.inventory_items?.unit,
    }))
    vendors = v || []
    warehouses = wh || []
    inventoryItems = items || []
  }

  const hasOpeningBalance = finances?.has_opening_balance
  const cutoffDate = financialBalance?.cutoff_date || new Date().toISOString().split('T')[0]

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 bg-card p-4 rounded-lg border shadow-sm">
        <Building2 className="h-10 w-10 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <p className="text-muted-foreground text-sm flex gap-2 items-center">
            {project.code && <span className="font-mono bg-muted px-1.5 rounded">{project.code}</span>}
            <span>
              {isMainCompany ? 'الشركة الرئيسية' :
               project.node_type === 'project' ? 'مشروع' :
               project.node_type === 'branch' ? 'فرع' : 'مرحلة'}
            </span>
          </p>
        </div>
        {canEdit && (
          <Link
            href={`/projects/${id}?tab=${tab}&modal=edit-project&id=${id}`}
            className="mr-auto inline-flex items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium transition-colors hover:bg-accent"
          >
            <Pencil className="h-4 w-4" />
            تعديل المشروع
          </Link>
        )}
      </div>

      <div className="flex gap-2 border-b overflow-x-auto pb-1">
        <Link href={`/projects/${id}?tab=overview`} className={`px-4 py-2 font-medium text-sm whitespace-nowrap border-b-2 transition-colors ${tab === 'overview' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
          نظرة عامة
        </Link>
        {!isMainCompany && (
          <>
            <Link href={`/projects/${id}?tab=claims`} className={`px-4 py-2 font-medium text-sm whitespace-nowrap border-b-2 transition-colors ${tab === 'claims' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
              مستخلصات المالك
            </Link>
            <Link href={`/projects/${id}?tab=schedule`} className={`px-4 py-2 font-medium text-sm whitespace-nowrap border-b-2 transition-colors ${tab === 'schedule' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
              جدول الدفعات المتوقعة
            </Link>
            {canEdit && (
              <Link href={`/projects/${id}?tab=opening-balance`} className={`px-4 py-2 font-medium text-sm whitespace-nowrap border-b-2 transition-colors flex items-center gap-1.5 ${tab === 'opening-balance' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>
                ⚖️ الرصيد الافتتاحي
                {hasOpeningBalance && <span className="inline-block w-2 h-2 rounded-full bg-primary" />}
              </Link>
            )}
          </>
        )}
      </div>

      {tab === 'overview' && (
        <div className="space-y-4">
          {hasOpeningBalance && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 p-4 space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-base">⚖️</span>
                <h3 className="font-semibold text-sm text-amber-800 dark:text-amber-200">
                  الرصيد الافتتاحي — تاريخ التقطيع: {finances?.opening_cutoff_date}
                </h3>
                {canEdit && (
                  <Link href={`/projects/${id}?tab=opening-balance`}
                    className="mr-auto text-xs text-amber-700 hover:text-amber-900 underline">
                    تعديل
                  </Link>
                )}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                <div className="bg-white dark:bg-card rounded-lg p-3 border border-amber-100">
                  <p className="text-xs text-muted-foreground mb-0.5">إيرادات سابقة</p>
                  <p className="font-bold text-green-600">{formatMoney(finances?.prior_owner_income || 0)}</p>
                </div>
                <div className="bg-white dark:bg-card rounded-lg p-3 border border-amber-100">
                  <p className="text-xs text-muted-foreground mb-0.5">مصروفات سابقة</p>
                  <p className="font-bold text-destructive">{formatMoney(finances?.prior_expenses || 0)}</p>
                </div>
                <div className="bg-white dark:bg-card rounded-lg p-3 border border-amber-100">
                  <p className="text-xs text-muted-foreground mb-0.5">مخزون افتتاحي (أصل)</p>
                  <p className="font-bold text-primary">{formatMoney(finances?.inventory_asset_value || 0)}</p>
                </div>
                <div className="bg-white dark:bg-card rounded-lg p-3 border border-amber-100">
                  <p className="text-xs text-muted-foreground mb-0.5">مقاولون سابقون</p>
                  <p className="font-bold">{finances?.prior_vendor_count || 0} مقاول</p>
                  {(finances?.prior_vendor_certified || 0) > 0 && (
                    <p className="text-xs text-muted-foreground">{formatMoney(finances?.prior_vendor_certified || 0)} إجمالي</p>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">المالك</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-lg font-medium">{project.project_owners?.name || 'غير محدد'}</p>
                {canEdit && !isMainCompany && !project.owner_id && (
                  <Link href={`/projects/${id}?tab=${tab}&modal=edit-project&id=${id}`} className="text-sm text-primary hover:underline mt-1 inline-block">
                    + تعيين مالك
                  </Link>
                )}
                {canEdit && !isMainCompany && (!owners || owners.length === 0) && (
                  <p className="text-xs text-amber-600 mt-1">
                    لا يوجد ملاك. <Link href="/settings/owners" className="underline">أضف مالكاً أولاً</Link>
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">إجمالي الإيرادات المعتمدة</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-lg font-medium text-green-600">{formatMoney(finances?.total_income || 0)}</p>
                {hasOpeningBalance && (finances?.prior_owner_income || 0) > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">منها سابقة: {formatMoney(finances?.prior_owner_income || 0)}</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">إجمالي المصروفات المعتمدة</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-lg font-medium text-destructive">{formatMoney(finances?.total_expenses || 0)}</p>
                {hasOpeningBalance && (finances?.prior_expenses || 0) > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">منها سابقة: {formatMoney(finances?.prior_expenses || 0)}</p>
                )}
              </CardContent>
            </Card>

            {(finances?.inventory_asset_value || 0) > 0 && (
              <Card className="border-primary/20 bg-primary/5">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-muted-foreground">قيمة المخزون الحالي (أصل)</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-lg font-medium text-primary">{formatMoney(finances?.inventory_asset_value || 0)}</p>
                  <p className="text-xs text-muted-foreground mt-1">متوسط تكلفة المواد الموجودة في المستودعات</p>
                </CardContent>
              </Card>
            )}
            
            <Card className={`${(finances?.inventory_asset_value || 0) > 0 ? 'md:col-span-2' : 'md:col-span-3'} bg-muted/30`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground">الرصيد (الإيرادات - المصروفات)</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-2xl font-bold ${(finances?.balance || 0) >= 0 ? 'text-green-600' : 'text-destructive'}`}>
                  {formatMoney(finances?.balance || 0)}
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {tab === 'claims' && !isMainCompany && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold">مستخلصات المالك</h2>
            {project.owner_id && (
              <Link href={`/projects/${id}/owner-claims/create`} className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2">
                <Plus className="w-4 h-4 mr-2" />
                تسجيل مستخلص مالك
              </Link>
            )}
            {!project.owner_id && (
              <p className="text-sm text-amber-600">يجب تحديد مالك للمشروع أولاً</p>
            )}
          </div>

          <div className="bg-card rounded-lg border shadow-sm divide-y">
            {(!ownerClaims || ownerClaims.length === 0) ? (
              <div className="text-center p-8 text-muted-foreground">
                لا يوجد مستخلصات مالك مسجلة بعد.
              </div>
            ) : (() => {
              // Group by party_id — same cumulative pattern as /claims
              const groupMap = new Map<string, typeof ownerClaims>();
              for (const c of ownerClaims) {
                const key = c.party_id;
                if (!groupMap.has(key)) groupMap.set(key, []);
                groupMap.get(key)!.push(c);
              }
              return Array.from(groupMap.values()).map(group => {
                const claim   = group[0];       // latest (already DESC order)
                const history = group.slice(1); // older / superseded
                const totals  = (claim as any).v_claim_totals?.[0];

                return (
                  <div key={claim.id}>
                    {/* ── Latest claim card — matches /claims layout ── */}
                    <div className="p-4 flex flex-col sm:flex-row justify-between sm:items-start gap-6">

                      {/* Left: identity */}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-bold">مستخلص رقم {claim.claim_number}</h3>
                          <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${
                            claim.status === 'approved'
                              ? 'bg-primary text-primary-foreground'
                              : claim.status === 'rejected'
                              ? 'bg-destructive text-destructive-foreground'
                              : 'bg-secondary text-secondary-foreground'
                          }`}>
                            {claim.status === 'approved' ? 'معتمد' : claim.status === 'rejected' ? 'مرفوض' : 'قيد المراجعة'}
                          </span>
                        </div>
                        <p className="text-sm font-medium">{project.project_owners?.name}</p>
                        <p className="text-xs text-muted-foreground mt-1">التاريخ: {claim.claim_date}</p>
                      </div>

                      {/* Right: financial breakdown + actions — identical to /claims */}
                      <div className="flex flex-col items-end gap-1.5 min-w-[260px]">

                        {/* Gross cumulative total */}
                        <div className="flex justify-between w-full gap-6 text-xs text-muted-foreground">
                          <span>إجمالي الأعمال التراكمي:</span>
                          <span className="font-medium">{formatMoney(totals?.claim_cumulative_total || 0)}</span>
                        </div>

                        {/* Retention */}
                        <div className="flex justify-between w-full gap-6 text-xs text-amber-600">
                          <span>المحتجز التراكمي (تأمين):</span>
                          <span className="font-medium">- {formatMoney(totals?.claim_cumulative_retained || 0)}</span>
                        </div>

                        {/* Net cumulative payable */}
                        <div className="flex justify-between w-full gap-6 text-xs text-muted-foreground border-t border-muted/40 pt-1">
                          <span>الصافي التراكمي:</span>
                          <span className="font-medium">{formatMoney(totals?.claim_cumulative_payable || 0)}</span>
                        </div>

                        {/* Already collected */}
                        <div className="flex justify-between w-full gap-6 text-xs text-green-600">
                          <span>المحصّل فعلياً:</span>
                          <span className="font-medium">- {formatMoney(totals?.prior_cumulative_payable || 0)}</span>
                        </div>

                        {/* Net outstanding — headline */}
                        <div className="flex justify-between items-center w-full gap-6 border-t border-primary/20 pt-1.5 mt-0.5">
                          <span className="text-sm font-semibold">الصافي الحالي (المستحق):</span>
                          <span className="text-xl font-bold text-primary whitespace-nowrap">
                            {formatMoney(totals?.total_due_this_claim || 0)}
                          </span>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-2 flex-wrap justify-end mt-1">
                          {claim.status === 'pending' && (
                            <Link
                              href={`/projects/${id}/owner-claims/${claim.id}/edit`}
                              className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors"
                            >
                              ✏️ تعديل
                            </Link>
                          )}
                          {claim.status === 'pending' && (profile?.can_approve || profile?.is_super_admin) && (
                            <ClaimApproveRejectButtons claimId={claim.id} />
                          )}
                          {claim.status === 'approved' && (
                            <>
                              <Link
                                href={`/treasury/receive/${claim.party_id}`}
                                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-colors"
                              >
                                💰 تحصيل دفعة
                              </Link>
                              <Link
                                href={`/projects/${id}/owner-claims/create?party_id=${claim.party_id}&project_id=${id}`}
                                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
                              >
                                المستخلص التالي ←
                              </Link>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* ── Collapsible older claims ── */}
                    <ClaimHistory
                      claims={history.map((c: any) => ({
                        id: c.id,
                        claim_number: c.claim_number,
                        claim_date: c.claim_date,
                        status: c.status,
                        v_claim_totals: c.v_claim_totals,
                      }))}
                      priorClaim={null}
                    />
                  </div>
                );
              });
            })()}
          </div>
        </div>
      )}

      {tab === 'schedule' && !isMainCompany && (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-bold">جدول الدفعات المتوقعة</h2>
          </div>

          <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-right">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="p-3 font-medium">تاريخ الاستحقاق</th>
                    <th className="p-3 font-medium">المبلغ المتوقع</th>
                    <th className="p-3 font-medium">طريقة الدفع (اختياري)</th>
                    <th className="p-3 font-medium">ملاحظات</th>
                    <th className="p-3 font-medium">الحالة</th>
                    <th className="p-3 font-medium w-16"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {scheduleRows?.map(row => (
                    <tr key={row.id}>
                      <td className="p-3">{row.due_date}</td>
                      <td className="p-3 font-medium text-primary">{formatMoney(row.expected_amount)}</td>
                      <td className="p-3 text-muted-foreground">{row.method || '-'}</td>
                      <td className="p-3 text-muted-foreground">{row.notes || '-'}</td>
                      <td className="p-3">
                        <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold ${row.status === 'paid' ? 'bg-primary text-primary-foreground' : row.status === 'partial' ? 'bg-amber-100 text-amber-800' : 'bg-secondary text-secondary-foreground'}`}>
                          {row.status === 'paid' ? 'مدفوع' : row.status === 'partial' ? 'جزئي' : 'متوقع'}
                        </span>
                      </td>
                      <td className="p-3">
                        <DeleteScheduleRowButton id={row.id} projectId={id} />
                      </td>
                    </tr>
                  ))}
                  {(!scheduleRows || scheduleRows.length === 0) && (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-muted-foreground">
                        لا يوجد دفعات متوقعة مسجلة.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            
            <div className="p-4 bg-muted/20 border-t">
              <h3 className="font-semibold mb-3">إضافة دفعة متوقعة</h3>
              <AddScheduleRowForm projectId={id} />
            </div>
          </div>
        </div>
      )}

      {tab === 'opening-balance' && !isMainCompany && canEdit && (
        <div className="space-y-4">
          <div>
            <h2 className="text-xl font-bold">الرصيد الافتتاحي</h2>
            <p className="text-sm text-muted-foreground mt-1">
              سجّل هنا الأعمال والمصروفات والمخزون الموجودة قبل بدء التتبع في النظام.
            </p>
          </div>
          <OpeningBalanceForm
            projectId={id}
            cutoffDate={cutoffDate}
            financialBalance={financialBalance}
            vendorPriorClaims={vendorPriorClaims}
            openingStockEntries={openingStockEntries}
            vendors={vendors}
            warehouses={warehouses}
            inventoryItems={inventoryItems}
          />
        </div>
      )}

      {canEdit && (
        <Suspense fallback={null}>
          <ProjectModal owners={owners || []} projects={allProjects || []} />
        </Suspense>
      )}
    </div>
  )
}
