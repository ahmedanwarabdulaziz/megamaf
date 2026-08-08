'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logAudit } from '@/lib/audit';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import crypto from 'crypto';

// MAF Main Company uses a padded placeholder id ('00000000-...-000000000001'),
// not a real RFC-4122 UUID (invalid version nibble) — z.string().uuid() in
// Zod 4 rejects it, so project_id fields use a loose format check instead.
const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const allocationSchema = z.object({
  project_id: z.string().regex(uuidRegex, 'Invalid UUID'),
  allocation_type: z.enum(['percentage', 'fixed_amount']),
  allocation_value: z.coerce.number().positive(),
});

const setSalarySchema = z.object({
  employee_id: z.string().uuid(),
  effective_from: z.string(),
  base_amount: z.coerce.number().min(0),
});

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

// Payroll-only people never log in, so the username only needs to be unique —
// it's not shown or typed anywhere. Generating it avoids transliterating
// Arabic full names into a login-style identifier.
async function generatePayrollUsername(adminClient: ReturnType<typeof createAdminClient>) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `payroll-${crypto.randomUUID().slice(0, 8)}`;
    const { data: existing } = await adminClient.from('employees').select('id').eq('username', candidate).maybeSingle();
    if (!existing) return candidate;
  }
  throw new Error('تعذر إنشاء اسم مستخدم فريد');
}

const createPayrollOnlyEmployeeSchema = z.object({
  full_name: z.string().min(1, 'الاسم مطلوب'),
  phone: z.string().optional(),
});

export async function createPayrollOnlyEmployee(formData: FormData) {
  try {
    const supabase = await createClient();
    const employeeData = await getCurrentEmployee(supabase);
    if (!(await hasSalaryAccess(supabase, employeeData))) {
      return { error: 'غير مصرح: هذه العملية تتطلب صلاحية الرواتب' };
    }

    const parsed = createPayrollOnlyEmployeeSchema.safeParse({
      full_name: formData.get('full_name'),
      phone: formData.get('phone') || undefined,
    });
    if (!parsed.success) {
      return { error: 'بيانات غير صالحة: ' + parsed.error.issues.map(e => e.message).join(' | ') };
    }

    const adminClient = createAdminClient();
    const username = await generatePayrollUsername(adminClient);

    const { data: emp, error } = await adminClient
      .from('employees')
      .insert({
        full_name: parsed.data.full_name,
        phone: parsed.data.phone,
        username,
        role: 'standard',
        is_active: true,
        can_approve: false,
        is_super_admin: false,
        has_custody_access: false,
        employment_type: 'payroll_only',
        auth_user_id: null,
      })
      .select('id')
      .single();

    if (error) return { error: error.message };

    await logAudit({
      employee_id: employeeData!.id,
      action: 'create',
      entity_type: 'employee',
      entity_id: emp.id,
      after: { full_name: parsed.data.full_name, employment_type: 'payroll_only' },
    });

    revalidatePath('/salary');
    return { success: true, id: emp.id };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ غير متوقع' };
  }
}

export async function setEmployeeSalary(formData: FormData) {
  try {
    const supabase = await createClient();
    const employeeData = await getCurrentEmployee(supabase);
    if (!(await hasSalaryAccess(supabase, employeeData))) {
      return { error: 'غير مصرح: هذه العملية تتطلب صلاحية الرواتب' };
    }

    const parsed = setSalarySchema.safeParse({
      employee_id: formData.get('employee_id'),
      effective_from: formData.get('effective_from'),
      base_amount: formData.get('base_amount'),
    });
    if (!parsed.success) {
      return { error: 'بيانات الراتب غير صالحة: ' + parsed.error.issues.map(e => e.path.join('.') + ': ' + e.message).join(' | ') };
    }

    const { employee_id, effective_from, base_amount } = parsed.data;

    const { data: priorOpen } = await supabase
      .from('employee_salaries')
      .select('id')
      .eq('employee_id', employee_id)
      .is('effective_to', null)
      .maybeSingle();

    if (priorOpen) {
      const effectiveToDate = new Date(effective_from + 'T00:00:00Z');
      effectiveToDate.setUTCDate(effectiveToDate.getUTCDate() - 1);
      const { error: closeError } = await supabase
        .from('employee_salaries')
        .update({ effective_to: effectiveToDate.toISOString().split('T')[0] })
        .eq('id', priorOpen.id);
      if (closeError) return { error: closeError.message };
    }

    const { data: salary, error: salaryError } = await supabase
      .from('employee_salaries')
      .insert({
        employee_id,
        effective_from,
        base_amount,
        created_by: employeeData!.id,
      })
      .select('id')
      .single();
    if (salaryError) return { error: salaryError.message };

    await logAudit({
      employee_id: employeeData!.id,
      action: priorOpen ? 'update' : 'create',
      entity_type: 'employee_salary',
      entity_id: salary.id,
      after: { employee_id, effective_from, base_amount },
    });

    revalidatePath('/salary');
    revalidatePath(`/salary/${employee_id}`);
    return { success: true, id: salary.id };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ غير متوقع' };
  }
}

