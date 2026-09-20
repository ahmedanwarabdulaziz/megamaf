'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
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
    after(() => sendPushNotification(
      adminIds,
      'تم صرف دفعة لمقاول',
      `تم صرف ${amount} للمقاول`,
      `/vendors/${vendor_id}/statement`,
      'payment_paid'
    ));
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
    after(() => sendPushNotification(
      adminIds,
      'تم صرف دفعة لمقاول من عهدة موظف',
      `تم صرف ${amount} للمقاول من مصروف معتمد`,
      `/vendors/${vendor_id}/statement`,
      'payment_paid'
    ));
  }

  revalidatePath('/treasury');
  revalidatePath(`/vendors/${vendor_id}/statement`);
  revalidatePath('/expenses/statement');
  return { data, success: true };
}

const VENDOR_PAYMENT_REQUEST_FUNDING_TYPES = ['bank', 'employee_custody'] as const;

/** Submit a vendor payment funded from a bank account or another employee's
 *  custody (has_expense_funding_access). Nothing reaches the vendor's account
 *  here — it is saved as a pending request and only executes when an approver
 *  approves it in /expenses/approvals (approve_vendor_payment_request). */
export async function requestVendorPayment(formData: FormData, allocations: any[], attachments: string[] = []) {
  const supabase = await createClient();

  const vendor_id = formData.get('vendor_id') as string;
  const amount = parseFloat(formData.get('amount') as string);
  const memo = formData.get('memo') as string;
  const project_id = formData.get('project_id') as string || null;
  const funding_type = formData.get('funding_type') as string;
  const funding_bank_account_id = formData.get('funding_bank_account_id') as string || null;
  const funding_employee_id = formData.get('funding_employee_id') as string || null;

  if (!vendor_id) return { error: 'يجب اختيار المقاول' };
  if (!Number.isFinite(amount) || amount <= 0) return { error: 'المبلغ يجب أن يكون أكبر من صفر' };
  if (!(VENDOR_PAYMENT_REQUEST_FUNDING_TYPES as readonly string[]).includes(funding_type)) {
    return { error: 'يجب اختيار مصدر التمويل' };
  }
  if (funding_type === 'bank' && !funding_bank_account_id) return { error: 'يجب اختيار الحساب البنكي' };
  if (funding_type === 'employee_custody' && !funding_employee_id) return { error: 'يجب اختيار الموظف الممول' };

  if (project_id) {
    const accessError = await assertVendorProjectAccess(supabase, vendor_id, project_id);
    if (accessError) return accessError;
  }

  const { data: requestId, error } = await supabase.rpc('request_vendor_payment', {
    p_vendor_id: vendor_id,
    p_amount: amount,
    p_memo: memo || '',
    p_allocations: allocations,
    p_project_id: project_id,
    p_funding_type: funding_type,
    p_funding_bank_account_id: funding_type === 'bank' ? funding_bank_account_id : null,
    p_funding_employee_id: funding_type === 'employee_custody' ? funding_employee_id : null,
  });

  if (error) return { error: error.message };

  if (attachments && attachments.length > 0) {
    const { data: userData } = await supabase.auth.getUser();
    const { data: emp } = await supabase.from('employees').select('id').eq('auth_user_id', userData.user?.id).single();
    const attachmentRows = attachments.map((key) => ({
      entity_type: 'vendor_payment_request',
      entity_id: requestId,
      r2_key: key,
      file_name: key,
      uploaded_by: emp?.id,
    }));
    const { error: attachError } = await supabase.from('attachments').insert(attachmentRows);
    if (attachError) console.error('Vendor payment request attachment insert failed:', attachError);
  }

  const { data: approvers } = await supabase.from('employees').select('id').or('is_super_admin.eq.true,can_approve.eq.true');
  if (approvers && approvers.length > 0) {
    const approverIds = approvers.map(a => a.id);
    after(() => sendPushNotification(
      approverIds,
      'دفعة مقاول بانتظار الاعتماد',
      `تم تقديم طلب دفع بمبلغ ${amount} لمقاول`,
      '/expenses/approvals',
      'payment_request_submitted'
    ));
  }

  revalidatePath('/treasury');
  revalidatePath('/expenses/approvals');
  return { success: true, id: requestId as string };
}

export async function approveVendorPaymentRequest(requestId: string) {
  try {
    const supabase = await createClient();

    // Read before approving so we know who to notify and which statement to refresh.
    const { data: request } = await supabase
      .from('vendor_payment_requests')
      .select('requested_by, vendor_id, amount')
      .eq('id', requestId)
      .single();

    const { error } = await supabase.rpc('approve_vendor_payment_request', { p_request_id: requestId });
    if (error) return { error: error.message };

    if (request) {
      after(() => sendPushNotification(
        [request.requested_by],
        'تم اعتماد طلب الدفع',
        `تم اعتماد دفعة المقاول بمبلغ ${request.amount} وتسجيلها في حسابه`,
        '/treasury?tab=payables',
        'payment_request_approved'
      ));
      revalidatePath(`/vendors/${request.vendor_id}/statement`);
    }

    revalidatePath('/expenses/approvals');
    revalidatePath('/treasury');
    revalidatePath('/expenses/statement');
    return { success: true };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ' };
  }
}

export async function rejectVendorPaymentRequest(requestId: string, reason?: string) {
  try {
    const supabase = await createClient();

    const trimmedReason = reason?.trim();
    if (!trimmedReason) return { error: 'يرجى كتابة سبب الرفض' };

    const { data: request } = await supabase
      .from('vendor_payment_requests')
      .select('requested_by, amount')
      .eq('id', requestId)
      .single();

    const { error } = await supabase.rpc('reject_vendor_payment_request', { p_request_id: requestId, p_reason: trimmedReason });
    if (error) return { error: error.message };

    if (request) {
      after(() => sendPushNotification(
        [request.requested_by],
        'تم رفض طلب الدفع',
        `تم رفض طلب دفع المقاول بمبلغ ${request.amount}: ${trimmedReason}`,
        '/treasury?tab=payables',
        'payment_request_rejected'
      ));
    }

    revalidatePath('/expenses/approvals');
    revalidatePath('/treasury');
    return { success: true };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ' };
  }
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
    after(() => sendPushNotification(
      adminIds,
      'تم استلام دفعة من مالك',
      `تم استلام ${amount} من مالك`,
      `/settings/owners/${owner_id}/statement`,
      'payment_received'
    ));
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
