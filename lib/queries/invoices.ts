import { createClient } from '@/lib/supabase/server';

export async function getInvoicesWithFilters(filters?: {
  projectId?: string;
  vendorId?: string;
  search?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
}) {
  const supabase = await createClient();
  let query = supabase
    .from('invoices')
    .select('id, invoice_number, invoice_date, status, total, vendor_id, project_id, vendor:vendors(name, kind, phone), project:projects(name)')
    .order('invoice_date', { ascending: false });

  if (filters?.projectId) query = query.eq('project_id', filters.projectId);
  if (filters?.vendorId) query = query.eq('vendor_id', filters.vendorId);
  if (filters?.status) query = query.eq('status', filters.status);
  if (filters?.startDate) query = query.gte('invoice_date', filters.startDate);
  if (filters?.endDate) query = query.lte('invoice_date', filters.endDate);

  const { data: invoices, error } = await query.limit(200);
  if (error) throw error;
  if (!invoices || invoices.length === 0) return [];

  let filteredInvoices = invoices;
  if (filters?.search) {
    const s = filters.search.toLowerCase();
    filteredInvoices = invoices.filter((inv: any) => 
      inv.vendor?.name?.toLowerCase().includes(s) || 
      inv.project?.name?.toLowerCase().includes(s)
    );
  }

  const invoiceIds = filteredInvoices.map((i: any) => i.id);
  if (invoiceIds.length === 0) return [];

  const [
    { data: attachments },
    { data: paidData }
  ] = await Promise.all([
    supabase
      .from('attachments')
      .select('entity_id, r2_key')
      .eq('entity_type', 'invoice')
      .in('entity_id', invoiceIds),
    supabase
      .from('v_invoice_paid')
      .select('invoice_id, paid_amount')
      .in('invoice_id', invoiceIds)
  ]);

  return filteredInvoices.map((inv: any) => {
    const paid = paidData?.find((p: any) => p.invoice_id === inv.id)?.paid_amount || 0;
    return {
      ...inv,
      attachments: attachments?.filter((a: any) => a.entity_id === inv.id) || [],
      paid_amount: paid,
      balance: inv.total - paid
    };
  });
}

export async function getActionRequiredInvoices() {
  const supabase = await createClient();
  
  const { data: invoices, error } = await supabase
    .from('invoices')
    .select('id, invoice_number, invoice_date, status, total, vendor_id, project_id, vendor:vendors(name, kind, phone), project:projects(name)')
    .in('status', ['pending', 'approved'])
    .order('invoice_date', { ascending: false })
    .limit(200);

  if (error) throw error;
  if (!invoices || invoices.length === 0) return [];

  const invoiceIds = invoices.map((i: any) => i.id);
  
  const [
    { data: attachments },
    { data: paidData }
  ] = await Promise.all([
    supabase
      .from('attachments')
      .select('entity_id, r2_key')
      .eq('entity_type', 'invoice')
      .in('entity_id', invoiceIds),
    supabase
      .from('v_invoice_paid')
      .select('invoice_id, paid_amount')
      .in('invoice_id', invoiceIds)
  ]);

  const enriched = invoices.map((inv: any) => {
    const paid = paidData?.find((p: any) => p.invoice_id === inv.id)?.paid_amount || 0;
    return {
      ...inv,
      attachments: attachments?.filter((a: any) => a.entity_id === inv.id) || [],
      paid_amount: paid,
      balance: inv.total - paid
    };
  });

  return enriched.filter((inv: any) => inv.status === 'pending' || (inv.status === 'approved' && inv.balance > 0));
}

export async function getInvoice(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('invoices')
    .select(`
      *,
      vendor:vendors(name, phone, kind),
      project:projects(name),
      items:invoice_items(*)
    `)
    .eq('id', id)
    .single();
    
  if (error) throw error;
  
  const [
    { data: attachments },
    { data: paidData }
  ] = await Promise.all([
    supabase
      .from('attachments')
      .select('r2_key')
      .eq('entity_type', 'invoice')
      .eq('entity_id', id),
    supabase
      .from('v_invoice_paid')
      .select('paid_amount')
      .eq('invoice_id', id)
      .maybeSingle()
  ]);

  const paid_amount = paidData?.paid_amount || 0;

  return { 
    ...data, 
    attachments: attachments || [],
    paid_amount,
    balance: data.total - paid_amount
  };
}