const setPayslipAllocationsSchema = z.object({
  payslip_id: z.string().uuid(),
  allocations: z.array(allocationSchema),
});

// Editable "workspace" while the payslip is draft — approve_payroll_run is
// what actually enforces that the split sums to the base salary before the
// run can be approved, mirroring how payslip components work.
export async function setPayslipProjectAllocations(formData: FormData) {
  try {
    const supabase = await createClient();
    const employeeData = await getCurrentEmployee(supabase);
    if (!(await hasSalaryAccess(supabase, employeeData))) {
      return { error: 'غير مصرح: هذه العملية تتطلب صلاحية الرواتب' };
    }

    let allocationsRaw: unknown;
    try {
      allocationsRaw = JSON.parse((formData.get('allocations') as string) || '[]');
    } catch {
      return { error: 'بيانات توزيع المشاريع غير صالحة' };
    }

    const parsed = setPayslipAllocationsSchema.safeParse({
      payslip_id: formData.get('payslip_id'),
      allocations: allocationsRaw,
    });
    if (!parsed.success) {
      return { error: 'بيانات توزيع المشاريع غير صالحة: ' + parsed.error.issues.map(e => e.path.join('.') + ': ' + e.message).join(' | ') };
    }

    const { payslip_id, allocations } = parsed.data;

    const { data: payslip } = await supabase.from('payslips').select('status, payroll_run_id, base_amount').eq('id', payslip_id).single();
    if (!payslip) return { error: 'قسيمة الراتب غير موجودة' };
    if (payslip.status !== 'draft') return { error: 'لا يمكن تعديل توزيع المشاريع بعد اعتماد الدورة' };

    const baseAmount = Number(payslip.base_amount);
    const rows = allocations.map(a => ({
      payslip_id,
      project_id: a.project_id,
      allocation_type: a.allocation_type,
      allocation_value: a.allocation_value,
      allocated_amount: a.allocation_type === 'percentage' ? Math.round(baseAmount * a.allocation_value) / 100 : a.allocation_value,
    }));

    const { error: deleteError } = await supabase.from('payslip_project_allocations').delete().eq('payslip_id', payslip_id);
    if (deleteError) return { error: deleteError.message };

    if (rows.length > 0) {
      const { error: insertError } = await supabase.from('payslip_project_allocations').insert(rows);
      if (insertError) return { error: insertError.message };
    }

    await logAudit({
      employee_id: employeeData!.id,
      action: 'update',
      entity_type: 'payslip_project_allocations',
      entity_id: payslip_id,
      after: { allocations: rows },
    });

    revalidatePath(`/salary/runs/${payslip.payroll_run_id}`);
    revalidatePath(`/salary/runs/${payslip.payroll_run_id}/payslips/${payslip_id}`);
    return { success: true };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ غير متوقع' };
  }
}

export async function generatePayrollRun(formData: FormData) {
  try {
    const supabase = await createClient();
    const p_year = parseInt(formData.get('period_year') as string, 10);
    const p_month = parseInt(formData.get('period_month') as string, 10);
    if (!p_year || !p_month) return { error: 'الشهر والسنة مطلوبان' };

    const { data, error } = await supabase.rpc('generate_payroll_run', { p_year, p_month });
    if (error) return { error: error.message };

    revalidatePath('/salary/runs');
    return { success: true, id: data as string };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ غير متوقع' };
  }
}

export async function addEmployeeToPayrollRun(formData: FormData) {
  try {
    const supabase = await createClient();
    const run_id = formData.get('run_id') as string;
    const employee_id = formData.get('employee_id') as string;
    if (!run_id || !employee_id) return { error: 'يجب اختيار الموظف' };

    const { data, error } = await supabase.rpc('add_employee_to_payroll_run', { p_run_id: run_id, p_employee_id: employee_id });
    if (error) return { error: error.message };

    revalidatePath(`/salary/runs/${run_id}`);
    return { success: true, id: data as string };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ غير متوقع' };
  }
}

