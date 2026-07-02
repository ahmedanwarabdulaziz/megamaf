import { createClient } from '@/lib/supabase/server';
import { EmployeeDataTable } from './_components/data-table';
import { EmployeeModal } from '@/components/employees/EmployeeModal';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Plus } from 'lucide-react';
import { requirePageAccess } from '@/lib/require-page-access';

export const dynamic = 'force-dynamic';

export default async function EmployeesPage() {
  await requirePageAccess('employees');
  const supabase = await createClient();

  // Both queries are independent — run in parallel
  const [{ data: employees }, { data: projects }] = await Promise.all([
    supabase
      .from('employees')
      .select('id, full_name, username, role, is_active, is_super_admin, can_approve')
      .order('created_at', { ascending: false }),
    supabase
      .from('projects')
      .select('id, name, is_main')
      .order('sort_order'),
  ]);

  return (
    <div className="space-y-4 p-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">الموظفين</h1>
        <Link href="?modal=add-employee" scroll={false}>
          <Button><Plus className="ml-2 h-4 w-4" /> إضافة موظف</Button>
        </Link>
      </div>
      <EmployeeDataTable data={employees || []} />
      
      <EmployeeModal projects={projects || []} />
    </div>
  );
}
