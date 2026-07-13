import { createClient } from '@/lib/supabase/server';
import { requirePageAccess } from '@/lib/require-page-access';
import { SalaryForm } from '@/components/salary/salary-form';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'تحديد راتب' };

export default async function CreateSalaryPage({
  searchParams,
}: {
  searchParams: Promise<{ employee_id?: string }>;
}) {
  await requirePageAccess('salary');
  const { employee_id } = await searchParams;
  const supabase = await createClient();

  const [{ data: employees }, fixedEmployee] = await Promise.all([
    employee_id ? Promise.resolve({ data: null }) : supabase.from('employees').select('id, full_name, employment_type').eq('is_active', true).order('full_name'),
    employee_id
      ? supabase.from('employees').select('id, full_name').eq('id', employee_id).single().then(r => r.data)
      : Promise.resolve(null),
  ]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">{fixedEmployee ? `تحديد راتب — ${fixedEmployee.full_name}` : 'تحديد راتب'}</h1>
      <SalaryForm
        employees={employees || []}
        fixedEmployeeId={fixedEmployee?.id}
        fixedEmployeeName={fixedEmployee?.full_name}
      />
    </div>
  );
}
