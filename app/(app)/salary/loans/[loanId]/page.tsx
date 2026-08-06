import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requirePageAccess } from '@/lib/require-page-access';
import { formatMoney } from '@/lib/money';
import { computeLoanFinancials, loanRemainingColorClass, loanRemainingLabel, loanStatusLabel } from '@/lib/salary-financials';
import { CancelLoanButton } from '@/components/salary/cancel-loan-button';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'تفاصيل السلفة' };

const REPAYMENT_TYPE_LABELS: Record<string, string> = {
  next_salary_full: 'خصم كامل من الراتب القادم',
  equal_installments: 'أقساط شهرية متساوية',
  custom_schedule: 'جدول سداد مخصص',
};

const INSTALLMENT_STATUS_BADGE: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200',
  paid: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200',
  skipped: 'bg-secondary text-secondary-foreground',
};

const INSTALLMENT_STATUS_LABELS: Record<string, string> = {
  pending: 'مستحق',
  paid: 'مسدد',
  skipped: 'ملغى',
};

export default async function LoanDetailPage({ params }: { params: Promise<{ loanId: string }> }) {
  await requirePageAccess('salary');
  const { loanId } = await params;
  const supabase = await createClient();

  const [{ data: loan }, { data: installments }, { data: repayments }] = await Promise.all([
    supabase.from('employee_loans').select('*').eq('id', loanId).single(),
    supabase.from('loan_installments').select('*').eq('loan_id', loanId).order('due_date'),
    supabase.from('loan_repayments').select('*').eq('loan_id', loanId).order('repayment_date', { ascending: false }),
  ]);

  if (!loan) notFound();

  const { data: employee } = await supabase.from('employees').select('id, full_name').eq('id', loan.employee_id).single();
  loan.employees = employee;

  const { data: bankAccount } = loan.bank_account_id ? await supabase.from('bank_accounts').select('account_name').eq('id', loan.bank_account_id).single() : { data: null };
  const { data: fundingEmployee } = loan.funding_employee_id ? await supabase.from('employees').select('full_name').eq('id', loan.funding_employee_id).single() : { data: null };

  const totalRepaid = (installments || []).reduce((sum: number, i: any) => sum + Number(i.paid_amount || 0), 0);
  const fin = computeLoanFinancials({ principalAmount: Number(loan.principal_amount), totalRepaid });
  const canCancel = loan.status === 'active' && (repayments || []).length === 0;

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <Link href={`/salary/${loan.employees?.id}`} className="text-sm text-muted-foreground hover:underline">← رجوع لصفحة الموظف</Link>
        <div className="flex justify-between items-center mt-1 flex-wrap gap-3">
          <h1 className="text-2xl font-bold">{loan.employees?.full_name}</h1>
          {canCancel && <CancelLoanButton loanId={loan.id} employeeId={loan.employees?.id} />}
        </div>
      </div>

      {loan.status === 'pending' && (
        <div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-300 text-amber-700 dark:text-amber-300 text-sm p-3 rounded-lg">
          هذه السلفة بانتظار اعتماد المصروف الممول من عهدة الموظف —{' '}
          <Link href="/expenses/approvals" className="underline font-medium">راجع صفحة اعتمادات المصروفات</Link>.
        </div>
      )}

      <div className="bg-card p-4 rounded-lg border shadow-sm space-y-2 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">المبلغ الأصلي:</span><span className="font-bold text-primary">{formatMoney(loan.principal_amount)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">تاريخ الصرف:</span><span className="font-medium">{new Date(loan.disbursed_date).toLocaleDateString('en-GB', { timeZone: 'UTC' })}</span></div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">المصدر:</span>
          <span className="font-medium">
            {loan.funding_source === 'bank' 
              ? (bankAccount?.account_name || 'خزينة / بنك') 
              : `عهدة ${fundingEmployee?.full_name || 'موظف'}`}
          </span>
        </div>
        <div className="flex justify-between"><span className="text-muted-foreground">طريقة السداد:</span><span className="font-medium">{REPAYMENT_TYPE_LABELS[loan.repayment_type]}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">الحالة:</span><span className="font-medium">{loanStatusLabel(loan.status)}</span></div>
        <div className="flex justify-between border-t pt-2">
          <span className="font-bold">المتبقي:</span>
          <span className={`font-bold ${loanRemainingColorClass(fin.remaining)}`}>{formatMoney(fin.remaining)} — {loanRemainingLabel(fin.remaining)}</span>
        </div>
      </div>

      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <div className="p-4 border-b bg-muted/30"><h3 className="font-bold">جدول الأقساط</h3></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="p-3 font-medium">تاريخ الاستحقاق</th>
                <th className="p-3 font-medium">المبلغ المستحق</th>
                <th className="p-3 font-medium">المدفوع</th>
                <th className="p-3 font-medium">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(installments || []).map((i: any) => (
                <tr key={i.id}>
                  <td className="p-3">{new Date(i.due_date).toLocaleDateString('en-GB', { timeZone: 'UTC' })}</td>
                  <td className="p-3 font-medium">{formatMoney(i.scheduled_amount)}</td>
                  <td className="p-3 text-green-600">{formatMoney(i.paid_amount)}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${INSTALLMENT_STATUS_BADGE[i.status]}`}>{INSTALLMENT_STATUS_LABELS[i.status]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {(repayments || []).length > 0 && (
        <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
          <div className="p-4 border-b bg-muted/30"><h3 className="font-bold">سجل السداد</h3></div>
          <div className="divide-y divide-border">
            {(repayments || []).map((r: any) => (
              <div key={r.id} className="flex justify-between p-3 text-sm">
                <span>{new Date(r.repayment_date).toLocaleDateString('en-GB', { timeZone: 'UTC' })}</span>
                <span className="font-medium text-green-600">{formatMoney(r.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
