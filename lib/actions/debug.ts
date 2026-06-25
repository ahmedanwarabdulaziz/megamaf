'use server';

import { createClient } from '@/lib/supabase/server';

export async function debugOwnerDocs(ownerId: string) {
  const supabase = await createClient();
  const { data: docs } = await supabase.from('v_owner_account').select('*').eq('party_id', ownerId);
  const { data: claims } = await supabase.from('claims').select('id, claim_type, party_id, status').eq('claim_type', 'owner');
  const { data: totals } = await supabase.from('v_claim_totals').select('*').in('claim_id', claims?.map(c => c.id) || []);
  
  console.log('--- DEBUG OWNER DOCS ---');
  console.log('docs:', JSON.stringify(docs, null, 2));
  console.log('claims:', JSON.stringify(claims, null, 2));
  console.log('totals:', JSON.stringify(totals, null, 2));
  console.log('------------------------');
  
  return { docs, claims, totals };
}
