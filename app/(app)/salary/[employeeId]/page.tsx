import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requirePageAccess } from '@/lib/require-page-access';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/money';
import { computeLoanFinancials, loanRemainingColorClass, loanRemainingLabel, loanStatusLabel } from '@/lib/salary-financials';
import { getEmployeeLoanSummary } from '@/lib/actions/loans';
import { DisburseLoanModal } from '@/components/salary/disburse-loan-modal';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'تفاصيل الراتب' };

export default async function EmployeeSalaryPage({ params }: { params: Promise<{ employeeId: string }> }) {
  await requirePageAccess('salary');
  const { employeeId } = await params;
  const supabase = await createClient();

  const [{ data: employee }, { data: salaries }, { data: bankAccounts }, { data: employees }, loanSummary, { data: earliestOpenLoanDate }] = await Promise.all([
    supabase.from('employees').select('id, full_name, employment_type').eq('id', employeeId).single(),
    supabase
      .from('employee_salaries')
      .select('*')
      .eq('employee_id', employeeId)
      .order('effective_from', { ascending: false }),
    supabase.from('v_bank_account_balances').select('*').order('account_name'),
    supabase.from('employees').select('id, full_name').eq('is_active', true).order('full_name'),
    getEmployeeLoanSummary(employeeId),
    supabase.rpc('get_earliest_open_payroll_date'),
  ]);

  if (!employee) notFound();

  const currentSalary = (salaries || []).find((s: any) => !s.effective_to);
  const history = (salaries || []).filter((s: any) => s.effective_to);
  const loans = 'data' in loanSummary ? loanSummary.data || [] : [];

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            {employee.full_name}
            {employee.employment_type === 'payroll_only' && (
              <span className="text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200 px-2 py-1 rounded-full">رواتب فقط</span>
            )}
          </h1>
        </div>
        <Link href={`/salary/create?employee_id=${employee.id}`}>
          <Button variant="outline">{currentSalary ? 'تحديث الراتب' : 'تحديد الراتب'}</Button>
        </Link>
      </div>

      <div className="bg-card p-4 rounded-lg border shadow-sm space-y-3">
        <h3 className="font-bold border-b pb-2">الراتب الحالي</h3>
        {currentSalary ? (
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">ساري من:</span>
              <span className="font-medium">{new Date(currentSalary.effective_from).toLocaleDateString('en-GB', { timeZone: 'UTC' })}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">الراتب الأساسي:</span>
              <span className="font-bold text-primary">{formatMoney(currentSalary.base_amount)}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              توزيع تكلفة الراتب على المشاريع يتحدد شهرياً عند إنشاء كل{' '}
              <Link href="/salary/runs" className="text-primary hover:underline">دورة رواتب</Link> — راجع قسيمة هذا الموظف في الدورة الحالية لتعديله.
            </p>
          </div>
        ) : (
          <p className="text-muted-foreground text-sm">لم يتم تحديد راتب لهذا الموظف بعد</p>
        )}
      </div>

      {history.length > 0 && (
        <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
          <div className="p-4 border-b bg-muted/30"><h3 className="font-bold">سجل الرواتب السابقة</h3></div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="p-3 font-medium">من</th>
                  <th className="p-3 font-medium">إلى</th>
                  <th className="p-3 font-medium">الراتب الأساسي</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {history.map((s: any) => (
                  <tr key={s.id}>
                    <td className="p-3">{new Date(s.effective_from).toLocaleDateString('en-GB', { timeZone: 'UTC' })}</td>
                    <td className="p-3">{new Date(s.effective_to).toLocaleDateString('en-GB', { timeZone: 'UTC' })}</td>
                    <td className="p-3 font-medium">{formatMoney(s.base_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <div className="p-4 border-b bg-muted/30 flex justify-between items-center">
          <h3 className="font-bold">السلف</h3>
          <DisburseLoanModal employeeId={employee.id} bankAccounts={bankAccounts || []} employees={employees || []} minLoanDate={earliestOpenLoanDate || null} />
        </div>
        {loans.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">لا توجد سلف</p>
        ) : (
          <div className="divide-y divide-border">
            {loans.map((l: any) => {
              const fin = computeLoanFinancials({ principalAmount: Number(l.loan.principal_amount), totalRepaid: l.totalRepaid });
              return (
                <Link key={l.loan.id} href={`/salary/loans/${l.loan.id}`} className="flex justify-between items-center p-3 hover:bg-muted/30 transition-colors">
                  <div>
                    <div className="font-medium">{formatMoney(l.loan.principal_amount)}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {new Date(l.loan.disbursed_date).toLocaleDateString('en-GB', { timeZone: 'UTC' })} — {loanStatusLabel(l.loan.status)}
                    </div>
                    <div className="text-[11px] text-muted-foreground/80 mt-1">
                      المصدر: {l.loan.funding_source === 'bank' 
                        ? (bankAccounts?.find((b: any) => b.bank_account_id === l.loan.bank_account_id)?.account_name || 'خزينة / بنك')
                        : `عهدة ${(employees?.find((e: any) => e.id === l.loan.funding_employee_id)?.full_name || 'موظف')}`}
                    </div>
                  </div>
                  <div className="text-left">
                    <div className={`font-bold ${loanRemainingColorClass(fin.remaining)}`}>{formatMoney(fin.remaining)}</div>
                    <div className="text-xs text-muted-foreground">{loanRemainingLabel(fin.remaining)}</div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