export async function addEmployeesToPayrollRun(formData: FormData) {
  try {
    const supabase = await createClient();
    const run_id = formData.get('run_id') as string;
    const employee_ids = formData.getAll('employee_ids[]') as string[];
    if (!run_id) return { error: 'الدورة غير محددة' };
    if (!employee_ids.length) return { error: 'يجب اختيار موظف واحد على الأقل' };

    const results = await Promise.all(
      employee_ids.map(emp_id =>
        supabase.rpc('add_employee_to_payroll_run', { p_run_id: run_id, p_employee_id: emp_id })
      )
    );

    const failed = results.filter(r => r.error);
    if (failed.length) return { error: failed[0].error!.message };

    revalidatePath(`/salary/runs/${run_id}`);
    return { success: true };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ غير متوقع' };
  }
}


export async function removePayslipFromRun(formData: FormData) {
  try {
    const supabase = await createClient();
    const payslip_id = formData.get('payslip_id') as string;
    const run_id = formData.get('run_id') as string;
    if (!payslip_id) return { error: 'قسيمة الراتب غير محددة' };

    const { error } = await supabase.rpc('remove_payslip_from_run', { p_payslip_id: payslip_id });
    if (error) return { error: error.message };

    if (run_id) revalidatePath(`/salary/runs/${run_id}`);
    return { success: true };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ غير متوقع' };
  }
}

export async function deletePayrollRun(formData: FormData) {
  try {
    const supabase = await createClient();
    const run_id = formData.get('run_id') as string;
    if (!run_id) return { error: 'الدورة غير محددة' };

    const { error } = await supabase.rpc('delete_payroll_run', { p_run_id: run_id });
    if (error) return { error: error.message };

    revalidatePath('/salary/runs');
    return { success: true };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ غير متوقع' };
  }
}

export async function approvePayrollRun(formData: FormData) {
  try {
    const supabase = await createClient();
    const p_run_id = formData.get('run_id') as string;
    if (!p_run_id) return { error: 'الدورة غير محددة' };

    const { error } = await supabase.rpc('approve_payroll_run', { p_run_id });
    if (error) return { error: error.message };

    revalidatePath('/salary/runs');
    revalidatePath(`/salary/runs/${p_run_id}`);
    return { success: true };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ غير متوقع' };
  }
}

export async function payPayslipFromBank(formData: FormData) {
  try {
    const supabase = await createClient();
    const p_payslip_id = formData.get('payslip_id') as string;
    const p_bank_account_id = formData.get('bank_account_id') as string;
    const p_amount = parseFloat(formData.get('amount') as string);
    const p_date = formData.get('payment_date') as string;
    const p_memo = (formData.get('memo') as string) || null;
    const run_id = formData.get('run_id') as string | null;

    if (!p_payslip_id || !p_bank_account_id || !p_date || !(p_amount > 0)) {
      return { error: 'بيانات الدفع غير مكتملة' };
    }

    const { error } = await supabase.rpc('pay_payslip_from_bank', { p_payslip_id, p_bank_account_id, p_amount, p_date, p_memo });
    if (error) return { error: error.message };

    revalidatePath('/salary/runs');
    if (run_id) revalidatePath(`/salary/runs/${run_id}`);
    return { success: true };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ غير متوقع' };
  }
}

const bulkPayItemSchema = z.object({
  payslip_id: z.string().uuid(),
  amount: z.coerce.number().positive(),
});

const bulkPaySchema = z.object({
  bank_account_id: z.string().uuid(),
  payment_date: z.string(),
  memo: z.string().optional(),
  items: z.array(bulkPayItemSchema).min(1, 'يجب اختيار قسيمة واحدة على الأقل'),
});

