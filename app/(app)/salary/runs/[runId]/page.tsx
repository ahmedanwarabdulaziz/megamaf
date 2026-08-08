import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requirePageAccess } from '@/lib/require-page-access';
import { formatMoney } from '@/lib/money';
import { payrollRunStatusLabel, payslipStatusLabel, computePayslipRemaining } from '@/lib/salary-financials';
import { ApproveRunButton } from '@/components/salary/approve-run-button';
import { PayPayslipModal } from '@/components/salary/pay-payslip-modal';
import { AddEmployeeToRunModal } from '@/components/salary/add-employee-to-run-modal';
import { PayslipDetailModal } from '@/components/salary/payslip-detail-modal';
import { RemovePayslipButton } from '@/components/salary/remove-payslip-button';
import { DeletePayrollRunButton } from '@/components/salary/delete-payroll-run-button';
import { BulkPayProvider } from '@/components/salary/bulk-pay-provider';
import { SelectPayslipCheckbox } from '@/components/salary/select-payslip-checkbox';
import { SelectAllCheckbox } from '@/components/salary/select-all-checkbox';
import { getProjects } from '@/lib/queries/projects';
import { AlertTriangle, FolderKanban } from 'lucide-react';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'تفاصيل دورة الرواتب' };

const MONTH_NAMES = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-secondary text-secondary-foreground',
  approved: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200',
  paid: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200',
};

