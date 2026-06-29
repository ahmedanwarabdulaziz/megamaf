import { getVendors } from '@/lib/queries/vendors';
import { getProjects } from '@/lib/queries/projects';
import { CreateInvoiceForm } from '@/components/invoices/create-invoice-form';
import { createClient } from '@/lib/supabase/server';

export const metadata = {
  title: 'تسجيل فاتورة',
};

export default async function CreateInvoicePage() {
  const allVendors = await getVendors();
  // ── Business rule: invoices are for suppliers (مورد) only ──
  const vendors = allVendors.filter((v: any) => v.kind === 'vendor');
  const projects = await getProjects();
  const supabase = await createClient();
  const { data: warehouses } = await supabase.from('warehouses').select('id, name, project_id');
  const { data: inventoryItems } = await supabase.from('inventory_items').select('id, name, unit, code');

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">تسجيل فاتورة مورد</h1>
      </div>
      
      <CreateInvoiceForm vendors={vendors} projects={projects} warehouses={warehouses || []} inventoryItems={inventoryItems || []} />
    </div>
  );
}
