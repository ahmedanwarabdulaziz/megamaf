import { createClient } from '@/lib/supabase/server';
import { EmployeeDataTable } from './_components/data-table';
import { EmployeeModal } from '@/components/employees/EmployeeModal';
import { Button } from '@/components/ui/button';
import Link from 'next/link';
import { Plus } from 'lucide-react';

export default async function EmployeesPage() {
  const supabase = await createClient();
  const { data: employees } = await supabase.from('employees').select('*').order('created_at', { ascending: false });

  return (
    <div className="space-y-4 p-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">الموظفين</h1>
        <Link href="?modal=add-employee" scroll={false}>
          <Button><Plus className="ml-2 h-4 w-4" /> إضافة موظف</Button>
        </Link>
      </div>
      <EmployeeDataTable data={employees || []} />
      
      <EmployeeModal />
    </div>
  );
}
