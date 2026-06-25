import { createClient } from '@/lib/supabase/server';

export async function getInvoices() {
  const supabase = await createClient();
  const { data: invoices, error } = await supabase
    .from('invoices')
    .select('id, invoice_date, invoice_number, status, total_amount, vendor_id, project_id, vendor:vendors(name), project:projects(name)')
    .order('invoice_date', { ascending: false })
    .limit(200);

    
  if (error) throw error;
  if (!invoices || invoices.length === 0) return [];

  const { data: attachments } = await supabase
    .from('attachments')
    .select('entity_id, r2_key')
    .eq('entity_type', 'invoice')
    .in('entity_id', invoices.map(i => i.id));

  return invoices.map(inv => ({
    ...inv,
    attachments: attachments?.filter(a => a.entity_id === inv.id) || []
  }));
}

export async function getInvoice(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('invoices')
    .select(`
      *,
      vendor:vendors(name),
      project:projects(name),
      items:invoice_items(*)
    `)
    .eq('id', id)
    .single();
    
  if (error) throw error;
  
  const { data: attachments } = await supabase
    .from('attachments')
    .select('r2_key')
    .eq('entity_type', 'invoice')
    .eq('entity_id', id);

  return { ...data, attachments: attachments || [] };
}
