import { createClient } from '@/lib/supabase/server';

export async function getVendors() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('vendors')
    .select(`
      *,
      vendor_project_access(project_id)
    `)
    .order('name');
    
  if (error) throw error;
  return data;
}

export async function getVendor(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('vendors')
    .select(`
      *,
      vendor_project_access(project_id)
    `)
    .eq('id', id)
    .single();
    
  if (error) throw error;
  return data;
}

export async function getVendorsWithSummary(filters?: { startDate?: string, endDate?: string, projectId?: string, kind?: string, search?: string }) {
  const supabase = await createClient();
  
  // 1. Get vendors (filter by kind and search text)
  let vQuery = supabase.from('vendors').select(`
    *,
    vendor_project_access(project_id, project:projects(name))
  `).order('name');
  
  if (filters?.kind) vQuery = vQuery.eq('kind', filters.kind);
  if (filters?.search) vQuery = vQuery.ilike('name', `%${filters.search}%`);
  
  const { data: vendors, error: vError } = await vQuery;
  if (vError) throw vError;
  if (!vendors || vendors.length === 0) return [];

  // 2. Filter vendors by project access if projectId is provided
  let filteredVendors = vendors;
  if (filters?.projectId) {
    filteredVendors = vendors.filter(v => 
      v.all_projects || 
      v.vendor_project_access?.some((acc: any) => acc.project_id === filters.projectId)
    );
  }

  if (filteredVendors.length === 0) return [];

  const vendorIds = filteredVendors.map(v => v.id);

  // 3. Fetch latest approved claim per vendor per project (same logic as /claims page)
  //    Order DESC so first occurrence per (party_id, project_id) is the latest.
  let claimsQ = supabase
    .from('claims')
    .select('id, party_id, project_id, claim_number, tax_enabled, tax_rate')
    .eq('claim_type', 'vendor')
    .eq('status', 'approved')
    .in('party_id', vendorIds)
    .order('claim_number', { ascending: false });

  if (filters?.projectId) claimsQ = claimsQ.eq('project_id', filters.projectId);

  const [
    { data: allApprovedClaims },
    { data: allPriorClaims },
  ] = await Promise.all([
    claimsQ,
    supabase.from('vendor_prior_claims').select('*').in('vendor_id', vendorIds),
  ]);

  // Keep only latest claim per (party_id, project_id)
  const latestClaimMap = new Map<string, any>();
  for (const c of allApprovedClaims || []) {
    const key = `${c.party_id}__${c.project_id}`;
    if (!latestClaimMap.has(key)) latestClaimMap.set(key, c); // already DESC order
  }
  const latestClaims = Array.from(latestClaimMap.values());
  const latestClaimIds = latestClaims.map(c => c.id);

  // All claim IDs (not just latest) — needed to sum payments across every claim
  // in a project, since a payment may target Claim #1 even when Claim #2 is latest.
  const allClaimIds = (allApprovedClaims || []).map((c: any) => c.id);

  // 4. Fetch totals and paid in parallel
  const [
    { data: claimTotals },
    { data: claimPaidAll },
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

  // Build a map: "party_id__project_id" → total paid across ALL claims in that group
  const paidByGroup = new Map<string, number>();
  for (const c of allApprovedClaims || []) {
    const key = `${c.party_id}__${c.project_id}`;
    const paid = Number((claimPaidAll || []).find((p: any) => p.claim_id === c.id)?.paid_amount || 0);
    paidByGroup.set(key, (paidByGroup.get(key) || 0) + paid);
  }

  // 5. Build per-vendor summary using the exact same logic as /claims page
  const summaryMap = new Map<string, {
    grossTotal: number; retained: number; netCumulative: number;
    tax: number; totalPaid: number; remaining: number;
  }>();

  // Process each latest claim (mirrors the IIFE inside /claims page cards)
  for (const c of latestClaims) {
    const totals  = (claimTotals || []).find((t: any) => t.claim_id === c.id);
    const prior   = (allPriorClaims || []).find((p: any) =>
      p.vendor_id === c.party_id && p.project_id === c.project_id
    );

    const priorCert = Number(prior?.prior_certified_amount || 0);
    const priorPaid = Number(prior?.prior_paid_amount      || 0);
    const priorRet  = Number(prior?.prior_retention_held   || 0);

    const grossInSystem    = Number(totals?.claim_cumulative_total    || 0);
    const retainedInSystem = Number(totals?.claim_cumulative_retained || 0);
    const grossTotal       = grossInSystem + priorCert;
    const retained         = retainedInSystem + priorRet;
    const netCumulative    = grossTotal - retained;

    // Sum paid across ALL claims for this vendor+project
    const paidInSystem = paidByGroup.get(`${c.party_id}__${c.project_id}`) || 0;
    const totalPaid    = paidInSystem + priorPaid;

    const tax       = c.tax_enabled ? netCumulative * (c.tax_rate || 0) : 0;
    const totalDue  = netCumulative + tax;
    const remaining = Math.max(0, totalDue - totalPaid);

    const existing = summaryMap.get(c.party_id) || {
      grossTotal: 0, retained: 0, netCumulative: 0,
      tax: 0, totalPaid: 0, remaining: 0,
    };
    existing.grossTotal    += grossTotal;
    existing.retained      += retained;
    existing.netCumulative += netCumulative;
    existing.tax           += tax;
    existing.totalPaid     += totalPaid;
    existing.remaining     += remaining;
    summaryMap.set(c.party_id, existing);
  }

  // Vendors with ONLY prior claims (no in-system claims yet) — add their outstanding balance
  const vendorsWithInSystemClaims = new Set(latestClaims.map(c => c.party_id));
  for (const prior of allPriorClaims || []) {
    if (vendorsWithInSystemClaims.has(prior.vendor_id)) continue; // already included above
    if (filters?.projectId && prior.project_id !== filters.projectId) continue;

    const priorCert = Number(prior.prior_certified_amount || 0);
    const priorPaid = Number(prior.prior_paid_amount      || 0);
    const priorRet  = Number(prior.prior_retention_held   || 0);
    const outstanding = Math.max(0, priorCert - priorPaid - priorRet);

    const existing = summaryMap.get(prior.vendor_id) || {
      grossTotal: 0, retained: 0, netCumulative: 0,
      tax: 0, totalPaid: 0, remaining: 0,
    };
    existing.grossTotal    += priorCert;
    existing.retained      += priorRet;
    existing.netCumulative += (priorCert - priorRet);
    existing.totalPaid     += priorPaid;
    existing.remaining     += outstanding;
    summaryMap.set(prior.vendor_id, existing);
  }

  // 6. Attach summary to vendors
  return filteredVendors.map(v => ({
    ...v,
    summary: summaryMap.get(v.id) || {
      grossTotal: 0, retained: 0, netCumulative: 0,
      tax: 0, totalPaid: 0, remaining: 0,
    }
  }));
}
