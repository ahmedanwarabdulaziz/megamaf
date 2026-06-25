import { createClient } from '@/lib/supabase/server';

export async function getClaims(type: 'vendor' | 'owner' = 'vendor') {
  const supabase = await createClient();
  const { data: claims, error } = await supabase
    .from('claims')
    .select(`
      *,
      project:projects(name)
    `)
    .eq('claim_type', type)
    .order('claim_number', { ascending: false });
    
  if (error) throw error;
  if (!claims || claims.length === 0) return [];

  const claimIds = claims.map(c => c.id);
  const { data: claimTotals } = await supabase
    .from('v_claim_totals')
    .select('*')
    .in('claim_id', claimIds);

  const { data: claimPaid } = await supabase
    .from('v_claim_paid')
    .select('*')
    .in('claim_id', claimIds);

  claims.forEach(c => {
    c.v_claim_totals = claimTotals?.filter(t => t.claim_id === c.id) || [];
    c.v_claim_paid = claimPaid?.filter(p => p.claim_id === c.id) || [];
  });

  // Manual join for polymorphic party_id
  const partyIds = claims.map(c => c.party_id);
  
  if (type === 'vendor') {
    const { data: vendors } = await supabase.from('vendors').select('id, name').in('id', partyIds);
    const allProjectIds = [...new Set(claims.map(c => c.project_id))];
    const { data: priorClaims } = await supabase
      .from('vendor_prior_claims')
      .select('*')
      .in('project_id', allProjectIds);

    return claims.map(c => ({
      ...c,
      party_name: vendors?.find(v => v.id === c.party_id)?.name || 'Unknown',
      vendor_prior_claim: priorClaims?.find(
        p => p.project_id === c.project_id && p.vendor_id === c.party_id
      ) || null,
    }));
  } else {
    const { data: owners } = await supabase.from('project_owners').select('id, name').in('id', partyIds);
    return claims.map(c => ({
      ...c,
      party_name: owners?.find(o => o.id === c.party_id)?.name || 'Unknown'
    }));
  }
}

export async function getClaim(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('claims')
    .select(`
      *,
      project:projects(name),
      items:claim_items(*)
    `)
    .eq('id', id)
    .single();
    
  if (error) throw error;
  
  const { data: claimTotals } = await supabase
    .from('v_claim_totals')
    .select('*')
    .eq('claim_id', id);

  const { data: claimPaid } = await supabase
    .from('v_claim_paid')
    .select('*')
    .eq('claim_id', id);

  data.v_claim_totals = claimTotals || [];
  data.v_claim_paid = claimPaid || [];

  let party_name = 'Unknown';
  if (data.claim_type === 'vendor') {
    const { data: vendor } = await supabase.from('vendors').select('name').eq('id', data.party_id).single();
    if (vendor) party_name = vendor.name;
  } else {
    const { data: owner } = await supabase.from('project_owners').select('name').eq('id', data.party_id).single();
    if (owner) party_name = owner.name;
  }

  const { data: attachments } = await supabase
    .from('attachments')
    .select('r2_key')
    .eq('entity_type', 'claim')
    .eq('entity_id', id);

  return { ...data, party_name, attachments: attachments || [] };
}

export async function getPreviousApprovedClaimItems(partyId: string, projectId: string, claimType: 'vendor'|'owner') {
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
