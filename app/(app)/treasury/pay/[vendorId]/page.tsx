import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { VendorPaymentCalculator } from './calculator';
import { computeClaimFinancials } from '@/lib/claim-financials';
import { requirePageAccess } from '@/lib/require-page-access';
import { getBanks } from '@/lib/queries/banks';

export default async function PayVendorPage({ params }: { params: Promise<{ vendorId: string }> }) {
  await requirePageAccess('treasury');
  const { vendorId } = await params;
  const supabase = await createClient();

  const { data: vendor } = await supabase.from('vendors').select('*, vendor_project_access(project_id)').eq('id', vendorId).single();
  if (!vendor) notFound();

  const [
    banks,
    { data: employees },
    { data: creditEntries },
  ] = await Promise.all([
    getBanks(),
    supabase.from('employees').select('id, full_name').eq('is_active', true).order('full_name'),
    supabase.from('v_vendor_unallocated_credit').select('*').eq('vendor_id', vendorId).order('entry_date'),
  ]);

  // Fetch all open vendor docs
  const { data: docs } = await supabase.from('v_vendor_account').select('*').eq('party_id', vendorId).order('document_date', { ascending: true });
  
  if (docs && docs.length > 0) {
    const claimIds = docs.filter(d => d.document_type === 'claim').map(d => d.document_id);
    const invoiceIds = docs.filter(d => d.document_type === 'invoice').map(d => d.document_id);
    const retentionIds = docs.filter(d => d.document_type === 'retention_release').map(d => d.document_id);

    const [
      { data: claimPaid },
      { data: invoicePaid },
      { data: retentionPaid }
    ] = await Promise.all([
      claimIds.length > 0 ? supabase.from('v_claim_paid').select('*').in('claim_id', claimIds) : { data: null },
      invoiceIds.length > 0 ? supabase.from('v_invoice_paid').select('*').in('invoice_id', invoiceIds) : { data: null },
      retentionIds.length > 0 ? supabase.from('v_retention_paid').select('*').in('retention_id', retentionIds) : { data: null },
    ]);

    docs.forEach(d => {
      if (d.document_type === 'claim') {
        d.amount_paid = claimPaid?.find(p => p.claim_id === d.document_id)?.paid_amount || 0;
      } else if (d.document_type === 'invoice') {
        d.amount_paid = invoicePaid?.find(p => p.invoice_id === d.document_id)?.paid_amount || 0;
      } else if (d.document_type === 'retention_release') {
        d.amount_paid = retentionPaid?.find(p => p.retention_id === d.document_id)?.paid_amount || 0;
      }
    });
  }

  // Fetch prior claims directly since they are no longer in v_vendor_account
  const { data: priorClaims } = await supabase.from('vendor_prior_claims').select('*').eq('vendor_id', vendorId);
  const priorDocs = (priorClaims || []).map(pc => ({
    party_id: pc.vendor_id,
    project_id: pc.project_id,
    document_date: pc.cutoff_date,
    document_type: 'prior_claim',
    document_id: pc.id,
    description: 'مستخلص #0 (رصيد افتتاحي قبل النظام)',
    amount_due: Number(pc.prior_certified_amount || 0),
    amount_paid: Number(pc.prior_paid_amount || 0),
    created_at: pc.created_at
  }));

  // Filter to only keep the LATEST claim per project to avoid double counting cumulative claims
  const latestClaimPerProject = new Map<string, any>();
  
  docs?.forEach(d => {
    if (d.document_type === 'claim') {
      const existing = latestClaimPerProject.get(d.project_id);
      // Keep if it's the first one, or if its document_date is newer
      if (!existing || new Date(d.document_date).getTime() > new Date(existing.document_date).getTime()) {
        latestClaimPerProject.set(d.project_id, d);
      }
    }
  });

  const filteredDocs = docs?.filter(d => 
    d.document_type !== 'claim' || latestClaimPerProject.get(d.project_id)?.document_id === d.document_id
  );

  // Deduplicate: if v_vendor_account (migration 0039+) already returned prior_claim rows,
  // don't add duplicates from the separate vendor_prior_claims fetch.
  // If the view didn't return them (older DB), always include them so prior balances are visible.
  const viewPriorDocIds = new Set(
    filteredDocs?.filter(d => d.document_type === 'prior_claim').map(d => d.document_id) || []
  );
  const filteredPriorDocs = priorDocs.filter(pd => !viewPriorDocIds.has(pd.document_id));

  const allDocs = [...(filteredDocs || []), ...filteredPriorDocs].sort((a, b) => new Date(a.document_date).getTime() - new Date(b.document_date).getTime());


  const { data: projects } = await supabase.from('projects').select('id, name').order('name');

  // Scope the project options offered in the payment form to the vendor's own
  // assignment — a vendor restricted to specific projects must not be tagged
  // with a payment for a project outside that scope, even if the employee can
  // see it via RLS. `projects` (unfiltered) is kept for project-name lookups
  // below, since a claim may reference a project the vendor is no longer scoped to.
  const vendorScopedProjects = vendor.all_projects
    ? projects
    : (projects || []).filter(p => vendor.vendor_project_access?.some((a: any) => a.project_id === p.id));

  // ── Fetch latest approved claim per project for the summary card ──────────
  const { data: latestClaims } = await supabase
    .from('claims')
    .select('id, project_id, claim_number, claim_date, tax_enabled, tax_rate')
    .eq('party_id', vendorId)
    .eq('claim_type', 'vendor')
    .eq('status', 'approved')
    .order('claim_number', { ascending: false })
    .limit(50);

  // Keep only the highest claim_number per project
  const latestClaimPerProjectMap = new Map<string, any>();
  for (const c of latestClaims || []) {
    if (!latestClaimPerProjectMap.has(c.project_id)) {
      latestClaimPerProjectMap.set(c.project_id, c);
    }
  }
  const latestClaimList = Array.from(latestClaimPerProjectMap.values());
  const latestClaimIds = latestClaimList.map(c => c.id);

  const [
    { data: claimTotalsData },
    { data: zeroClaims },
    { data: vendorLedgerPayments },
  ] = await Promise.all([
    latestClaimIds.length > 0
      ? supabase.from('v_claim_totals')
          .select('claim_id, claim_cumulative_total, claim_cumulative_retained, claim_cumulative_payable')
          .in('claim_id', latestClaimIds)
      : { data: [] as any[] },
    supabase.from('claims').select('project_id, opening_paid_amount').eq('party_id', vendorId).eq('claim_type', 'vendor').eq('claim_number', 0),
    supabase.from('ledger_entries').select('project_id, amount').eq('counterparty_type', 'vendor').eq('counterparty_id', vendorId).eq('direction', 'out'),
  ]);

  // Build "how much has actually been paid" per project from the RAW ledger
  // amount that left the treasury, not just the portion formally allocated to a
  // specific claim/invoice/retention (via payment_allocations) — a payment can be
  // left partially or fully unallocated (sitting as vendor credit) and that money
  // is still paid. Mirrors the fix already applied to /claims and v_vendor_balances,
  // see supabase/migrations/20260723120000_fix_vendor_balances_raw_paid.sql — this
  // page was still on the old allocation-based accounting, which understated how
  // much had actually been paid by exactly the vendor's unallocated credit balance,
  // overstating "remaining" here vs. what /vendors/[id]/statement correctly showed.
  const paidByProject = new Map<string, number>();
  const addPaid = (projectId: string | null | undefined, amount: number) => {
    if (!projectId || !amount) return;
    paidByProject.set(projectId, (paidByProject.get(projectId) || 0) + amount);
  };

  for (const row of vendorLedgerPayments || []) {
    addPaid(row.project_id, Number(row.amount || 0));
  }

  // Opening balance paid before the system — not a ledger row, so add it separately.
  const openingPaidByProject = new Map<string, number>();
  for (const zc of zeroClaims || []) {
    const opening = Number(zc.opening_paid_amount || 0);
    openingPaidByProject.set(zc.project_id, opening);
    if (opening > 0) addPaid(zc.project_id, opening);
  }

  // Build per-project claim summaries using the shared utility
  const claimSummaries = latestClaimList.map(c => {
    const totals      = (claimTotalsData || []).find((t: any) => t.claim_id === c.id);
    const prior       = (priorClaims     || []).find((p: any) => p.project_id === c.project_id);
    const projectName = (projects || []).find(p => p.id === c.project_id)?.name || '';

    const fin = computeClaimFinancials({
      claimCumulativeTotal:    Number(totals?.claim_cumulative_total    || 0),
      claimCumulativeRetained: Number(totals?.claim_cumulative_retained || 0),
      priorCertifiedAmount:    Number(prior?.prior_certified_amount || 0),
      priorRetentionHeld:      Number(prior?.prior_retention_held   || 0),
      taxEnabled: !!c.tax_enabled,
      taxRate:    Number(c.tax_rate || 0),
      paidInSystem: paidByProject.get(c.project_id) || 0,
      openingPaid:  0,  // already included in paidByProject above
      claimNumber:  c.claim_number ?? 0,
    });

    return {
      project_id:   c.project_id,
      project_name: projectName,
      claim_number: fin.claim_number,
      grossTotal:   fin.grossTotal,
      retained:     fin.retained,
      netCumulative: fin.netCumulative,
      tax:          fin.tax,
      tax_rate:     fin.tax_rate,
      tax_enabled:  fin.tax_enabled,
      totalPaid:    fin.totalPaid,
      openingPaid:  openingPaidByProject.get(c.project_id) || 0,  // display only
      remaining:    fin.remaining,   // can be negative = overpayment
    };
  });

  // Projects where a REAL claim (#1 or later) exists — only these supersede the
  // opening-balance document (claim #0 / legacy prior claim) for that project.
  // A claim#0-only project must NOT be in this set, or its only payable document
  // would be wrongly hidden below (this was the root cause of a bug where a
  // claim#0-only vendor showed no open documents to pay at all).
  const projectsWithHigherClaim = new Set(
    claimSummaries.filter(s => s.claim_number > 0).map(s => s.project_id)
  );

  // Relabel in-system claim#0 rows — surfaced by v_vendor_account as document_type
  // 'prior_claim' but actually backed by a real `claims` row, not the legacy
  // `vendor_prior_claims` table — to 'claim' whenever no higher claim supersedes
  // them. This lets them (a) get amount_due/amount_paid patched from claimSummaries
  // below, consistent with what's shown elsewhere, and (b) submit as target_type
  // 'claim' to record_vendor_payment(_from_expense), which those RPCs' 'prior_claim'
  // branch can't handle (it only looks up the legacy vendor_prior_claims table,
  // where an in-system claim#0's id doesn't exist). True legacy vendor_prior_claims
  // rows (present in priorClaims) are left untouched — the existing 'prior_claim'
  // RPC handling is correct for those.
  allDocs.forEach(d => {
    if (
      d.document_type === 'prior_claim' &&
      !projectsWithHigherClaim.has(d.project_id) &&
      !priorClaims?.some(pc => pc.id === d.document_id)
    ) {
      d.document_type = 'claim';
      d._relabeledFromPriorClaim = true;
    }
  });

  // Patch ONLY relabeled claim#0 rows with the cumulative remaining from
  // claimSummaries — for those, v_vendor_account gave prior_claim-shaped values
  // (prior_certified_amount / prior_paid_amount) that don't mean anything as a
  // claim bucket, and since claim#0 is the vendor's only claim in this case, the
  // project's cumulative remaining IS that single bucket's remaining anyway.
  //
  // Genuine numbered claims (#1+) are deliberately left untouched here: their
  // amount_due/amount_paid already came from v_vendor_account + the v_claim_paid
  // patch above, i.e. that SPECIFIC claim's own incremental bucket (total_due_this_claim
  // minus payment_allocations against that exact claim id) — the same scoping
  // record_vendor_payment's RPC validates against. Overwriting it with the
  // cumulative project-wide "remaining" was wrong whenever older claims in the
  // same project were over- or under-filled relative to their own bucket (common
  // with cumulative claims): it could hide a claim that still has real payable
  // room in its own bucket (cumulative remaining went negative because an older
  // claim absorbed extra payment) or let the UI offer to allocate more than this
  // claim's own bucket has room for (cumulative remaining overstated because an
  // older claim's payment sits unallocated as vendor credit instead) — the latter
  // is what caused a real submission to fail with "Allocation of 30000 exceeds
  // remaining due 27003.75 for document ...".
  allDocs.forEach(d => {
    if (d.document_type === 'claim' && d._relabeledFromPriorClaim) {
      const s = claimSummaries.find(cs => cs.project_id === d.project_id);
      if (s) {
        d.amount_due  = s.remaining;
        d.amount_paid = 0;
      }
    }
  });

  // Filter for payables that still have a balance.
  // Exclude prior_claim / opening_balance rows for projects that have a higher claim
  // (their balance is already folded into that claim's cumulative total).
  const openDocs = allDocs.filter(d => {
    if (d.document_type === 'payment') return false;
    if ((d.document_type === 'prior_claim' || d.document_type === 'opening_balance')
        && projectsWithHigherClaim.has(d.project_id)) return false;
    return (d.amount_due - d.amount_paid) > 0;
  });


  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">تسجيل دفعة لمقاول</h1>
        <p className="text-muted-foreground mt-1">المقاول: {vendor.name}</p>
      </div>

      <VendorPaymentCalculator vendorId={vendorId} openDocs={openDocs} banks={banks || []} employees={employees || []} projects={vendorScopedProjects || []} claimSummaries={claimSummaries} creditEntries={creditEntries || []} />
    </div>
  );
}
