import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const supabase = await createClient();
  
  const { searchParams } = new URL(request.url);
  const ownerId = searchParams.get('ownerId');

  let query = supabase.from('v_owner_account').select('*');
  if (ownerId) {
    query = query.eq('party_id', ownerId);
  }

  const { data: docs, error } = await query;
  
  const { data: claims } = await supabase.from('claims').select('id, claim_type, party_id, status, claim_number').eq('claim_type', 'owner');
  
  return NextResponse.json({ docs, error, claims });
}
