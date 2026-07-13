import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requirePageAccess } from '@/lib/require-page-access';
import { payrollRunStatusLabel } from '@/lib/salary-financials';
import { GenerateRunModal } from '@/components/salary/generate-run-modal';

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
    .select('*, payslips(id, net_amount, status)')
    .order('period_year', { ascending: false })
    .order('period_month', { ascending: false });

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
                <th className="p-3 font-medium">إجمالي الصافي</th>
                <th className="p-3 font-medium">الحالة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(runs || []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-muted-foreground">لا توجد دورات رواتب</td>
                </tr>
              ) : (
                (runs || []).map((run: any) => {
                  const payslips = run.payslips || [];
                  const total = payslips.reduce((sum: number, p: any) => sum + Number(p.net_amount || 0), 0);
                  return (
                    <tr key={run.id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-3">
                        <Link href={`/salary/runs/${run.id}`} className="font-bold hover:text-primary hover:underline">
                          {MONTH_NAMES[run.period_month - 1]} {run.period_year}
                        </Link>
                      </td>
                      <td className="p-3">{payslips.length}</td>
                      <td className="p-3 font-medium">{total.toFixed(2)}</td>
                      <td className="p-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_BADGE[run.status]}`}>
                          {payrollRunStatusLabel(run.status)}
                        </span>
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
