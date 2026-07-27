'use server';

import { createClient } from '@/lib/supabase/server';

const EXPORT_LIMIT = 10000;

export async function fetchAllAuditLogRows(filters: {
  entity_type?: string;
  action?: string;
  employee_id?: string;
  date_from?: string;
  date_to?: string;
}) {
  const supabase = await createClient();

  let query = supabase
    .from('audit_log')
    .select('*, employees(full_name)')
    .order('created_at', { ascending: false })
    .limit(EXPORT_LIMIT);

  if (filters.entity_type) query = query.eq('entity_type', filters.entity_type);
  if (filters.action) query = query.eq('action', filters.action);
  if (filters.employee_id) query = query.eq('employee_id', filters.employee_id);
  if (filters.date_from) query = query.gte('created_at', filters.date_from + 'T00:00:00Z');
  if (filters.date_to) query = query.lte('created_at', filters.date_to + 'T23:59:59Z');

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data || [];
}
