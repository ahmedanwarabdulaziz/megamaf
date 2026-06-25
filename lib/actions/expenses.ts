'use server';

import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { sendPushNotification } from '@/lib/notifications';

const createExpenseSchema = z.object({
  project_id: z.string().uuid(),
  category_id: z.string().uuid(),
  expense_date: z.string(),
  amount: z.coerce.number().positive(),
  notes: z.string().optional(),
  attachment_url: z.string().optional(),
});

export async function createExpense(formData: FormData) {
  try {
    const supabase = await createClient();
    
    const parsed = createExpenseSchema.safeParse({
      project_id: formData.get('project_id'),
      category_id: formData.get('category_id'),
      expense_date: formData.get('expense_date'),
      amount: formData.get('amount'),
      notes: formData.get('notes'),
    });

    if (!parsed.success) {
      return { error: 'Invalid expense data' };
    }

    // Super admins bypass project access check; others must have it
    const { data: userData } = await supabase.auth.getUser();
    const { data: employeeData, error: empError } = await supabase
      .from('employees')
      .select('id, is_super_admin, has_custody_access')
      .eq('auth_user_id', userData.user?.id)
      .single();

    if (empError || !employeeData) return { error: 'Employee profile not found' };

    if (!employeeData.is_super_admin) {
      const { data: hasAccess, error: accessError } = await supabase.rpc('has_project_access', { p_project_id: parsed.data.project_id });
      if (accessError) return { error: accessError.message };
      if (!hasAccess) return { error: 'لا تملك صلاحية على هذا المشروع' };
    }

    // Determine target employee: admin can pick any; others always use self
    const targetEmployeeIdRaw = formData.get('target_employee_id') as string | null;
    let targetEmployeeId = employeeData.id;

    if (employeeData.is_super_admin && targetEmployeeIdRaw && targetEmployeeIdRaw.trim() !== '') {
      // Validate the target employee exists
      const { data: targetEmp } = await supabase
        .from('employees')
        .select('id, has_custody_access')
        .eq('id', targetEmployeeIdRaw.trim())
        .single();
      if (!targetEmp) return { error: 'الموظف المحدد غير موجود' };
      targetEmployeeId = targetEmp.id;
    } else if (!employeeData.is_super_admin && !employeeData.has_custody_access) {
      return { error: 'لا تملك صلاحية تسجيل المصروفات' };
    }

    // Enforce date backdating logic (max 15 days for non-admins)
    const expenseDate = new Date(parsed.data.expense_date);
    const today = new Date();
    expenseDate.setHours(0, 0, 0, 0);
    today.setHours(0, 0, 0, 0);
    const diffTime = today.getTime() - expenseDate.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (!employeeData.is_super_admin && diffDays < 0) {
      return { error: 'لا يمكن تسجيل مصروف بتاريخ مستقبلي' };
    }
    if (!employeeData.is_super_admin && diffDays > 15) {
      return { error: 'لا يمكن تسجيل مصروف أقدم من 15 يوم' };
    }

    const { data, error } = await supabase
      .from('expenses')
      .insert({
        project_id: parsed.data.project_id,
        employee_id: targetEmployeeId,
        category_id: parsed.data.category_id,
        expense_date: parsed.data.expense_date,
        amount: parsed.data.amount,
        notes: parsed.data.notes,
      })
      .select('id')
      .single();

    if (error) return { error: error.message };

    // FIX 4: Handle multiple attachments
    const attachmentUrls = formData.getAll('attachment_url') as string[];
    if (attachmentUrls.length > 0) {
      const attachmentRows = attachmentUrls.map(url => ({
        entity_type: 'expense',
        entity_id: data.id,
        r2_key: url,
        uploaded_by: employeeData.id,
      }));
      const { error: attachError } = await supabase.from('attachments').insert(attachmentRows);
      if (attachError) console.error("Attachment insert failed:", attachError);
    }

    await logAudit({
      employee_id: employeeData.id,
      action: 'create',
      entity_type: 'expense',
      entity_id: data.id,
      after: parsed.data,
    });

    // Notify approvers
    const { data: approvers } = await supabase.from('employees').select('id').or('is_super_admin.eq.true,can_approve.eq.true');
    if (approvers && approvers.length > 0) {
      const approverIds = approvers.map(a => a.id);
      await sendPushNotification(
        approverIds,
        'مصروف جديد بانتظار الاعتماد',
        `تم تقديم مصروف عهدة جديد`,
        '/expenses/approvals',
        'expense_submitted'
      );
    }

    revalidatePath('/expenses');
    revalidatePath('/expenses/statement');
    return { data };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ غير متوقع' };
  }
}

