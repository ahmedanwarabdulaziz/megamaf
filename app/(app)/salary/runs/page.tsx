import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requirePageAccess } from '@/lib/require-page-access';
import { payrollRunStatusLabel } from '@/lib/salary-financials';
import { GenerateRunModal } from '@/components/salary/generate-run-modal';
import { DeletePayrollRunButton } from '@/components/salary/delete-payroll-run-button';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'دورات الرواتب' };

const MONTH_NAMES = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

const STATUS_BADGE: Record<string, string> = {
  draft: 'bg-secondary text-secondary-foreground',
  approved: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200',
  paid: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200',
};

export default async function PayrollRunsPage() {
  await requirePageAccess('salary');
  const supabase = await createClient();

  const { data: runs } = await supabase
    .from('payroll_runs')
    .select('*, payslips(id, employee_id, net_amount, loan_deduction_total, status)')
    .order('period_year', { ascending: false })
    .order('period_month', { ascending: false });

  // Draft runs haven't had approve_payroll_run deduct loan installments yet
  // (loan_deduction_total is still 0), so — same as the run detail page —
  // estimate what's due from active loans as of each run's period end.
  const draftRuns = (runs || []).filter((r: any) => r.status === 'draft');
  const draftEmployeeIds = Array.from(new Set(draftRuns.flatMap((r: any) => (r.payslips || []).map((p: any) => p.employee_id))));

  const estimatedLoanByRunAndEmployee = new Map<string, number>();
  if (draftEmployeeIds.length > 0) {
    const { data: activeLoans } = await supabase
      .from('employee_loans')
      .select('id, employee_id')
      .eq('status', 'active')
      .in('employee_id', draftEmployeeIds);
    const loanIds = (activeLoans || []).map((l: any) => l.id);
    const loanEmployeeMap = new Map((activeLoans || []).map((l: any) => [l.id, l.employee_id]));

    if (loanIds.length > 0) {
      const { data: installments } = await supabase
        .from('loan_installments')
        .select('loan_id, scheduled_amount, paid_amount, due_date')
        .eq('status', 'pending')
        .in('loan_id', loanIds);

      for (const run of draftRuns) {
        const periodEnd = new Date(Date.UTC(run.period_year, run.period_month, 0)).toISOString().split('T')[0];
        for (const inst of installments || []) {
          if (inst.due_date > periodEnd) continue;
          const empId = loanEmployeeMap.get(inst.loan_id);
          if (!empId) continue;
          const remaining = Number(inst.scheduled_amount) - Number(inst.paid_amount || 0);
          const key = `${run.id}:${empId}`;
          estimatedLoanByRunAndEmployee.set(key, (estimatedLoanByRunAndEmployee.get(key) || 0) + remaining);
        }
      }
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">دورات الرواتب</h1>
        <GenerateRunModal />
      </div>

      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="p-3 font-medium">الفترة</th>
                <th className="p-3 font-medium">عدد الموظفين</th>
                <th className="p-3 font-medium">الإجمالي قبل السلف</th>
                <th className="p-3 font-medium">السلف</th>
                <th className="p-3 font-medium">الإجمالي بعد السلف</th>
                <th className="p-3 font-medium">الحالة</th>
                <th className="p-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(runs || []).length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">لا توجد دورات رواتب</td>
                </tr>
              ) : (
                (runs || []).map((run: any) => {
                  const payslips = run.payslips || [];
                  const isDraft = run.status === 'draft';
                  const netSum = payslips.reduce((sum: number, p: any) => sum + Number(p.net_amount || 0), 0);
                  // While draft, net_amount hasn't had loans deducted yet (loan_deduction_total
                  // is still 0), so netSum IS "before loans" and loans is an estimate of what's
                  // due. Once approved/paid, net_amount already reflects the actual deduction,
                  // so netSum IS "after loans" and "before loans" adds the deduction back.
                  const loans = isDraft
                    ? payslips.reduce((sum: number, p: any) => sum + (estimatedLoanByRunAndEmployee.get(`${run.id}:${p.employee_id}`) || 0), 0)
                    : payslips.reduce((sum: number, p: any) => sum + Number(p.loan_deduction_total || 0), 0);
                  const beforeLoans = isDraft ? netSum : netSum + loans;
                  const afterLoans = isDraft ? netSum - loans : netSum;
                  return (
                    <tr key={run.id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-3">
                        <Link href={`/salary/runs/${run.id}`} className="font-bold hover:text-primary hover:underline">
                          {MONTH_NAMES[run.period_month - 1]} {run.period_year}
                        </Link>
                      </td>
                      <td className="p-3">{payslips.length}</td>
                      <td className="p-3 font-medium">{beforeLoans.toFixed(2)}</td>
                      <td className="p-3 text-destructive">
                        {loans > 0 ? `-${loans.toFixed(2)}` : '-'}
                        {isDraft && loans > 0 && <div className="text-[10px] text-amber-600 font-normal">متوقع</div>}
                      </td>
                      <td className="p-3 font-medium">{afterLoans.toFixed(2)}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[run.status]}`}>
                          {payrollRunStatusLabel(run.status)}
                        </span>
                      </td>
                      <td className="p-3">
                        {isDraft && (
                          <DeletePayrollRunButton runId={run.id} label={`${MONTH_NAMES[run.period_month - 1]} ${run.period_year}`} />
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
    </div>
  );
}
