import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { VendorPaymentCalculator } from './calculator';

export default async function PayVendorPage({ params }: { params: Promise<{ vendorId: string }> }) {
  const { vendorId } = await params;
  const supabase = await createClient();

  const { data: vendor } = await supabase.from('vendors').select('*').eq('id', vendorId).single();
  if (!vendor) notFound();

  const { data: bankAccounts } = await supabase.from('v_bank_account_balances').select('*').order('account_name');

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
  ] = await Promise.all([
    latestClaimIds.length > 0
      ? supabase.from('v_claim_totals')
          .select('claim_id, claim_cumulative_total, claim_cumulative_retained, claim_cumulative_payable')
          .in('claim_id', latestClaimIds)
      : { data: [] as any[] },
    allClaimIds.length > 0
      ? supabase.from('v_claim_paid').select('claim_id, paid_amount').in('claim_id', allClaimIds)
      : { data: [] as any[] },
  ]);

  // Sum paid_amount across ALL claims per project
  const paidByProject = new Map<string, number>();
  for (const c of latestClaims || []) {
    const paid = Number((allClaimPaidData || []).find((p: any) => p.claim_id === c.id)?.paid_amount || 0);
    paidByProject.set(c.project_id, (paidByProject.get(c.project_id) || 0) + paid);
  }

  // Build per-project claim summaries (same logic as /claims page)
  const claimSummaries = latestClaimList.map(c => {
    const totals   = (claimTotalsData || []).find((t: any) => t.claim_id === c.id);
    const prior    = (priorClaims     || []).find((p: any) => p.project_id === c.project_id);
    const projectName = (projects || []).find(p => p.id === c.project_id)?.name || '';

    // Mirror the exact logic from /claims page
    const priorCert = Number(prior?.prior_certified_amount || 0);
    const priorPaid = Number(prior?.prior_paid_amount      || 0);
    const priorRet  = Number(prior?.prior_retention_held   || 0);

    const grossInSystem    = Number(totals?.claim_cumulative_total    || 0);
    const retainedInSystem = Number(totals?.claim_cumulative_retained || 0);
    const grossTotal       = grossInSystem + priorCert;
    const retained         = retainedInSystem + priorRet;
    const netCumulative    = grossTotal - retained;

    const paidInSystem = paidByProject.get(c.project_id) || 0;
    const totalPaid    = paidInSystem + priorPaid;

    const tax = c.tax_enabled ? netCumulative * (c.tax_rate || 0) : 0;
    const totalDue  = netCumulative + tax;
    const remaining = Math.max(0, totalDue - totalPaid);

    return {
      project_id:    c.project_id,
      project_name:  projectName,
      claim_number:  c.claim_number,
      grossTotal,
      retained,
      netCumulative,
      tax,
      tax_rate:      c.tax_rate || 0,
      tax_enabled:   c.tax_enabled,
      totalPaid,
      remaining,
    };
  });

  // Projects that now have an in-system claim — used to exclude prior_claim rows
  const projectsWithInSystemClaim = new Set(claimSummaries.map(s => s.project_id));

  // Patch claim docs with cumulative remaining from claimSummaries so the
  // openDocs filter uses the correct number (not the raw doc amount).
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
  // Exclude prior_claim / opening_balance rows for projects that already have an in-system claim
  // (their balance is already folded into the cumulative claim total).
  const openDocs = allDocs.filter(d => {
    if (d.document_type === 'payment') return false;
    if ((d.document_type === 'prior_claim' || d.document_type === 'opening_balance')
        && projectsWithInSystemClaim.has(d.project_id)) return false;
    return (d.amount_due - d.amount_paid) > 0;
  });


  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">تسجيل دفعة لمقاول</h1>
        <p className="text-muted-foreground mt-1">المقاول: {vendor.name}</p>
      </div>

      <VendorPaymentCalculator vendorId={vendorId} openDocs={openDocs} bankAccounts={bankAccounts || []} projects={projects || []} claimSummaries={claimSummaries} />
    </div>
  );
}
