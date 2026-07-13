'use server';

import { createClient } from '@/lib/supabase/server';
import { logAudit } from '@/lib/audit';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';

async function getCurrentEmployee(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: userData } = await supabase.auth.getUser();
  const { data: employeeData } = await supabase
    .from('employees')
    .select('id, is_super_admin')
    .eq('auth_user_id', userData.user?.id)
    .single();
  return employeeData;
}

async function hasSalaryAccess(supabase: Awaited<ReturnType<typeof createClient>>, employeeData: { is_super_admin?: boolean } | null) {
  if (!employeeData) return false;
  if (employeeData.is_super_admin) return true;
  const { data } = await supabase.rpc('has_page_access', { p_slug: 'salary' });
  return !!data;
}

const customScheduleItemSchema = z.object({
  due_date: z.string(),
  amount: z.coerce.number().positive(),
});

const disburseLoanSchema = z.object({
  employee_id: z.string().uuid(),
  bank_account_id: z.string().uuid(),
  amount: z.coerce.number().positive(),
  date: z.string(),
  repayment_type: z.enum(['next_salary_full', 'equal_installments', 'custom_schedule']),
  installment_months: z.coerce.number().positive().optional(),
  custom_schedule: z.array(customScheduleItemSchema).optional(),
  memo: z.string().optional(),
});

export async function disburseLoan(formData: FormData) {
  try {
    const supabase = await createClient();
    const employeeData = await getCurrentEmployee(supabase);
    if (!(await hasSalaryAccess(supabase, employeeData))) {
      return { error: 'غير مصرح: هذه العملية تتطلب صلاحية الرواتب' };
    }

    let customSchedule: unknown;
    const customScheduleRaw = formData.get('custom_schedule') as string | null;
    if (customScheduleRaw) {
      try {
        customSchedule = JSON.parse(customScheduleRaw);
      } catch {
        return { error: 'جدول السداد المخصص غير صالح' };
      }
    }

    const parsed = disburseLoanSchema.safeParse({
      employee_id: formData.get('employee_id'),
      bank_account_id: formData.get('bank_account_id'),
      amount: formData.get('amount'),
      date: formData.get('date'),
      repayment_type: formData.get('repayment_type'),
      installment_months: formData.get('installment_months') || undefined,
      custom_schedule: customSchedule,
      memo: formData.get('memo') || undefined,
    });
    if (!parsed.success) {
      return { error: 'بيانات السلفة غير صالحة: ' + parsed.error.issues.map(e => e.path.join('.') + ': ' + e.message).join(' | ') };
    }

    const d = parsed.data;
    if (d.repayment_type === 'equal_installments' && !d.installment_months) {
      return { error: 'عدد الأقساط مطلوب لسداد الأقساط المتساوية' };
    }
    if (d.repayment_type === 'custom_schedule' && (!d.custom_schedule || d.custom_schedule.length === 0)) {
      return { error: 'جدول السداد المخصص مطلوب' };
    }

    const { data, error } = await supabase.rpc('disburse_loan', {
      p_employee_id: d.employee_id,
      p_bank_account_id: d.bank_account_id,
      p_amount: d.amount,
      p_date: d.date,
      p_repayment_type: d.repayment_type,
      p_installment_months: d.installment_months || null,
      p_custom_schedule: d.custom_schedule || null,
      p_memo: d.memo || null,
    });
    if (error) return { error: error.message };

    revalidatePath(`/salary/${d.employee_id}`);
    return { success: true, id: data as string };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ غير متوقع' };
  }
}

export async function cancelLoan(formData: FormData) {
  try {
    const supabase = await createClient();
    const employeeData = await getCurrentEmployee(supabase);
    if (!(await hasSalaryAccess(supabase, employeeData))) {
      return { error: 'غير مصرح: هذه العملية تتطلب صلاحية الرواتب' };
    }

    const loan_id = formData.get('loan_id') as string;
    const employee_id = formData.get('employee_id') as string | null;
    if (!loan_id) return { error: 'السلفة غير محددة' };

    const { error } = await supabase.rpc('cancel_loan', { p_loan_id: loan_id });
    if (error) return { error: error.message };

    revalidatePath(`/salary/loans/${loan_id}`);
    if (employee_id) revalidatePath(`/salary/${employee_id}`);
    return { success: true };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ غير متوقع' };
  }
}

export async function getEmployeeLoanSummary(employeeId: string) {
  try {
    const supabase = await createClient();

    const { data: loans, error } = await supabase
      .from('employee_loans')
      .select('*')
      .eq('employee_id', employeeId)
      .order('disbursed_date', { ascending: false });
    if (error) return { error: error.message };
    if (!loans || loans.length === 0) return { data: [] };

    const loanIds = loans.map(l => l.id);
    const [{ data: installments }, { data: repayments }] = await Promise.all([
      supabase.from('loan_installments').select('*').in('loan_id', loanIds).order('due_date', { ascending: true }),
      supabase.from('loan_repayments').select('*').in('loan_id', loanIds).order('repayment_date', { ascending: false }),
    ]);

    const result = loans.map(loan => {
      const loanInstallments = (installments || []).filter(i => i.loan_id === loan.id);
      const loanRepayments = (repayments || []).filter(r => r.loan_id === loan.id);
      const totalRepaid = loanInstallments.reduce((sum, i) => sum + Number(i.paid_amount || 0), 0);
      return {
        loan,
        installments: loanInstallments,
        repayments: loanRepayments,
        totalRepaid,
        remaining: Number(loan.principal_amount) - totalRepaid,
      };
    });

    return { data: result };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ غير متوقع' };
  }
}
