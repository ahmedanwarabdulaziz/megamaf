'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { sendPushNotification } from '@/lib/notifications';

// Server-side guard mirroring the vendor/project scoping check in lib/actions/claims.ts —
// a vendor restricted to specific projects must not be tagged with a payment for a
// project outside that scope, even if the client-side form was tampered with.
async function assertVendorProjectAccess(
  supabase: Awaited<ReturnType<typeof createClient>>,
  vendorId: string,
  projectId: string
) {
  const { data: vendor } = await supabase
    .from('vendors')
    .select('all_projects, vendor_project_access(project_id)')
    .eq('id', vendorId)
    .single();

  if (!vendor) return { error: 'Vendor not found' };

  if (!vendor.all_projects) {
    const allowedProjects = vendor.vendor_project_access?.map((p: any) => p.project_id) || [];
    if (!allowedProjects.includes(projectId)) {
      return { error: 'هذا المقاول/المورد غير مصرح له بالعمل في هذا المشروع' };
    }
  }
  return null;
}

export async function payVendor(formData: FormData, allocations: any[], attachments: string[] = []) {
  const supabase = await createClient();

  const bank_account_id = formData.get('bank_account_id') as string;
  const vendor_id = formData.get('vendor_id') as string;
  const amount = parseFloat(formData.get('amount') as string);
  const memo = formData.get('memo') as string;
  const project_id = formData.get('project_id') as string || null;

  if (project_id) {
    const accessError = await assertVendorProjectAccess(supabase, vendor_id, project_id);
    if (accessError) return accessError;
  }

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

  const ledgerEntryId = data;

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

  if (attachments && attachments.length > 0) {
    const { data: userData } = await supabase.auth.getUser();
    const { data: emp } = await supabase.from('employees').select('id').eq('auth_user_id', userData.user?.id).single();
    const attachmentRows = attachments.map((key) => ({
      entity_type: 'vendor_payment',
      entity_id: ledgerEntryId,
      r2_key: key,
      file_name: key,
      uploaded_by: emp?.id,
    }));
    const { error: attachError } = await supabase.from('attachments').insert(attachmentRows);
    if (attachError) console.error('Vendor payment attachment insert failed:', attachError);
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

export async function payVendorFromExpense(formData: FormData, allocations: any[], attachments: string[] = []) {
  const supabase = await createClient();

  const employee_id = formData.get('employee_id') as string;
  const expense_id = formData.get('expense_id') as string;
  const vendor_id = formData.get('vendor_id') as string;
  const amount = parseFloat(formData.get('amount') as string);
  const memo = formData.get('memo') as string;
  const project_id = formData.get('project_id') as string || null;

  if (project_id) {
    const accessError = await assertVendorProjectAccess(supabase, vendor_id, project_id);
    if (accessError) return accessError;
  }

  const priorClaimAllocations = allocations.filter(a => a.target_type === 'prior_claim');
  const standardAllocations = allocations.filter(a => a.target_type !== 'prior_claim');

  const { data, error } = await supabase.rpc('record_vendor_payment_from_expense', {
    p_employee_id: employee_id,
    p_expense_id: expense_id,
    p_vendor_id: vendor_id,
    p_amount: amount,
    p_memo: memo || '',
    p_allocations: standardAllocations,
    p_project_id: project_id
  });

  if (error) {
    return { error: error.message };
  }

  const ledgerEntryId = data;

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

  if (attachments && attachments.length > 0) {
    const { data: userData } = await supabase.auth.getUser();
    const { data: emp } = await supabase.from('employees').select('id').eq('auth_user_id', userData.user?.id).single();
    const attachmentRows = attachments.map((key) => ({
      entity_type: 'vendor_payment',
      entity_id: ledgerEntryId,
      r2_key: key,
      file_name: key,
      uploaded_by: emp?.id,
    }));
    const { error: attachError } = await supabase.from('attachments').insert(attachmentRows);
    if (attachError) console.error('Vendor payment attachment insert failed:', attachError);
  }

  const { data: admins } = await supabase.from('employees').select('id').eq('is_super_admin', true);
  if (admins && admins.length > 0) {
    const adminIds = admins.map(a => a.id);
    await sendPushNotification(
      adminIds,
      'تم صرف دفعة لمقاول من عهدة موظف',
      `تم صرف ${amount} للمقاول من مصروف معتمد`,
      `/vendors/${vendor_id}/statement`,
      'payment_paid'
    );
  }

  revalidatePath('/treasury');
  revalidatePath(`/vendors/${vendor_id}/statement`);
  revalidatePath('/expenses/statement');
  return { data, success: true };
}

export async function receiveFromOwner(formData: FormData, allocations: any[], attachments: string[] = []) {
  const supabase = await createClient();
  
  const bank_account_id = formData.get('bank_account_id') as string;
  const owner_id = formData.get('owner_id') as string;
  const amount = parseFloat(formData.get('amount') as string);
  const memo = formData.get('memo') as string;
  const project_id = formData.get('project_id') as string || null;

  if (project_id) {
    const { data: project } = await supabase.from('projects').select('owner_id').eq('id', project_id).single();
    if (!project || project.owner_id !== owner_id) {
      return { error: 'هذا المشروع لا يخص هذا المالك' };
    }
  }

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
    const { data: userData } = await supabase.auth.getUser();
    const { data: emp } = await supabase.from('employees').select('id').eq('auth_user_id', userData.user?.id).single();
    const attachmentRows = attachments.map((key) => ({
      entity_type: 'ledger_entry',
      entity_id: ledgerEntryId,
      r2_key: key,
      file_name: key,
      uploaded_by: emp?.id,
    }));
    const { error: attachError } = await supabase.from('attachments').insert(attachmentRows);
    if (attachError) console.error('Owner receipt attachment insert failed:', attachError);
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

/** Retroactively assign an unlinked (unallocated) vendor payment to a project + document allocations. */
export async function assignVendorPayment(
  ledgerEntryId: string,
  projectId: string,
  allocations: { target_type: string; target_id: string; amount: number }[]
) {
  const supabase = await createClient();

  const priorClaimAllocations = allocations.filter(a => a.target_type === 'prior_claim');
  const standardAllocations = allocations.filter(a => a.target_type !== 'prior_claim');

  const { error } = await supabase.rpc('assign_vendor_payment', {
    p_ledger_entry_id: ledgerEntryId,
    p_project_id: projectId,
    p_allocations: standardAllocations,
  });

  if (error) return { error: error.message };

  for (const alloc of priorClaimAllocations) {
    if (alloc.amount > 0) {
      // prior_claim allocations aren't handled by assign_vendor_payment's own loop
      // in the standard path above (it's filtered out here first); route them the
      // same way payVendor() does.
      const { data: entry } = await supabase.from('ledger_entries').select('counterparty_id').eq('id', ledgerEntryId).single();
      if (entry) {
        const { error: priorError } = await supabase.rpc('pay_prior_claim', {
          p_prior_claim_id: alloc.target_id,
          p_vendor_id: entry.counterparty_id,
          p_amount: alloc.amount,
        });
        if (priorError) return { error: priorError.message };
      }
    }
  }

  revalidatePath('/treasury');
  revalidatePath('/claims');
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
