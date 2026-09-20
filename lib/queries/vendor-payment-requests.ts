'use server';

import { createClient } from '@/lib/supabase/server';

export type VendorPaymentRequestStatus = 'pending' | 'approved' | 'rejected';

/** Vendor payment requests (payments funded from a bank account or another
 *  employee's custody that wait for approval before landing on the vendor's
 *  account). RLS already limits non-approvers to their own requests. */
export async function getVendorPaymentRequests(filters: {
  statuses: VendorPaymentRequestStatus[];
  requestedBy?: string;
  projectId?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}) {
  const supabase = await createClient();
  let query = supabase
    .from('vendor_payment_requests')
    .select(`
      *,
      vendor:vendors(name),
      project:projects(name),
      requester:employees!vendor_payment_requests_requested_by_fkey(full_name),
      reviewer:employees!vendor_payment_requests_reviewed_by_fkey(full_name),
      funding_bank:bank_accounts!vendor_payment_requests_funding_bank_account_id_fkey(account_name, banks(name)),
      funding_employee:employees!vendor_payment_requests_funding_employee_id_fkey(full_name)
    `)
    .in('status', filters.statuses)
    .order('created_at', { ascending: false })
    .limit(filters.limit ?? 200);

  if (filters.requestedBy) query = query.eq('requested_by', filters.requestedBy);
  if (filters.projectId) query = query.eq('project_id', filters.projectId);
  if (filters.startDate) query = query.gte('created_at', `${filters.startDate}T00:00:00`);
  if (filters.endDate) query = query.lte('created_at', `${filters.endDate}T23:59:59.999`);

  const { data: requests, error } = await query;
  if (error) {
    console.error('[getVendorPaymentRequests]', error);
    return [];
  }
  if (!requests || requests.length === 0) return [];

  const { data: attachments } = await supabase
    .from('attachments')
    .select('entity_id, r2_key')
    .eq('entity_type', 'vendor_payment_request')
    .in('entity_id', requests.map(r => r.id));

  return requests.map(r => ({
    ...r,
    attachments: attachments?.filter(a => a.entity_id === r.id) || [],
  }));
}
