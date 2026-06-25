import { createClient } from '@/lib/supabase/server';

export async function getVendors() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('vendors')
    .select(`
      *,
      vendor_project_access(project_id)
    `)
    .order('name');
    
  if (error) throw error;
  return data;
}

export async function getVendor(id: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('vendors')
    .select(`
      *,
      vendor_project_access(project_id)
    `)
    .eq('id', id)
    .single();
    
  if (error) throw error;
  return data;
}

export async function getVendorsWithSummary(filters?: { startDate?: string, endDate?: string, projectId?: string, kind?: string, search?: string }) {
  const supabase = await createClient();
  
  // 1. Get vendors (filter by kind and search text)
  let vQuery = supabase.from('vendors').select(`
    *,
    vendor_project_access(project_id)
  `).order('name');
  
  if (filters?.kind) vQuery = vQuery.eq('kind', filters.kind);
  if (filters?.search) vQuery = vQuery.ilike('name', `%${filters.search}%`);
  
  const { data: vendors, error: vError } = await vQuery;
  if (vError) throw vError;
  if (!vendors || vendors.length === 0) return [];

  // 2. Filter vendors by project access if projectId is provided
  let filteredVendors = vendors;
  if (filters?.projectId) {
    filteredVendors = vendors.filter(v => 
      v.all_projects || 
      v.vendor_project_access?.some((acc: any) => acc.project_id === filters.projectId)
    );
  }

  if (filteredVendors.length === 0) return [];

  // 3. Get transactions from v_vendor_account based on filters
  let accQuery = supabase.from('v_vendor_account').select('party_id, amount_due, amount_paid');
  
  if (filters?.startDate) accQuery = accQuery.gte('document_date', filters.startDate);
  if (filters?.endDate) accQuery = accQuery.lte('document_date', filters.endDate);
  if (filters?.projectId) accQuery = accQuery.eq('project_id', filters.projectId);

  // We only fetch transactions for the filtered vendors to keep payload smaller
  const vendorIds = filteredVendors.map(v => v.id);
  // Postgrest 'in' limits to 100-200 nicely, but we might have more. If many, chunk or just fetch all.
  // Actually, we can just fetch all and group in memory if it's not huge.
  accQuery = accQuery.in('party_id', vendorIds);

  const { data: transactions, error: tError } = await accQuery;
  if (tError) throw tError;

  // 4. Calculate summaries per vendor
  const summaryMap = new Map<string, { total_due: number, total_paid: number, balance: number }>();
  
  if (transactions) {
    for (const t of transactions) {
      const existing = summaryMap.get(t.party_id) || { total_due: 0, total_paid: 0, balance: 0 };
      existing.total_due += Number(t.amount_due || 0);
      existing.total_paid += Number(t.amount_paid || 0);
      existing.balance = existing.total_due - existing.total_paid;
      summaryMap.set(t.party_id, existing);
    }
  }

  // 5. Attach summary to vendors
  return filteredVendors.map(v => ({
    ...v,
    summary: summaryMap.get(v.id) || { total_due: 0, total_paid: 0, balance: 0 }
  }));
}
