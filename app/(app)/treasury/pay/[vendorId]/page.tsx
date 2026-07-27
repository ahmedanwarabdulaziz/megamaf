import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { VendorPaymentCalculator } from './calculator';
import { computeClaimFinancials } from '@/lib/claim-financials';
import { requirePageAccess } from '@/lib/require-page-access';

export default async function PayVendorPage({ params }: { params: Promise<{ vendorId: string }> }) {
  await requirePageAccess('treasury');
  const { vendorId } = await params;
  const supabase = await createClient();

  const { data: vendor } = await supabase.from('vendors').select('*, vendor_project_access(project_id)').eq('id', vendorId).single();
  if (!vendor) notFound();

  const [
    { data: bankAccounts },
    { data: employees },
    { data: creditEntries },
  ] = await Promise.all([
    supabase.from('v_bank_account_balances').select('*').order('account_name'),
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

  // Fetch ALL claim IDs for this vendor (not just latest) so we can sum
  // payments across every claim in a project. Payments may be allocated
  // against older claims (e.g. Claim #1 paid, but Claim #2 is latest).
  const allClaimIds = (latestClaims || []).map((c: any) => c.id);

  const [
    { data: claimTotalsData },
    { data: allClaimPaidData },
    { data: vendorInvoices },
    { data: vendorRetentions },
    { data: zeroClaims },
  ] = await Promise.all([
    latestClaimIds.length > 0
      ? supabase.from('v_claim_totals')
          .select('claim_id, claim_cumulative_total, claim_cumulative_retained, claim_cumulative_payable')
          .in('claim_id', latestClaimIds)
      : { data: [] as any[] },
    allClaimIds.length > 0
      ? supabase.from('v_claim_paid').select('claim_id, paid_amount').in('claim_id', allClaimIds)
      : { data: [] as any[] },
    supabase.from('invoices').select('id, project_id').eq('vendor_id', vendorId).eq('status', 'approved'),
    supabase.from('retention_releases').select('id, project_id').eq('party_id', vendorId).eq('claim_type', 'vendor'),
    supabase.from('claims').select('project_id, opening_paid_amount').eq('party_id', vendorId).eq('claim_type', 'vendor').eq('claim_number', 0),
  ]);

  const invoiceIdsAll = (vendorInvoices || []).map((i: any) => i.id);
  const retentionIdsAll = (vendorRetentions || []).map((r: any) => r.id);

  const [
    { data: allInvoicePaidData },
    { data: allRetentionPaidData },
  ] = await Promise.all([
    invoiceIdsAll.length > 0
      ? supabase.from('v_invoice_paid').select('invoice_id, paid_amount').in('invoice_id', invoiceIdsAll)
      : { data: [] as any[] },
    retentionIdsAll.length > 0
      ? supabase.from('v_retention_paid').select('retention_id, paid_amount').in('retention_id', retentionIdsAll)
      : { data: [] as any[] },
  ]);

  // Build "how much has actually been paid" per project purely from
  // allocation-tracking views (v_claim_paid / v_invoice_paid / v_retention_paid),
  // each grouped by the document's OWN project_id — NOT from the payment ledger
  // row's project tag. A single payment can be split (via payment_allocations)
  // across documents in different projects, and the ledger row's project_id —
  // a single value — can't represent that split correctly.
  // NOTE: v_claim_paid already folds claim#0's opening_paid_amount into its
  // paid_amount on this database (confirmed against live data — this isn't in
  // the local migration files, so treat the live view as ground truth). Do NOT
  // add opening_paid_amount again below, or claim#0 rows get double-counted.
  const paidByProject = new Map<string, number>();
  const addPaid = (projectId: string | null | undefined, amount: number) => {
    if (!projectId || !amount) return;
    paidByProject.set(projectId, (paidByProject.get(projectId) || 0) + amount);
  };

  const claimProjectById = new Map((latestClaims || []).map((c: any) => [c.id, c.project_id]));
  for (const row of allClaimPaidData || []) {
    addPaid(claimProjectById.get(row.claim_id), Number(row.paid_amount || 0));
  }

  const invoiceProjectById = new Map((vendorInvoices || []).map((i: any) => [i.id, i.project_id]));
  for (const row of allInvoicePaidData || []) {
    addPaid(invoiceProjectById.get(row.invoice_id), Number(row.paid_amount || 0));
  }

  const retentionProjectById = new Map((vendorRetentions || []).map((r: any) => [r.id, r.project_id]));
  for (const row of allRetentionPaidData || []) {
    addPaid(retentionProjectById.get(row.retention_id), Number(row.paid_amount || 0));
  }

  // Build a map: "project_id" → opening_paid_amount from Claim#0 (display only —
  // already included in paidByProject above via v_claim_paid, see note there).
  const openingPaidByProject = new Map<string, number>();
  for (const zc of zeroClaims || []) {
    openingPaidByProject.set(zc.project_id, Number(zc.opening_paid_amount || 0));
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
    }
  });

  // Patch claim docs (including relabeled claim#0 rows) with cumulative remaining
  // from claimSummaries so the openDocs filter uses the correct number (not the raw doc amount).
  allDocs.forEach(d => {
    if (d.document_type === 'claim') {
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

      <VendorPaymentCalculator vendorId={vendorId} openDocs={openDocs} bankAccounts={bankAccounts || []} employees={employees || []} projects={vendorScopedProjects || []} claimSummaries={claimSummaries} creditEntries={creditEntries || []} />
    </div>
  );
}