export default async function PayrollRunDetailPage({ params }: { params: Promise<{ runId: string }> }) {
  await requirePageAccess('salary');
  const { runId } = await params;
  const supabase = await createClient();

  const [{ data: run }, { data: payslips }, { data: bankAccounts }, { data: employees }, { data: openSalaries, error: openSalariesError }, projects] = await Promise.all([
    supabase.from('payroll_runs').select('*').eq('id', runId).single(),
    supabase.from('payslips').select('*, employees(full_name)').eq('payroll_run_id', runId).order('created_at'),
    supabase.from('v_bank_account_balances').select('*').order('account_name'),
    supabase.from('employees').select('id, full_name').eq('is_active', true).order('full_name'),
    // Only employee_id is selected here (no embedded employees(...) join) —
    // employee_salaries has two FKs to employees (employee_id, created_by),
    // which makes an unqualified embed ambiguous and PostgREST rejects it.
    // Employee names are looked up from the `employees` list already fetched.
    supabase.from('employee_salaries').select('employee_id').is('effective_to', null),
    getProjects(),
  ]);
  if (openSalariesError) console.error('Failed to load salaried employees:', openSalariesError.message);

  if (!run) notFound();

  const payslipIds = (payslips || []).map((p: any) => p.id);
  const employeeIdsInRun = (payslips || []).map((p: any) => p.employee_id);

  const [{ data: paidRows }, { data: allComponents }, { data: allAllocations }, { data: activeLoans }] = await Promise.all([
    payslipIds.length > 0
      ? supabase.from('v_payslip_paid').select('payslip_id, paid_amount').in('payslip_id', payslipIds)
      : Promise.resolve({ data: [] as any[] }),
    payslipIds.length > 0
      ? supabase.from('payslip_components').select('*').in('payslip_id', payslipIds).order('created_at')
      : Promise.resolve({ data: [] as any[] }),
    payslipIds.length > 0
      ? supabase.from('payslip_project_allocations').select('*, projects(name)').in('payslip_id', payslipIds)
      : Promise.resolve({ data: [] as any[] }),
    employeeIdsInRun.length > 0
      ? supabase.from('employee_loans').select('id, employee_id').eq('status', 'active').in('employee_id', employeeIdsInRun)
      : Promise.resolve({ data: [] as any[] }),
  ]);

  const paidByPayslip = new Map((paidRows || []).map((r: any) => [r.payslip_id, Number(r.paid_amount || 0)]));
  const componentsByPayslip = new Map<string, any[]>();
  for (const c of allComponents || []) {
    if (!componentsByPayslip.has(c.payslip_id)) componentsByPayslip.set(c.payslip_id, []);
    componentsByPayslip.get(c.payslip_id)!.push(c);
  }
  const allocationsByPayslip = new Map<string, any[]>();
  for (const a of allAllocations || []) {
    if (!allocationsByPayslip.has(a.payslip_id)) allocationsByPayslip.set(a.payslip_id, []);
    allocationsByPayslip.get(a.payslip_id)!.push(a);
  }

  // Payslips with no project allocations need to be flagged
  const unallocatedPayslipIds = new Set(
    (payslips || []).filter((p: any) => !allocationsByPayslip.has(p.id)).map((p: any) => p.id)
  );
  const unallocatedCount = unallocatedPayslipIds.size;

  // Payslips whose loan installment couldn't be fully deducted this run
  // (net pay too low to cover it) — the shortfall rolls forward silently
  // to a future run unless flagged here.
  const shortfallPayslips = (payslips || []).filter((p: any) => Number(p.loan_shortfall_amount || 0) > 0.01);
  const shortfallCount = shortfallPayslips.length;

  // Loan deductions are only actually applied at approval time — while a run
  // is still draft this is an ESTIMATE (pending installments due this period)
  // so admins can see it will be deducted before they approve, not a promise
  // it already has been.
  const periodEnd = new Date(Date.UTC(run.period_year, run.period_month, 0)).toISOString().split('T')[0];
  const loanIds = (activeLoans || []).map((l: any) => l.id);
  const loanEmployeeMap = new Map((activeLoans || []).map((l: any) => [l.id, l.employee_id]));
  const { data: dueInstallments } = loanIds.length > 0
    ? await supabase.from('loan_installments').select('loan_id, scheduled_amount, paid_amount').eq('status', 'pending').in('loan_id', loanIds).lte('due_date', periodEnd)
    : { data: [] as any[] };
  const estimatedLoanByEmployee = new Map<string, number>();
  for (const inst of dueInstallments || []) {
    const empId = loanEmployeeMap.get(inst.loan_id);
    if (!empId) continue;
    const remaining = Number(inst.scheduled_amount) - Number(inst.paid_amount || 0);
    estimatedLoanByEmployee.set(empId, (estimatedLoanByEmployee.get(empId) || 0) + remaining);
  }

  const employeeIdSet = new Set(employeeIdsInRun);
  const salariedEmployeeIds = new Set((openSalaries || []).map((s: any) => s.employee_id));
  const availableEmployees = (employees || []).filter((e: any) => salariedEmployeeIds.has(e.id) && !employeeIdSet.has(e.id));

  const projectList = (projects || []).map((p: any) => ({ id: p.id, name: p.name }));

  // Same "approved with a remaining balance" gate the individual دفع button
  // uses — that's what a payslip needs to be selectable for a bulk payment.
  const eligiblePayslips = (payslips || [])
    .map((p: any) => {
      const paidSoFar = paidByPayslip.get(p.id) || 0;
      const remaining = computePayslipRemaining({ netAmount: Number(p.net_amount), paidAmount: paidSoFar });
      return { id: p.id, employeeName: p.employees?.full_name || '', remaining, status: p.status };
    })
    .filter((p: any) => p.status === 'approved' && p.remaining > 0.01)
    .map((p: any) => ({ id: p.id, employeeName: p.employeeName, remaining: p.remaining }));
  const eligiblePayslipIds = new Set(eligiblePayslips.map(p => p.id));

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            {MONTH_NAMES[run.period_month - 1]} {run.period_year}
            <span className={`text-xs font-semibold px-2 py-1 rounded-full ${STATUS_BADGE[run.status]}`}>{payrollRunStatusLabel(run.status)}</span>
          </h1>
        </div>
        {run.status === 'draft' && (
          <div className="flex items-center gap-2">
            <AddEmployeeToRunModal runId={run.id} employees={availableEmployees} />
            <ApproveRunButton runId={run.id} />
            <DeletePayrollRunButton
              runId={run.id}
              label={`${MONTH_NAMES[run.period_month - 1]} ${run.period_year}`}
              redirectTo="/salary/runs"
            />
          </div>
        )}
      </div>

      {/* Unallocated warning banner */}
      {unallocatedCount > 0 && (
        <div className="flex items-start gap-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-300 dark:border-amber-700 rounded-lg p-4">
          <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
              {unallocatedCount === 1
                ? 'موظف واحد لم يتم توزيع راتبه على المشاريع'
                : `${unallocatedCount} موظفين لم يتم توزيع رواتبهم على المشاريع`}
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
              الصفوف المميزة باللون الأصفر تحتاج إلى توزيع — افتح تفاصيل القسيمة لإضافة التوزيع.
            </p>
          </div>
        </div>
      )}

      {/* Loan deduction shortfall warning banner */}
      {shortfallCount > 0 && (
        <div className="flex items-start gap-3 bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-700 rounded-lg p-4">
          <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-800 dark:text-red-300">
              {shortfallCount === 1
                ? 'موظف واحد لم يُخصم قسط سلفته بالكامل هذه الدورة'
                : `${shortfallCount} موظفين لم يُخصم قسط سلفهم بالكامل هذه الدورة`}
            </p>
            <p className="text-xs text-red-700 dark:text-red-400 mt-0.5">
              الراتب الصافي لم يكن كافياً لتغطية القسط بالكامل — المتبقي سيُخصم تلقائياً في دورة رواتب قادمة.
            </p>
          </div>
        </div>
      )}

      <BulkPayProvider runId={run.id} eligiblePayslips={eligiblePayslips} bankAccounts={bankAccounts || []} employees={employees || []}>
      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="p-3 font-medium w-8">
                  <SelectAllCheckbox eligibleIds={eligiblePayslips.map(p => p.id)} />
                </th>
                <th className="p-3 font-medium">الموظف</th>
                <th className="p-3 font-medium">الأساسي</th>
                <th className="p-3 font-medium">المكافآت</th>
                <th className="p-3 font-medium">الإجمالي</th>
                <th className="p-3 font-medium">خصم السلف</th>
                <th className="p-3 font-medium">الصافي</th>
                <th className="p-3 font-medium">المدفوع</th>
                <th className="p-3 font-medium">المتبقي</th>
                <th className="p-3 font-medium">الحالة</th>
                <th className="p-3 font-medium">التوزيع</th>
                <th className="p-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(payslips || []).length === 0 ? (
                <tr>
                  <td colSpan={11} className="p-8 text-center text-muted-foreground">لا توجد قسائم رواتب</td>
                </tr>
              ) : (
                (payslips || []).map((p: any, i: number, arr: any[]) => {
                  const isDraft = p.status === 'draft';
                  const prevPayslipId = i > 0 ? arr[i - 1].id : undefined;
                  const nextPayslipId = i < arr.length - 1 ? arr[i + 1].id : undefined;
                  const estimatedLoanDeduction = estimatedLoanByEmployee.get(p.employee_id) || 0;
                  const loanDisplay = isDraft ? estimatedLoanDeduction : Number(p.loan_deduction_total);
                  // While draft, net_amount doesn't reflect loans yet (that's only
                  // computed at approval) — subtract the estimate here so "الصافي"
                  // agrees with the estimated loan deduction shown next to it.
                  const displayNet = isDraft ? Number(p.net_amount) - estimatedLoanDeduction : Number(p.net_amount);
                  const paidSoFar = paidByPayslip.get(p.id) || 0;
                  const remaining = computePayslipRemaining({ netAmount: displayNet, paidAmount: paidSoFar });

                  const isUnallocated = unallocatedPayslipIds.has(p.id);
                  const allocationCount = (allocationsByPayslip.get(p.id) || []).length;

                  return (
                    <tr key={p.id} className={`hover:bg-muted/30 transition-colors ${isUnallocated ? 'border-r-4 border-r-amber-400 bg-amber-50/30 dark:bg-amber-950/10' : ''}`}>
                      <td className="p-3">
                        <SelectPayslipCheckbox payslipId={p.id} eligible={eligiblePayslipIds.has(p.id)} />
                      </td>
                      <td className="p-3">
                        <PayslipDetailModal
                          payslip={{
                            id: p.id,
                            runId: run.id,
                            employeeName: p.employees?.full_name || '',
                            status: p.status,
                            base_amount: Number(p.base_amount),
                            allowances_total: Number(p.allowances_total),
                            bonus_total: Number(p.bonus_total),
                            deductions_total: Number(p.deductions_total),
                            loan_deduction_total: Number(p.loan_deduction_total),
                            gross_amount: Number(p.gross_amount),
                            net_amount: Number(p.net_amount),
                            estimatedLoanDeduction,
                          }}
                          components={componentsByPayslip.get(p.id) || []}
                          allocations={(allocationsByPayslip.get(p.id) || []).map((a: any) => ({
                            project_id: a.project_id,
                            allocation_type: a.allocation_type,
                            allocation_value: Number(a.allocation_value),
                            project_name: a.projects?.name,
                            allocated_amount: Number(a.allocated_amount),
                          }))}
                          projects={projectList}
                          prevPayslipId={prevPayslipId}
                          nextPayslipId={nextPayslipId}
                        />
                      </td>
                      <td className="p-3">{formatMoney(p.base_amount)}</td>
                      <td className="p-3 text-green-600">{Number(p.bonus_total) > 0 ? formatMoney(p.bonus_total) : '-'}</td>
                      <td className="p-3">{formatMoney(p.gross_amount)}</td>
                      <td className="p-3 text-destructive">
                        {loanDisplay > 0 ? `-${formatMoney(loanDisplay)}` : '-'}
                        {isDraft && estimatedLoanDeduction > 0 && (
                          <div className="text-[10px] text-amber-600 font-normal">متوقع عند الاعتماد</div>
                        )}
                        {!isDraft && Number(p.loan_shortfall_amount || 0) > 0.01 && (
                          <div className="text-[10px] text-red-600 font-semibold flex items-center gap-0.5">
                            <AlertTriangle className="w-2.5 h-2.5" />
                            متبقي {formatMoney(p.loan_shortfall_amount)} لم يُخصم
                          </div>
                        )}
                      </td>
                      <td className="p-3 font-bold text-primary">
                        {formatMoney(displayNet)}
                        {isDraft && estimatedLoanDeduction > 0 && (
                          <div className="text-[10px] text-amber-600 font-normal">متوقع عند الاعتماد</div>
                        )}
                      </td>
                      <td className="p-3 text-green-600">{paidSoFar > 0 ? formatMoney(paidSoFar) : '-'}</td>
                      <td className="p-3 font-medium">{remaining > 0.01 ? formatMoney(remaining) : '-'}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[p.status]}`}>{payslipStatusLabel(p.status)}</span>
                      </td>
                      <td className="p-3">
                        {isUnallocated ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 whitespace-nowrap">
                            <AlertTriangle className="w-3 h-3" />
                            غير موزع
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 whitespace-nowrap">
                            <FolderKanban className="w-3 h-3" />
                            {allocationCount} {allocationCount === 1 ? 'مشروع' : 'مشاريع'}
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        {p.status === 'approved' && remaining > 0.01 && (
                          <PayPayslipModal
                            payslipId={p.id}
                            runId={run.id}
                            employeeId={p.employee_id}
                            employeeName={p.employees?.full_name || ''}
                            remaining={remaining}
                            bankAccounts={bankAccounts || []}
                            employees={employees || []}
                          />
                        )}
                        {isDraft && (
                          <RemovePayslipButton payslipId={p.id} runId={run.id} employeeName={p.employees?.full_name || ''} />
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      </BulkPayProvider>
    </div>
  );
}