// Bank-only: each selected payslip is paid in full (the client sends its
// already-known "remaining" as amount). pay_payslip_from_bank independently
// re-validates that amount against the real remaining balance server-side,
// so a stale client value just fails that one row rather than overpaying.
export async function bulkPayPayslipsFromBank(formData: FormData) {
  try {
    const supabase = await createClient();
    const employeeData = await getCurrentEmployee(supabase);
    if (!(await hasSalaryAccess(supabase, employeeData))) {
      return { error: 'غير مصرح: هذه العملية تتطلب صلاحية الرواتب' };
    }

    let itemsRaw: unknown;
    try {
      itemsRaw = JSON.parse((formData.get('items') as string) || '[]');
    } catch {
      return { error: 'بيانات الدفع الجماعي غير صالحة' };
    }

    const parsed = bulkPaySchema.safeParse({
      bank_account_id: formData.get('bank_account_id'),
      payment_date: formData.get('payment_date'),
      memo: formData.get('memo') || undefined,
      items: itemsRaw,
    });
    if (!parsed.success) {
      return { error: 'بيانات الدفع الجماعي غير صالحة: ' + parsed.error.issues.map(e => e.path.join('.') + ': ' + e.message).join(' | ') };
    }

    const { bank_account_id, payment_date, memo, items } = parsed.data;
    const run_id = formData.get('run_id') as string | null;

    const results = await Promise.all(
      items.map(async item => {
        const { error } = await supabase.rpc('pay_payslip_from_bank', {
          p_payslip_id: item.payslip_id,
          p_bank_account_id: bank_account_id,
          p_amount: item.amount,
          p_date: payment_date,
          p_memo: memo || null,
        });
        return { payslip_id: item.payslip_id, error: error?.message };
      })
    );

    const failed = results.filter(r => r.error);
    const paidCount = items.length - failed.length;

    if (paidCount > 0) {
      await logAudit({
        employee_id: employeeData!.id,
        action: 'update',
        entity_type: 'payslip_payment_bulk',
        entity_id: run_id || bank_account_id,
        after: { bank_account_id, payment_date, paid_count: paidCount, failed_count: failed.length },
      });
    }

    revalidatePath('/salary/runs');
    if (run_id) revalidatePath(`/salary/runs/${run_id}`);

    if (failed.length === items.length) {
      return { error: 'فشل الدفع لجميع القسائم المحددة: ' + failed[0].error };
    }
    if (failed.length > 0) {
      return {
        success: true,
        error: `تم الدفع لـ ${paidCount} من ${items.length}. فشل الباقي: ${failed.map(f => f.error).join(' | ')}`,
      };
    }
    return { success: true };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ غير متوقع' };
  }
}

export async function payPayslipFromExpense(formData: FormData) {
  try {
    const supabase = await createClient();
    const p_payslip_id = formData.get('payslip_id') as string;
    const p_funding_employee_id = formData.get('funding_employee_id') as string;
    const p_expense_id = formData.get('expense_id') as string;
    const p_amount = parseFloat(formData.get('amount') as string);
    const p_date = formData.get('payment_date') as string;
    const p_memo = (formData.get('memo') as string) || null;
    const run_id = formData.get('run_id') as string | null;

    if (!p_payslip_id || !p_funding_employee_id || !p_expense_id || !p_date || !(p_amount > 0)) {
      return { error: 'بيانات الدفع غير مكتملة' };
    }

    const { error } = await supabase.rpc('pay_payslip_from_expense', {
      p_payslip_id, p_funding_employee_id, p_expense_id, p_amount, p_date, p_memo,
    });
    if (error) return { error: error.message };

    revalidatePath('/salary/runs');
    if (run_id) revalidatePath(`/salary/runs/${run_id}`);
    return { success: true };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ غير متوقع' };
  }
}

const bulkPayExpenseSchema = z.object({
  funding_employee_id: z.string().uuid(),
  expense_id: z.string().uuid(),
  payment_date: z.string(),
  memo: z.string().optional(),
  items: z.array(bulkPayItemSchema).min(1, 'يجب اختيار قسيمة واحدة على الأقل'),
});

// One employee custody (approved expense) funds several payslips. Unlike the
// bank path, this must run sequentially, not Promise.all: pay_payslip_from_expense
// re-derives the expense's remaining balance from v_expense_vendor_paid on each
// call with no row lock on the expense itself, so parallel calls could both read
// the same leftover balance and jointly overspend it. The caller is expected to
// have already capped each item's amount to what the expense can actually cover
// (the bulk-pay bar allocates it client-side) — this still stops at the first
// failure rather than continuing, since that means the assumption no longer holds.
export async function bulkPayPayslipsFromExpense(formData: FormData) {
  try {
    const supabase = await createClient();
    const employeeData = await getCurrentEmployee(supabase);
    if (!(await hasSalaryAccess(supabase, employeeData))) {
      return { error: 'غير مصرح: هذه العملية تتطلب صلاحية الرواتب' };
    }

    let itemsRaw: unknown;
    try {
      itemsRaw = JSON.parse((formData.get('items') as string) || '[]');
    } catch {
      return { error: 'بيانات الدفع الجماعي غير صالحة' };
    }

    const parsed = bulkPayExpenseSchema.safeParse({
      funding_employee_id: formData.get('funding_employee_id'),
      expense_id: formData.get('expense_id'),
      payment_date: formData.get('payment_date'),
      memo: formData.get('memo') || undefined,
      items: itemsRaw,
    });
    if (!parsed.success) {
      return { error: 'بيانات الدفع الجماعي غير صالحة: ' + parsed.error.issues.map(e => e.path.join('.') + ': ' + e.message).join(' | ') };
    }

    const { funding_employee_id, expense_id, payment_date, memo, items } = parsed.data;
    const run_id = formData.get('run_id') as string | null;

    const results: { payslip_id: string; error?: string }[] = [];
    for (const item of items) {
      const { error } = await supabase.rpc('pay_payslip_from_expense', {
        p_payslip_id: item.payslip_id,
        p_funding_employee_id: funding_employee_id,
        p_expense_id: expense_id,
        p_amount: item.amount,
        p_date: payment_date,
        p_memo: memo || null,
      });
      results.push({ payslip_id: item.payslip_id, error: error?.message });
      if (error) break;
    }

    const failed = results.filter(r => r.error);
    const paidCount = results.length - failed.length;

    if (paidCount > 0) {
      await logAudit({
        employee_id: employeeData!.id,
        action: 'update',
        entity_type: 'payslip_payment_bulk',
        entity_id: run_id || expense_id,
        after: { expense_id, funding_employee_id, payment_date, paid_count: paidCount, failed_count: failed.length },
      });
    }

    revalidatePath('/salary/runs');
    if (run_id) revalidatePath(`/salary/runs/${run_id}`);

    if (paidCount === 0) {
      return { error: 'فشل الدفع لجميع القسائم المحددة: ' + (failed[0]?.error || '') };
    }
    if (paidCount < items.length) {
      return {
        success: true,
        error: `تم الدفع لـ ${paidCount} من ${items.length}. ${failed[0]?.error ? 'السبب: ' + failed[0].error : ''}`,
      };
    }
    return { success: true };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ غير متوقع' };
  }
}

