import { getVendors } from '@/lib/queries/vendors';
import { getProjects } from '@/lib/queries/projects';
import { CreateClaimForm } from '@/components/claims/create-claim-form';
import { createClient } from '@/lib/supabase/server';

export const metadata = {
  title: 'تسجيل مستخلص',
};

export default async function CreateClaimPage({
  searchParams,
}: {
  searchParams: Promise<{ party_id?: string; project_id?: string }>;
}) {
  const { party_id, project_id } = await searchParams;
  const vendors = await getVendors();
  const projects = await getProjects();
  const supabase = await createClient();
  const { data: warehouses } = await supabase.from('warehouses').select('id, name, project_id');
  const { data: inventoryItems } = await supabase.from('inventory_items').select('id, name, unit, code');
  const { data: stockLevels } = await supabase.from('v_stock_on_hand').select('warehouse_id, item_id, qty_on_hand, item_unit');

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">تسجيل مستخلص مقاول</h1>
      </div>

      <CreateClaimForm
        vendors={vendors.filter(v => v.kind === 'contractor')}
        projects={projects}
        warehouses={warehouses || []}
        inventoryItems={inventoryItems || []}
        stockLevels={stockLevels || []}
        defaultPartyId={party_id}
        defaultProjectId={project_id}
      />
    </div>
  );
}
