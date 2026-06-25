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