const payslipComponentSchema = z.object({
  payslip_id: z.string().uuid(),
  component_type: z.enum(['allowance', 'deduction', 'bonus', 'overtime']),
  label: z.string().min(1, 'الوصف مطلوب'),
  amount: z.coerce.number().positive(),
  notes: z.string().optional(),
});

export async function addPayslipComponent(formData: FormData) {
  try {
    const supabase = await createClient();
    const employeeData = await getCurrentEmployee(supabase);
    if (!(await hasSalaryAccess(supabase, employeeData))) {
      return { error: 'غير مصرح: هذه العملية تتطلب صلاحية الرواتب' };
    }

    const parsed = payslipComponentSchema.safeParse({
      payslip_id: formData.get('payslip_id'),
      component_type: formData.get('component_type'),
      label: formData.get('label'),
      amount: formData.get('amount'),
      notes: formData.get('notes') || undefined,
    });
    if (!parsed.success) {
      return { error: 'بيانات غير صالحة: ' + parsed.error.issues.map(e => e.message).join(' | ') };
    }

    const { data: payslip } = await supabase.from('payslips').select('status, payroll_run_id').eq('id', parsed.data.payslip_id).single();
    if (!payslip) return { error: 'قسيمة الراتب غير موجودة' };
    if (payslip.status !== 'draft') return { error: 'لا يمكن تعديل قسيمة راتب بعد اعتمادها' };

    const { data, error } = await supabase.from('payslip_components').insert(parsed.data).select('id').single();
    if (error) return { error: error.message };

    await logAudit({
      employee_id: employeeData!.id,
      action: 'create',
      entity_type: 'payslip_component',
      entity_id: data.id,
      after: parsed.data,
    });

    revalidatePath(`/salary/runs/${payslip.payroll_run_id}`);
    return { success: true, id: data.id };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ غير متوقع' };
  }
}

export async function removePayslipComponent(formData: FormData) {
  try {
    const supabase = await createClient();
    const employeeData = await getCurrentEmployee(supabase);
    if (!(await hasSalaryAccess(supabase, employeeData))) {
      return { error: 'غير مصرح: هذه العملية تتطلب صلاحية الرواتب' };
    }

    const id = formData.get('id') as string;
    if (!id) return { error: 'العنصر غير محدد' };

    const { data: component } = await supabase.from('payslip_components').select('payslip_id, payslips(status, payroll_run_id)').eq('id', id).single();
    if (!component) return { error: 'العنصر غير موجود' };
    const payslip = component.payslips as any;
    if (payslip?.status !== 'draft') return { error: 'لا يمكن تعديل قسيمة راتب بعد اعتمادها' };

    const { error } = await supabase.from('payslip_components').delete().eq('id', id);
    if (error) return { error: error.message };

    await logAudit({
      employee_id: employeeData!.id,
      action: 'delete',
      entity_type: 'payslip_component',
      entity_id: id,
    });

    revalidatePath(`/salary/runs/${payslip?.payroll_run_id}`);
    return { success: true };
  } catch (e: any) {
    return { error: e.message || 'حدث خطأ غير متوقع' };
  }
}
