import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requirePageAccess } from '@/lib/require-page-access';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/money';
import { AddPayrollOnlyModal } from '@/components/salary/add-payroll-only-modal';
import { UpdateSalaryModal } from '@/components/salary/update-salary-modal';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'الرواتب' };

export default async function SalaryPage() {
  await requirePageAccess('salary');
  const supabase = await createClient();

  const [{ data: employees }, { data: openSalaries }] = await Promise.all([
    supabase.from('employees').select('id, full_name, employment_type, is_active').eq('is_active', true).order('full_name'),
    supabase.from('employee_salaries').select('*').is('effective_to', null),
  ]);

  const salaryByEmployee = new Map((openSalaries || []).map((s: any) => [s.employee_id, s]));

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center flex-wrap gap-3">
        <h1 className="text-2xl font-bold">الرواتب</h1>
        <div className="flex items-center gap-2">
          <Link href="/salary/runs">
            <Button variant="outline">دورات الرواتب</Button>
          </Link>
          <AddPayrollOnlyModal />
          <Link href="/salary/create">
            <Button>تحديد راتب</Button>
          </Link>
        </div>
      </div>

      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="p-3 font-medium">الموظف</th>
                <th className="p-3 font-medium">النوع</th>
                <th className="p-3 font-medium">الراتب الأساسي</th>
                <th className="p-3 font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {(employees || []).length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-8 text-center text-muted-foreground">لا يوجد موظفون</td>
                </tr>
              ) : (
                (employees || []).map((emp: any) => {
                  const salary = salaryByEmployee.get(emp.id);
                  return (
                    <tr key={emp.id} className="hover:bg-muted/30 transition-colors">
                      <td className="p-3">
                        <Link href={`/salary/${emp.id}`} className="font-bold hover:text-primary hover:underline">{emp.full_name}</Link>
                      </td>
                      <td className="p-3">
                        {emp.employment_type === 'payroll_only' ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200">رواتب فقط</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-secondary text-secondary-foreground">مستخدم نظام</span>
                        )}
                      </td>
                      <td className="p-3 font-semibold whitespace-nowrap">{salary ? formatMoney(salary.base_amount) : '—'}</td>
                      <td className="p-3 text-left">
                        <UpdateSalaryModal
                          employeeId={emp.id}
                          employeeName={emp.full_name}
                          currentAmount={salary ? Number(salary.base_amount) : null}
                          hasExisting={!!salary}
                        />
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
