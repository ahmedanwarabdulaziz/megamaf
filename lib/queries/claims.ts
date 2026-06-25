import { createClient } from '@/lib/supabase/server';

const CLAIM_COLUMNS = `
  id, claim_type, party_id, project_id, claim_number, claim_date, status,
  tax_enabled, tax_rate, retention_pct, notes,
  project:projects(name)
`;

export async function getClaims(type: 'vendor' | 'owner' = 'vendor') {
  const supabase = await createClient();
  const { data: claims, error } = await supabase
    .from('claims')
    .select(CLAIM_COLUMNS)
    .eq('claim_type', type)
    .order('claim_number', { ascending: false })
    .limit(500); // safety cap — paginate if more needed

  if (error) throw error;
  if (!claims || claims.length === 0) return [];

  const claimIds   = claims.map(c => c.id);
  const partyIds   = [...new Set(claims.map(c => c.party_id))];
  const projectIds = [...new Set(claims.map(c => c.project_id))];

  // Run all dependent queries in parallel
  const [
    { data: claimTotals },
    { data: claimPaid },
    partyData,
    priorData,
  ] = await Promise.all([
    supabase.from('v_claim_totals')
      .select('claim_id, claim_cumulative_total, claim_cumulative_retained, claim_cumulative_payable, prior_cumulative_payable, total_due_this_claim')
      .in('claim_id', claimIds),
    supabase.from('v_claim_paid')
      .select('claim_id, paid_amount')
      .in('claim_id', claimIds),
    type === 'vendor'
      ? supabase.from('vendors').select('id, name').in('id', partyIds)
      : supabase.from('project_owners').select('id, name').in('id', partyIds),
    type === 'vendor'
      ? supabase.from('vendor_prior_claims').select('*').in('project_id', projectIds)
      : Promise.resolve({ data: null }),
  ]);

  claims.forEach((c: any) => {
    c.v_claim_totals = claimTotals?.filter(t => t.claim_id === c.id) || [];
    c.v_claim_paid   = claimPaid?.filter(p => p.claim_id === c.id) || [];
  });

  const parties = partyData.data || [];
  const priorClaims = priorData.data || [];

  return claims.map((c: any) => ({
    ...c,
    party_name: parties.find((p: any) => p.id === c.party_id)?.name || 'Unknown',
    ...(type === 'vendor' && {
      vendor_prior_claim: priorClaims.find(
        (p: any) => p.project_id === c.project_id && p.vendor_id === c.party_id
      ) || null,
    }),
  }));
}

export async function getClaim(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('claims')
    .select(`
      id, claim_type, party_id, project_id, claim_number, claim_date, status,
      tax_enabled, tax_rate, retention_pct, notes, approved_at,
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
