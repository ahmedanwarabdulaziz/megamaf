import { getInvoice } from '@/lib/queries/invoices';
import { getVendors } from '@/lib/queries/vendors';
import { getProjects } from '@/lib/queries/projects';
import { createClient } from '@/lib/supabase/server';
import { CreateInvoiceForm } from '@/components/invoices/create-invoice-form';
import { notFound } from 'next/navigation';

export const metadata = {
  title: 'تعديل فاتورة',
};

export default async function EditInvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const invoice = await getInvoice(id);
  if (!invoice) notFound();

  if (invoice.status === 'approved') {
    return (
      <div className="max-w-4xl mx-auto p-8 text-center text-destructive bg-destructive/10 border border-destructive/20 rounded-lg">
        لا يمكن تعديل فاتورة معتمدة
      </div>
    );
  }

  const allVendors = await getVendors();
  const vendors = allVendors.filter((v: any) => v.kind === 'vendor');
  const projects = await getProjects();
  const supabase = await createClient();
  const { data: warehouses } = await supabase.from('warehouses').select('id, name, project_id');
  const { data: inventoryItems } = await supabase.from('inventory_items').select('id, name, unit, code');

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">تعديل فاتورة مورد</h1>
      </div>

      <CreateInvoiceForm
        vendors={vendors}
        projects={projects}
        warehouses={warehouses || []}
        inventoryItems={inventoryItems || []}
        invoice={invoice}
      />
    </div>
  );
}
