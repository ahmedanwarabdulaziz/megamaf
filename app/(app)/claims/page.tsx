import { Fragment } from 'react';
import Link from 'next/link';
import { Eye } from 'lucide-react';
import { getClaims } from '@/lib/queries/claims';
import { getProjects } from '@/lib/queries/projects';
import { getProfile } from '@/lib/supabase/get-profile';
import { requirePageAccess } from '@/lib/require-page-access';

export const dynamic = 'force-dynamic';

import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/money';
import { computeClaimFinancials, remainingLabel, remainingColorClass } from '@/lib/claim-financials';
import { ClaimApproveRejectButtons, RevertClaimToPendingButton } from '@/components/claims/approve-reject-buttons';
import { ClaimHistory } from '@/components/claims/claim-history';
import { ClaimsFilters } from '@/components/claims/claims-filters';

export const metadata = {
  title: 'المستخلصات',
};

export default async function ClaimsPage({
  searchParams,
}: {
  searchParams: Promise<{ project_id?: string }>;
}) {
  const { project_id } = await searchParams;
  await requirePageAccess('claims');
  const { profile } = await getProfile();
  if (!profile) return null;

  const { createClient } = await import('@/lib/supabase/server');
  const supabase = await createClient();

  const [allClaims, projects] = await Promise.all([
    getClaims('vendor', { projectId: project_id }),
    getProjects(),
  ]);

  // Build "how much has actually been paid" per vendor+project purely from
  // allocation-tracking views (v_claim_paid / v_invoice_paid / v_retention_paid),
  // each grouped by the document's OWN project_id, plus claim#0's opening_paid_amount —
  // NOT from the payment ledger row's project tag. A single payment can be split (via
  // payment_allocations) across documents in different projects, and the ledger row's
  // project_id — a single value — can't represent that split correctly.
  const realClaims = allClaims.filter((c: any) => !c.is_prior_only);
  const claimIdsForPaid = realClaims.map((c: any) => c.id);
  const partyIds = [...new Set(realClaims.map((c: any) => c.party_id))];

  const [
    { data: claimPaidData },
    { data: vendorInvoices },
    { data: vendorRetentions },
  ] = await Promise.all([
    claimIdsForPaid.length > 0
      ? supabase.from('v_claim_paid').select('claim_id, paid_amount').in('claim_id', claimIdsForPaid)
      : Promise.resolve({ data: [] as any[] }),
    partyIds.length > 0
      ? supabase.from('invoices').select('id, vendor_id, project_id').in('vendor_id', partyIds).eq('status', 'approved')
      : Promise.resolve({ data: [] as any[] }),
    partyIds.length > 0
      ? supabase.from('retention_releases').select('id, party_id, project_id').in('party_id', partyIds).eq('claim_type', 'vendor')
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const invoiceIds = (vendorInvoices || []).map((i: any) => i.id);
  const retentionIds = (vendorRetentions || []).map((r: any) => r.id);

  const [
    { data: invoicePaidData },
    { data: retentionPaidData },
  ] = await Promise.all([
    invoiceIds.length > 0
      ? supabase.from('v_invoice_paid').select('invoice_id, paid_amount').in('invoice_id', invoiceIds)
      : Promise.resolve({ data: [] as any[] }),
    retentionIds.length > 0
      ? supabase.from('v_retention_paid').select('retention_id, paid_amount').in('retention_id', retentionIds)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const vendorProjectPaid = new Map<string, number>();
  const addPaid = (partyId: string, projectId: string | null | undefined, amount: number) => {
    if (!projectId || !amount) return;
    const k = `${partyId}__${projectId}`;
    vendorProjectPaid.set(k, (vendorProjectPaid.get(k) || 0) + amount);
  };

  // NOTE: v_claim_paid already folds claim#0's opening_paid_amount into its
  // paid_amount on this database (confirmed against live data — this isn't in
  // the local migration files, so treat the live view as ground truth). Do NOT
  // add opening_paid_amount again here, or claim#0 rows get double-counted.
  const claimById = new Map(realClaims.map((c: any) => [c.id, c]));
  for (const row of claimPaidData || []) {
    const c = claimById.get(row.claim_id);
    if (c) addPaid((c as any).party_id, (c as any).project_id, Number(row.paid_amount || 0));
  }

  const invoiceById = new Map((vendorInvoices || []).map((i: any) => [i.id, i]));
  for (const row of invoicePaidData || []) {
    const inv = invoiceById.get(row.invoice_id);
    if (inv) addPaid((inv as any).vendor_id, (inv as any).project_id, Number(row.paid_amount || 0));
  }

  const retentionById = new Map((vendorRetentions || []).map((r: any) => [r.id, r]));
  for (const row of retentionPaidData || []) {
    const ret = retentionById.get(row.retention_id);
    if (ret) addPaid((ret as any).party_id, (ret as any).project_id, Number(row.paid_amount || 0));
  }

  // Group by party_id + project_id; query is already DESC by claim_number
  const groupMap = new Map<string, typeof allClaims>();
  for (const claim of allClaims) {
    const key = `${claim.party_id}__${claim.project_id}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(claim);
  }
  const groups = Array.from(groupMap.values());

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">مستخلصات المقاولين</h1>
        <Link href="/claims/create">
          <Button>تسجيل مستخلص جديد</Button>
        </Link>
      </div>

      <ClaimsFilters 
        projects={projects || []} 
        selectedProjectId={project_id || ''} 
      />

      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="p-3 font-medium">المستخلص</th>
                <th className="p-3 font-medium">الجهة</th>
                <th className="p-3 font-medium">المشروع</th>
                <th className="p-3 font-medium">التاريخ</th>
                <th className="p-3 font-medium">الحالة</th>
                <th className="p-3 font-medium">الإجمالي التراكمي</th>
                <th className="p-3 font-medium">المحتجز</th>
                <th className="p-3 font-medium">الصافي التراكمي</th>
                <th className="p-3 font-medium">المدفوع</th>
                <th className="p-3 font-medium">المتبقي</th>
                <th className="p-3 font-medium">إجراءات</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {groups.length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-muted-foreground">لا توجد مستخلصات</td>
                </tr>
              ) : (
                groups.map(group => {
                  const claim   = group[0];         // latest
                  const history = group.slice(1);   // older / superseded
                  const totals  = claim.v_claim_totals?.[0];
                  const prior   = (claim as any).vendor_prior_claim;
                  const rowKey  = `${claim.party_id}_${claim.project_id}`;

                  // ── Synthetic Claim #0-only row (vendor has prior but no in-system claims yet) ──
                  if ((claim as any).is_prior_only) {
                    const outstanding =
                      (prior?.prior_certified_amount || 0) -
                      (prior?.prior_paid_amount || 0) -
                      (prior?.prior_retention_held || 0);
                    return (
                      <tr key={rowKey} className="bg-amber-50/40 dark:bg-amber-950/10 hover:bg-amber-50/70 dark:hover:bg-amber-950/20 transition-colors">
                        <td className="p-3">
                          <div className="font-bold whitespace-nowrap">رصيد افتتاحي — #0</div>
                          <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200 whitespace-nowrap">
                            تاريخي (قبل النظام)
                          </span>
                        </td>
                        <td className="p-3 font-medium">{claim.party_name}</td>
                        <td className="p-3 text-muted-foreground">{claim.project?.name}</td>
                        <td className="p-3 whitespace-nowrap">{claim.claim_date}</td>
                        <td className="p-3">—</td>
                        <td className="p-3 font-semibold whitespace-nowrap">{formatMoney(prior?.prior_certified_amount || 0)}</td>
                        <td className="p-3 text-amber-600 whitespace-nowrap">{(prior?.prior_retention_held || 0) > 0 ? formatMoney(prior.prior_retention_held) : '-'}</td>
                        <td className="p-3">-</td>
                        <td className="p-3 text-green-600 font-medium whitespace-nowrap">{formatMoney(prior?.prior_paid_amount || 0)}</td>
                        <td className="p-3 font-bold text-amber-600 dark:text-amber-400 whitespace-nowrap">{formatMoney(outstanding)}</td>
                        <td className="p-3">
                          <Link
                            href={`/claims/create?party_id=${claim.party_id}&project_id=${claim.project_id}`}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors whitespace-nowrap"
                          >
                            ➕ تسجيل مستخلص #1
                          </Link>
                        </td>
                      </tr>
                    );
                  }

                  const vpc = (claim as any).vendor_prior_claim;
                  // NOTE: vendorProjectPaid (built above) already folds claim#0's
                  // opening_paid_amount in, so paidInSystem already includes it.
                  // We pass openingPaid:0 to avoid double-counting in the formula.
                  // We still display it separately as an informational line.
                  const fin = computeClaimFinancials({
                    claimCumulativeTotal:    totals?.claim_cumulative_total    || 0,
                    claimCumulativeRetained: totals?.claim_cumulative_retained || 0,
                    priorCertifiedAmount: Number(vpc?.prior_certified_amount || 0),
                    priorRetentionHeld:   Number(vpc?.prior_retention_held   || 0),
                    taxEnabled: !!(claim as any).tax_enabled,
                    taxRate:    Number((claim as any).tax_rate || 0),
                    paidInSystem: vendorProjectPaid.get(`${claim.party_id}__${claim.project_id}`) || 0,
                    openingPaid:  0,  // already folded into paidInSystem via v_vendor_account
                    claimNumber:  (claim as any).claim_number ?? 0,
                  });
                  // Display-only: the pre-system paid amount for informational purposes
                  const openingPaidDisplay = Number((claim as any).opening_paid_amount || 0);

                  return (
                    <Fragment key={rowKey}>
                      <tr className="hover:bg-muted/30 transition-colors">
                        <td className="p-3">
                          <div className="font-bold whitespace-nowrap">
                            {claim.claim_number === 0 ? 'مستخلص #0' : `مستخلص #${claim.claim_number}`}
                          </div>
                        </td>
                        <td className="p-3 font-medium">{claim.party_name}</td>
                        <td className="p-3 text-muted-foreground">{claim.project?.name}</td>
                        <td className="p-3 whitespace-nowrap">{claim.claim_date}</td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap ${
                            claim.status === 'approved'
                              ? 'bg-primary text-primary-foreground'
                              : claim.status === 'rejected'
                              ? 'bg-destructive text-destructive-foreground'
                              : 'bg-secondary text-secondary-foreground'
                          }`}>
                            {claim.status === 'approved' ? 'معتمد' : claim.status === 'rejected' ? 'مرفوض' : 'قيد المراجعة'}
                          </span>
                        </td>
                        <td className="p-3 font-semibold whitespace-nowrap">{formatMoney(fin.grossTotal)}</td>
                        <td className="p-3 text-amber-600 whitespace-nowrap">{fin.retained > 0 ? formatMoney(fin.retained) : '-'}</td>
                        <td className="p-3 whitespace-nowrap">
                          {formatMoney(fin.netCumulative)}
                          {fin.tax > 0 && (
                            <div className="text-xs text-muted-foreground">+ {formatMoney(fin.tax)} ضريبة</div>
                          )}
                        </td>
                        <td className="p-3 text-green-700 dark:text-green-400 font-medium whitespace-nowrap">
                          {fin.paidInSystem > 0 ? formatMoney(fin.paidInSystem) : '-'}
                          {openingPaidDisplay > 0 && (
                            <div className="text-xs text-amber-600 dark:text-amber-500">منها {formatMoney(openingPaidDisplay)} قبل النظام</div>
                          )}
                        </td>
                        <td className="p-3">
                          <div className={`font-bold whitespace-nowrap ${remainingColorClass(fin.remaining)}`}>
                            {fin.remaining < 0 ? `(${formatMoney(Math.abs(fin.remaining))})` : formatMoney(fin.remaining)}
                          </div>
                          <div className="text-xs text-muted-foreground">{remainingLabel(fin.remaining)}</div>
                        </td>
                        <td className="p-3">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Link
                              href={`/claims/${claim.id}`}
                              title="عرض المستخلص"
                              className="inline-flex items-center justify-center w-8 h-8 rounded-lg border text-muted-foreground hover:text-primary hover:border-primary transition-colors"
                            >
                              <Eye className="w-4 h-4" />
                            </Link>
                            {claim.status === 'pending' && (
                              <Link
                                href={`/claims/${claim.id}/edit`}
                                className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors whitespace-nowrap"
                              >
                                ✏️ تعديل
                              </Link>
                            )}
                            {claim.status === 'pending' && (profile.can_approve || profile.is_super_admin) && (
                              <ClaimApproveRejectButtons claimId={claim.id} />
                            )}
                            {claim.status === 'approved' && (
                              <>
                                <Link
                                  href={`/claims/create?party_id=${claim.party_id}&project_id=${claim.project_id}`}
                                  className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors whitespace-nowrap"
                                >
                                  المستخلص التالي ←
                                </Link>
                                {claim.claim_number !== 0 && profile.is_super_admin && (
                                  <RevertClaimToPendingButton claimId={claim.id} />
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* ── Collapsible history of older claims ── */}
                      {(history.length > 0 || !!(claim as any).vendor_prior_claim) && (
                        <tr>
                          <td colSpan={11} className="p-0">
                            <ClaimHistory
                              claims={history}
                              priorClaim={(claim as any).vendor_prior_claim || null}
                            />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
