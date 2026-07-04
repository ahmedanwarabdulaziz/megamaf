import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getVendors } from '@/lib/queries/vendors';
import { getProjects } from '@/lib/queries/projects';
import { EditClaimForm } from '@/components/claims/edit-claim-form';

export const metadata = { title: 'تعديل المستخلص' };

export default async function EditClaimPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: claim } = await supabase
    .from('claims')
    .select('*, claim_items(*, claim_item_stock_bundles(*))')
    .eq('id', id)
    .single();

  if (!claim) notFound();
  // Claim#0 (opening balance) can always be edited — the "lock" when Claim#1 exists
  // is enforced at the link level (opening-balance-form.tsx).
  // For all other claims, only 'pending' status is editable.
  if (claim.claim_number !== 0 && claim.status !== 'pending') redirect('/claims');

  // Vendor / owner name
  let partyName = '';
  if (claim.claim_type === 'vendor') {
    const { data: v } = await supabase.from('vendors').select('name').eq('id', claim.party_id).single();
    partyName = v?.name || '';
  } else {
    const { data: o } = await supabase.from('project_owners').select('name').eq('id', claim.party_id).single();
    partyName = o?.name || '';
  }

  // Project name
  const { data: project } = await supabase.from('projects').select('name').eq('id', claim.project_id).single();

  const [vendors, projects] = await Promise.all([getVendors(), getProjects()]);
  const { data: warehouses }    = await supabase.from('warehouses').select('id, name, project_id');
  const { data: inventoryItems } = await supabase.from('inventory_items').select('id, name, unit, code');
  const { data: stockLevels }   = await supabase.from('v_stock_on_hand').select('warehouse_id, item_id, qty_on_hand, item_unit');

  // For Claim#0, return to the project opening-balance tab after save/cancel
  const returnUrl = claim.claim_number === 0
    ? `/projects/${claim.project_id}?tab=opening-balance`
    : '/claims';

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold">تعديل المستخلص رقم {claim.claim_number}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {partyName} — {project?.name}
          </p>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
          claim.claim_number === 0
            ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
            : claim.status === 'approved'
              ? 'bg-green-100 text-green-700'
              : 'bg-secondary text-secondary-foreground'
        }`}>
          {claim.claim_number === 0 ? '⚖️ رصيد افتتاحي (#0)' : claim.status === 'approved' ? 'معتمد' : 'قيد المراجعة'}
        </span>
      </div>

      <EditClaimForm
        claimId={id}
        claimNumber={claim.claim_number}
        claimType={claim.claim_type}
        partyId={claim.party_id}
        partyName={partyName}
        projectId={claim.project_id}
        projectName={project?.name || ''}
        claimDate={claim.claim_date}
        taxEnabled={claim.tax_enabled}
        taxRate={claim.tax_rate}
        notes={claim.notes || ''}
        existingItems={claim.claim_items || []}
        vendors={vendors}
        projects={projects}
        warehouses={warehouses || []}
        inventoryItems={inventoryItems || []}
        stockLevels={stockLevels || []}
        returnUrl={returnUrl}
      />
    </div>
  );
}
