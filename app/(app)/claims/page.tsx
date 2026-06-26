import Link from 'next/link';
import { getClaims } from '@/lib/queries/claims';
import { getProjects } from '@/lib/queries/projects';
import { getProfile } from '@/lib/supabase/get-profile';

export const dynamic = 'force-dynamic';

import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/money';
import { ClaimApproveRejectButtons } from '@/components/claims/approve-reject-buttons';
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
  const { profile } = await getProfile();
  if (!profile) return null;

  const [allClaims, projects] = await Promise.all([
    getClaims('vendor', { projectId: project_id }),
    getProjects()
  ]);

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

      <div className="bg-card rounded-lg border shadow-sm divide-y">
        {groups.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">لا توجد مستخلصات</div>
        ) : (
          groups.map(group => {
            const claim   = group[0];         // latest
            const history = group.slice(1);   // older / superseded
            const totals  = claim.v_claim_totals?.[0];
            const prior   = (claim as any).vendor_prior_claim;

            // ── Synthetic Claim #0-only card (vendor has prior but no in-system claims yet) ──
            if ((claim as any).is_prior_only) {
              const outstanding =
                (prior?.prior_certified_amount || 0) -
                (prior?.prior_paid_amount || 0) -
                (prior?.prior_retention_held || 0);
              return (
                <div key={`${claim.party_id}_${claim.project_id}`}>
                  <div className="p-4 flex flex-col sm:flex-row justify-between sm:items-start gap-6 bg-amber-50/40 dark:bg-amber-950/10">

                    {/* Left: identity */}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-bold">رصيد افتتاحي — مستخلص #0</h3>
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200">
                          تاريخي (قبل النظام)
                        </span>
                      </div>
                      <p className="text-sm font-medium">{claim.party_name}</p>
                      <p className="text-sm text-muted-foreground">{claim.project?.name}</p>
                      <p className="text-xs text-muted-foreground mt-1">تاريخ القطع: {claim.claim_date}</p>
                    </div>

                    {/* Right: prior amounts + action */}
                    <div className="flex flex-col items-end gap-1.5 min-w-[260px]">

                      <div className="flex justify-between w-full gap-6 text-xs text-muted-foreground">
                        <span>الإجمالي المعتمد التراكمي (قبل النظام):</span>
                        <span className="font-medium">{formatMoney(prior?.prior_certified_amount || 0)}</span>
                      </div>

                      <div className="flex justify-between w-full gap-6 text-xs text-green-600">
                        <span>المدفوع قبل النظام:</span>
                        <span className="font-medium">- {formatMoney(prior?.prior_paid_amount || 0)}</span>
                      </div>

                      {(prior?.prior_retention_held || 0) > 0 && (
                        <div className="flex justify-between w-full gap-6 text-xs text-amber-600">
                          <span>المحتجز (تأمين):</span>
                          <span className="font-medium">- {formatMoney(prior?.prior_retention_held || 0)}</span>
                        </div>
                      )}

                      <div className="flex justify-between items-center w-full gap-6 border-t border-amber-300/50 pt-1.5 mt-0.5">
                        <span className="text-sm font-semibold">المتبقي المستحق (قبل النظام):</span>
                        <span className="text-xl font-bold text-amber-600 dark:text-amber-400 whitespace-nowrap">
                          {formatMoney(outstanding)}
                        </span>
                      </div>

                      {/* Action */}
                      <div className="flex items-center gap-2 flex-wrap justify-end mt-1">
                        <Link
                          href={`/claims/create?party_id=${claim.party_id}&project_id=${claim.project_id}`}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
                        >
                          ➕ تسجيل مستخلص #1
                        </Link>
                      </div>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div key={`${claim.party_id}_${claim.project_id}`}>

                {/* ── Latest claim card ── */}
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
                    <p className="text-sm font-medium">{claim.party_name}</p>
                    <p className="text-sm text-muted-foreground">{claim.project?.name}</p>
                    <p className="text-xs text-muted-foreground mt-1">التاريخ: {claim.claim_date}</p>
                  </div>

                  {/* Right: financial summary + actions */}
                  <div className="flex flex-col items-end gap-1.5 min-w-[260px]">

                    {/* Gross total */}
                    <div className="flex justify-between w-full gap-6 text-xs text-muted-foreground">
                      <span>إجمالي الأعمال التراكمي:</span>
                      <span className="font-medium">{formatMoney(totals?.claim_cumulative_total || 0)}</span>
                    </div>

                    {/* Retention */}
                    <div className="flex justify-between w-full gap-6 text-xs text-amber-600">
                      <span>المحتجز التراكمي (تأمين):</span>
                      <span className="font-medium">- {formatMoney(totals?.claim_cumulative_retained || 0)}</span>
                    </div>

                    {/* Net cumulative */}
                    <div className="flex justify-between w-full gap-6 text-xs text-muted-foreground border-t border-muted/40 pt-1">
                      <span>الصافي التراكمي:</span>
                      <span className="font-medium">{formatMoney(totals?.claim_cumulative_payable || 0)}</span>
                    </div>

                    {/* Paid from ledger */}
                    <div className="flex justify-between w-full gap-6 text-xs text-green-600">
                      <span>المدفوع فعلياً:</span>
                      <span className="font-medium">- {formatMoney(totals?.prior_cumulative_payable || 0)}</span>
                    </div>

                    {/* Net due — headline number */}
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
                          href={`/claims/${claim.id}/edit`}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 transition-colors"
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
                            href={claim.claim_type === 'owner' ? `/treasury/receive/${claim.party_id}` : `/treasury/pay/${claim.party_id}`}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 transition-colors"
                          >
                            {claim.claim_type === 'owner' ? '💰 تحصيل دفعة' : '💸 تسجيل دفعة'}
                          </Link>
                          <Link
                            href={`/claims/create?party_id=${claim.party_id}&project_id=${claim.project_id}`}
                            className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 transition-colors"
                          >
                            المستخلص التالي ←
                          </Link>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* ── Collapsible history of older claims ── */}
                <ClaimHistory
                  claims={history}
                  priorClaim={(claim as any).vendor_prior_claim || null}
                />
              </div>
            );
          })

        )}
      </div>
    </div>
  );
}