export async function approveExpense(expenseId: string) {
  try {
    const supabase = await createClient();
    
    // We get the submitter before we approve it, so we can notify them
    const { data: expenseRecord } = await supabase.from('expenses').select('employee_id, expense_number').eq('id', expenseId).single();

    const { error } = await supabase.rpc('approve_expense', { p_expense_id: expenseId });
    if (error) return { error: error.message };
    
    if (expenseRecord) {
       await sendPushNotification(
         [expenseRecord.employee_id],
         'تم اعتماد المصروف',
         `تم اعتماد المصروف رقم ${expenseRecord.expense_number} الخاص بك`,
         `/expenses`,
         'expense_approved'
       );
    }

    revalidatePath('/expenses/approvals');
    revalidatePath('/expenses/statement');
    return { success: true };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ' };
  }
}

export async function rejectExpense(expenseId: string) {
  try {
    const supabase = await createClient();

    const { data: expenseRecord } = await supabase.from('expenses').select('employee_id, expense_number').eq('id', expenseId).single();

    const { error } = await supabase.rpc('reject_expense', { p_expense_id: expenseId });
    if (error) return { error: error.message };
    
    if (expenseRecord) {
       await sendPushNotification(
         [expenseRecord.employee_id],
         'تم رفض المصروف',
         `تم رفض المصروف رقم ${expenseRecord.expense_number} الذي قدمته`,
         `/expenses`,
         'expense_rejected'
       );
    }

    revalidatePath('/expenses/approvals');
    return { success: true };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ' };
  }
}

const disburseSchema = z.object({
  bank_account_id: z.string().uuid(),
  employee_id: z.string().uuid(),
  amount: z.coerce.number().positive(),
  date: z.string(),
  memo: z.string(),
});

export async function disburseCustody(formData: FormData) {
  try {
    const supabase = await createClient();
    
    const parsed = disburseSchema.safeParse({
      bank_account_id: formData.get('bank_account_id'),
      employee_id: formData.get('employee_id'),
      amount: formData.get('amount'),
      date: formData.get('date'),
      memo: formData.get('memo'),
    });

    if (!parsed.success) return { error: 'Invalid disbursement data' };

    const { data: userData } = await supabase.auth.getUser();
    const { data: emp } = await supabase
      .from('employees')
      .select('id')
      .eq('auth_user_id', userData.user?.id)
      .single();
    if (!emp) return { error: 'Employee not found' };

    const { data: ledgerEntryId, error } = await supabase.rpc('disburse_custody', {
      p_bank_account_id: parsed.data.bank_account_id,
      p_employee_id: parsed.data.employee_id,
      p_amount: parsed.data.amount,
      p_date: parsed.data.date,
      p_memo: parsed.data.memo,
    });

    if (error) return { error: error.message };

    // Save attachments if any were uploaded
    const attachmentUrls = formData.getAll('attachment_url') as string[];
    if (attachmentUrls.length > 0 && ledgerEntryId) {
      const rows = attachmentUrls.map(url => ({
        entity_type: 'custody_disbursement',
        entity_id: ledgerEntryId as string,
        r2_key: url,
        uploaded_by: emp.id,
      }));
      const { error: attachError } = await supabase.from('attachments').insert(rows);
      if (attachError) console.error('Attachment insert failed:', attachError);
    }

    revalidatePath('/treasury/custody');
    revalidatePath('/expenses/statement');
    revalidatePath('/banks');
    return { success: true };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ' };
  }
}

// ──────────────────────────────────────────────
// OWNER EXPENSES
// ──────────────────────────────────────────────

const createOwnerExpenseSchema = z.object({
  owner_id:     z.string().uuid(),
  project_id:   z.string().uuid().optional().or(z.literal('')),
  category_id:  z.string().uuid(),
  expense_date: z.string(),
  amount:       z.coerce.number().positive(),
  notes:        z.string().optional(),
});

