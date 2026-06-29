import { createClient } from '@/lib/supabase/server';

const CLAIM_COLUMNS = `
  id, claim_type, party_id, project_id, claim_number, claim_date, status,
  tax_enabled, tax_rate, notes,
  project:projects(name)
`;

export async function getClaims(type: 'vendor' | 'owner' = 'vendor', filters?: { projectId?: string }) {
  const supabase = await createClient();

  // ── 1. In-system claims + vendor_prior_claims fetched in parallel ────────
  let claimsQ = supabase
    .from('claims')
    .select(CLAIM_COLUMNS)
    .eq('claim_type', type)
    .order('claim_number', { ascending: false })
    .limit(500);
  if (filters?.projectId) claimsQ = claimsQ.eq('project_id', filters.projectId);

  // Always fetch all vendor_prior_claims (scoped by project if filtered)
  // so vendors with ONLY a Claim #0 can still appear in the list.
  let priorQ: Promise<{ data: any[] | null; error: any }> = Promise.resolve({ data: null, error: null });
  if (type === 'vendor') {
    let q = supabase.from('vendor_prior_claims').select('*');
    if (filters?.projectId) q = q.eq('project_id', filters.projectId);
    priorQ = q as any;
  }

  const [{ data: claims, error }, { data: rawPriorClaims }] = await Promise.all([claimsQ, priorQ]);
  if (error) throw error;

  const allClaims   = claims ?? [];
  const priorClaims = rawPriorClaims ?? [];

  // Pairs that already have at least one in-system claim
  const inSystemPairs = new Set(allClaims.map((c: any) => `${c.party_id}__${c.project_id}`));

  // "Orphan" priors: vendor has Claim #0 but zero in-system claims for this project
  const orphanPriors = priorClaims.filter(
    (p: any) => !inSystemPairs.has(`${p.vendor_id}__${p.project_id}`)
  );

  if (allClaims.length === 0 && orphanPriors.length === 0) return [];

  // ── 2. Collect IDs needed for dependent queries ──────────────────────────
  const claimIds = allClaims.map((c: any) => c.id);

  const allPartyIds = [...new Set([
    ...allClaims.map((c: any) => c.party_id),
    ...orphanPriors.map((p: any) => p.vendor_id),
  ])] as string[];

  const orphanProjectIds = [...new Set(orphanPriors.map((p: any) => p.project_id))] as string[];

  // ── 3. Parallel: totals, paid, party names, project names for orphans ────
  const [
    { data: claimTotals },
    { data: claimPaid },
    { data: partiesRaw },
    { data: orphanProjectsRaw },
  ] = await Promise.all([
    claimIds.length > 0
      ? supabase.from('v_claim_totals')
          .select('claim_id, claim_cumulative_total, claim_cumulative_retained, claim_cumulative_payable, prior_cumulative_payable, total_due_this_claim')
          .in('claim_id', claimIds)
      : Promise.resolve({ data: [] }),
    claimIds.length > 0
      ? supabase.from('v_claim_paid').select('claim_id, paid_amount').in('claim_id', claimIds)
      : Promise.resolve({ data: [] }),
    allPartyIds.length > 0
      ? (type === 'vendor'
          ? supabase.from('vendors').select('id, name').in('id', allPartyIds)
          : supabase.from('project_owners').select('id, name').in('id', allPartyIds))
      : Promise.resolve({ data: [] }),
    orphanProjectIds.length > 0
      ? supabase.from('projects').select('id, name').in('id', orphanProjectIds)
      : Promise.resolve({ data: [] }),
  ]);

  // ── 4. Attach totals/paid to in-system claims ────────────────────────────
  // Build a map: "party_id__project_id" → total paid across ALL claims in that group
  // (payments may be allocated against older claims, not just the latest)
  const paidByGroup = new Map<string, number>();
  for (const c of allClaims) {
    const key = `${c.party_id}__${c.project_id}`;
    const paid = Number(claimPaid?.find((p: any) => p.claim_id === (c as any).id)?.paid_amount || 0);
    paidByGroup.set(key, (paidByGroup.get(key) || 0) + paid);
  }

  allClaims.forEach((c: any) => {
    c.v_claim_totals = claimTotals?.filter((t: any) => t.claim_id === c.id) ?? [];
    // Expose the group-total paid (sum across all claims for same party+project)
    const groupPaid = paidByGroup.get(`${c.party_id}__${c.project_id}`) || 0;
    c.v_claim_paid = [{ claim_id: c.id, paid_amount: groupPaid }];
  });

  const vendorMap  = new Map((partiesRaw ?? []).map((v: any) => [v.id, v.name]));
  const projectMap = new Map((orphanProjectsRaw ?? []).map((p: any) => [p.id, p.name]));

  // ── 5. Regular in-system claim entries ───────────────────────────────────
  const regularEntries = allClaims.map((c: any) => ({
    ...c,
    party_name: vendorMap.get(c.party_id) ?? 'Unknown',
    ...(type === 'vendor' && {
      vendor_prior_claim: priorClaims.find(
        (p: any) => p.project_id === c.project_id && p.vendor_id === c.party_id
      ) ?? null,
    }),
  }));

  // ── 6. Synthetic entries for vendors with ONLY Claim #0 (no in-system) ───
  const syntheticEntries = orphanPriors.map((p: any) => ({
    id: `prior_${p.id}`,
    claim_type: 'vendor' as const,
    party_id: p.vendor_id,
    project_id: p.project_id,
    claim_number: 0,
    claim_date: p.cutoff_date,
    status: 'prior_only' as const,
    tax_enabled: false,
    tax_rate: 0,
    notes: p.notes ?? null,
    project: { name: projectMap.get(p.project_id) ?? '' },
    v_claim_totals: [],
    v_claim_paid: [],
    party_name: vendorMap.get(p.vendor_id) ?? 'Unknown',
    vendor_prior_claim: p,
    is_prior_only: true,
  }));

  // Synthetic (Claim #0-only) entries appear first, then regular in-system claims
  return [...syntheticEntries, ...regularEntries];
}

