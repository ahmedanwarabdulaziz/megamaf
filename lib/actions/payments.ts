'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { sendPushNotification } from '@/lib/notifications';

export async function payVendor(formData: FormData, allocations: any[]) {
  const supabase = await createClient();
  
  const bank_account_id = formData.get('bank_account_id') as string;
  const vendor_id = formData.get('vendor_id') as string;
  const amount = parseFloat(formData.get('amount') as string);
  const memo = formData.get('memo') as string;
  const project_id = formData.get('project_id') as string || null;

  // Split allocations: prior_claim must be handled separately (not in payment_allocations)
  const priorClaimAllocations = allocations.filter(a => a.target_type === 'prior_claim');
  const standardAllocations = allocations.filter(a => a.target_type !== 'prior_claim');

  const { data, error } = await supabase.rpc('record_vendor_payment', {
    p_bank_account_id: bank_account_id,
    p_vendor_id: vendor_id,
    p_amount: amount,
    p_memo: memo || '',
    p_allocations: standardAllocations,
    p_project_id: project_id
  });

  if (error) {
    return { error: error.message };
  }

  // Handle prior_claim allocations via the pay_prior_claim RPC (bypasses super-admin-only RLS)
  for (const alloc of priorClaimAllocations) {
    if (alloc.amount > 0) {
      const { error: priorError } = await supabase.rpc('pay_prior_claim', {
        p_prior_claim_id: alloc.target_id,
        p_vendor_id: vendor_id,
        p_amount: alloc.amount,
      });
      if (priorError) {
        return { error: priorError.message };
      }
    }
  }

  // Notify admins
  const { data: admins } = await supabase.from('employees').select('id').eq('is_super_admin', true);
  if (admins && admins.length > 0) {
    const adminIds = admins.map(a => a.id);
    await sendPushNotification(
      adminIds,
      'تم صرف دفعة لمقاول',
      `تم صرف ${amount} للمقاول`,
      `/vendors/${vendor_id}/statement`,
      'payment_paid'
    );
  }

  revalidatePath('/treasury');
  revalidatePath(`/vendors/${vendor_id}/statement`);
  return { success: true };
}

export async function receiveFromOwner(formData: FormData, allocations: any[], attachments: string[] = []) {
  const supabase = await createClient();
  
  const bank_account_id = formData.get('bank_account_id') as string;
  const owner_id = formData.get('owner_id') as string;
  const amount = parseFloat(formData.get('amount') as string);
  const memo = formData.get('memo') as string;
  const project_id = formData.get('project_id') as string || null;

  const { data, error } = await supabase.rpc('record_owner_receipt', {
    p_bank_account_id: bank_account_id,
    p_owner_id: owner_id,
    p_amount: amount,
    p_memo: memo || '',
    p_allocations: allocations,
    p_project_id: project_id
  });

  if (error) {
    return { error: error.message };
  }

  const ledgerEntryId = data;

  if (attachments && attachments.length > 0) {
    const attachmentRows = attachments.map((url) => ({
      entity_type: 'ledger_entry',
      entity_id: ledgerEntryId,
      file_url: url
    }));
    await supabase.from('attachments').insert(attachmentRows);
  }

  // Notify admins
  const { data: admins } = await supabase.from('employees').select('id').eq('is_super_admin', true);
  if (admins && admins.length > 0) {
    const adminIds = admins.map(a => a.id);
    await sendPushNotification(
      adminIds,
      'تم استلام دفعة من مالك',
      `تم استلام ${amount} من مالك`,
      `/settings/owners/${owner_id}/statement`,
      'payment_received'
    );
  }

  revalidatePath('/treasury');
  revalidatePath(`/settings/owners/${owner_id}/statement`);
  return { success: true };
}

/** Retroactively assign an unlinked owner receipt to a project + optional claim allocations. */
export async function assignOwnerReceipt(
  ledgerEntryId: string,
  projectId: string,
  allocations: { target_type: string; target_id: string; amount: number }[]
) {
  const supabase = await createClient();

  const { error } = await supabase.rpc('assign_owner_receipt', {
    p_ledger_entry_id: ledgerEntryId,
    p_project_id: projectId,
    p_allocations: allocations,
  });

  if (error) return { error: error.message };

  revalidatePath('/treasury');
  revalidatePath('/settings/owners');
  return { success: true };
}