export async function createOwnerExpense(formData: FormData) {
  try {
    const supabase = await createClient();

    const raw = (k: string) => { const v = formData.get(k); return v === null ? undefined : v; };

    const parsed = createOwnerExpenseSchema.safeParse({
      owner_id:     raw('owner_id'),
      project_id:   raw('project_id') ?? '',
      category_id:  raw('category_id'),
      expense_date: raw('expense_date'),
      amount:       raw('amount'),
      notes:        raw('notes') ?? '',
    });

    if (!parsed.success) {
      const msgs = parsed.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
      return { error: `بيانات غير صالحة: ${msgs}` };
    }

    const { data: userData } = await supabase.auth.getUser();
    const { data: emp } = await supabase
      .from('employees')
      .select('id, is_super_admin, can_approve')
      .eq('auth_user_id', userData.user?.id)
      .single();

    if (!emp) return { error: 'Employee not found' };
    if (!emp.can_approve && !emp.is_super_admin) return { error: 'غير مصرح لك بإضافة مصروفات للملاك' };

    const { data, error } = await supabase
      .from('expenses')
      .insert({
        owner_id:     parsed.data.owner_id,
        project_id:   parsed.data.project_id || null,
        category_id:  parsed.data.category_id,
        expense_date: parsed.data.expense_date,
        amount:       parsed.data.amount,
        notes:        parsed.data.notes || null,
        // employee_id intentionally omitted (owner expense)
      })
      .select('id')
      .single();

    if (error) return { error: error.message };

    // Save attachments
    const attachmentUrls = formData.getAll('attachment_url') as string[];
    if (attachmentUrls.length > 0 && data?.id) {
      const rows = attachmentUrls.map(url => ({
        entity_type: 'expense',
        entity_id: data.id,
        r2_key: url,
        uploaded_by: emp.id,
      }));
      const { error: attachError } = await supabase.from('attachments').insert(rows);
      if (attachError) console.error('Attachment insert failed:', attachError);
    }

    await logAudit({ employee_id: emp.id, action: 'create', entity_type: 'owner_expense', entity_id: data.id, after: parsed.data });

    // Notify approvers
    const { data: approvers } = await supabase.from('employees').select('id').or('is_super_admin.eq.true,can_approve.eq.true');
    if (approvers && approvers.length > 0) {
      await sendPushNotification(
        approvers.map(a => a.id),
        'مصروف مالك جديد بانتظار الاعتماد',
        'تم تسجيل مصروف جديد لأحد الملاك',
        '/expenses/approvals',
        'expense_submitted'
      );
    }

    revalidatePath('/expenses');
    revalidatePath('/expenses/approvals');
    revalidatePath('/treasury/custody');
    return { success: true, id: data.id };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ غير متوقع' };
  }
}

// ──────────────────────────────────────────────
// OWNER CUSTODY DISBURSEMENT
// ──────────────────────────────────────────────

const disburseOwnerSchema = z.object({
  bank_account_id: z.string().uuid(),
  owner_id:        z.string().uuid(),
  amount:          z.coerce.number().positive(),
  date:            z.string(),
  memo:            z.string().min(1),
});

export async function disburseOwnerCustody(formData: FormData) {
  try {
    const supabase = await createClient();
    const raw = (k: string) => { const v = formData.get(k); return v === null ? undefined : v; };

    const parsed = disburseOwnerSchema.safeParse({
      bank_account_id: raw('bank_account_id'),
      owner_id:        raw('owner_id'),
      amount:          raw('amount'),
      date:            raw('date'),
      memo:            raw('memo'),
    });

    if (!parsed.success) return { error: 'بيانات الصرف غير صالحة' };

    const { data: disbId, error } = await supabase.rpc('disburse_owner_custody', {
      p_bank_account_id: parsed.data.bank_account_id,
      p_owner_id:        parsed.data.owner_id,
      p_amount:          parsed.data.amount,
      p_date:            parsed.data.date,
      p_memo:            parsed.data.memo,
    });

    if (error) return { error: error.message };

    // Save attachments
    const { data: userData } = await supabase.auth.getUser();
    const { data: emp } = await supabase.from('employees').select('id').eq('auth_user_id', userData.user?.id).single();
    const attachmentUrls = formData.getAll('attachment_url') as string[];
    if (attachmentUrls.length > 0 && disbId && emp) {
      const rows = attachmentUrls.map(url => ({
        entity_type: 'owner_custody_disbursement',
        entity_id: disbId as string,
        r2_key: url,
        uploaded_by: emp.id,
      }));
      const { error: attachError } = await supabase.from('attachments').insert(rows);
      if (attachError) console.error('Attachment insert failed:', attachError);
    }

    revalidatePath('/treasury/custody');
    revalidatePath('/banks');
    return { success: true };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ' };
  }
}


