import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const supabase = await createClient();
  const { searchParams } = new URL(request.url);
  const ownerId = searchParams.get('ownerId') || '73292e94-4ab6-4956-9e43-c5da4e358b67';

  const { data: claims } = await supabase.from('claims').select('*, claim_items(*)').eq('claim_type', 'owner').eq('party_id', ownerId);
  const { data: claimTotals } = await supabase.from('v_claim_totals').select('*').in('claim_id', claims?.map(c => c.id) || []);
  const { data: vOwnerAccount } = await supabase.from('v_owner_account').select('*').eq('party_id', ownerId);

  return NextResponse.json({
    claims,
    claimTotals,
    vOwnerAccount
  });
}