export async function getClaim(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('claims')
    .select(`
      id, claim_type, party_id, project_id, claim_number, claim_date, status,
      tax_enabled, tax_rate, notes, approved_at,
      project:projects(name),
      items:claim_items(id, description, item_ref, unit, unit_price, previous_qty, current_qty, disbursement_pct, notes)
    `)
    .eq('id', id)
    .single();

  if (error) throw error;

  // Parallel: totals + paid + party + attachments
  const [
    { data: claimTotals },
    { data: claimPaid },
    partyResult,
    { data: attachments },
  ] = await Promise.all([
    supabase.from('v_claim_totals').select('*').eq('claim_id', id),
    supabase.from('v_claim_paid').select('*').eq('claim_id', id),
    data.claim_type === 'vendor'
      ? supabase.from('vendors').select('name').eq('id', data.party_id).single()
      : supabase.from('project_owners').select('name').eq('id', data.party_id).single(),
    supabase.from('attachments').select('r2_key').eq('entity_type', 'claim').eq('entity_id', id),
  ]);

  const result = data as any;
  result.v_claim_totals = claimTotals || [];
  result.v_claim_paid   = claimPaid   || [];

  return { ...result, party_name: partyResult.data?.name || 'Unknown', attachments: attachments || [] };

}

export async function getPreviousApprovedClaimItems(partyId: string, projectId: string, claimType: 'vendor' | 'owner') {
  const supabase = await createClient();

  const { data: lastClaim } = await supabase
    .from('claims')
    .select('id, claim_number')
    .eq('party_id', partyId)
    .eq('project_id', projectId)
    .eq('claim_type', claimType)
    .eq('status', 'approved')
    .order('claim_number', { ascending: false })
    .limit(1)
    .single();

  if (!lastClaim) return { items: [], nextClaimNumber: 1 };

  const { data: items } = await supabase
    .from('claim_items')
    .select('*')
    .eq('claim_id', lastClaim.id);

  return { items: items || [], nextClaimNumber: lastClaim.claim_number + 1 };
}
