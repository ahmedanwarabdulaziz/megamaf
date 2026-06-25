import { createClient } from '@/lib/supabase/server';
import { EmployeeCustodyReport } from '@/components/reports/employee-custody-report';
import { Users } from 'lucide-react';

export const metadata = { title: 'كشوف عهد الموظفين' };

export default async function EmployeeCustodyPage({
  searchParams,
}: {
  searchParams: Promise<{ employee_id?: string }>
}) {
  const { employee_id } = await searchParams;
  const supabase = await createClient();

  const { data: employees } = await supabase
    .from('employees')
    .select('id, full_name')
    .order('full_name');

  let statementData: any[] = [];
  let balance = 0;

  if (employee_id && employees) {
    const [
      { data: balanceData },
      { data: disbursements },
      { data: expenses },
    ] = await Promise.all([
      supabase.from('v_employee_custody_balance').select('*').eq('employee_id', employee_id).single(),
      supabase.from('ledger_entries')
        .select('id, entry_date, amount, memo')
        .eq('category', 'custody_disbursement')
        .eq('employee_id', employee_id)
        .order('entry_date', { ascending: false })
        .limit(200),
      supabase.from('expenses')
        .select('id, expense_date, amount, notes, status, settled_amount')
        .eq('employee_id', employee_id)
        .eq('status', 'approved')
        .order('expense_date', { ascending: false })
        .limit(200),
    ]);

    if (balanceData) {
      balance = balanceData.balance;
      statementData = [
        ...(disbursements || []).map(d => ({ type: 'disbursement', date: d.entry_date, amount: d.amount, notes: d.memo, id: d.id })),
        ...(expenses || []).map(e => ({ type: 'expense', date: e.expense_date, amount: e.amount, notes: e.notes, id: e.id, settled: e.settled_amount }))
      ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
  }


  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-4 bg-card p-6 rounded-lg border shadow-sm">
        <div className="p-3 bg-indigo-100 text-indigo-600 rounded-full">
          <Users className="w-8 h-8" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">كشوف عهد الموظفين</h1>
          <p className="text-muted-foreground mt-1">العهد المنصرفة للموظفين وتسوياتها</p>
        </div>
      </div>

      <EmployeeCustodyReport 
        employees={employees || []} 
        data={statementData} 
        selectedEmployeeId={employee_id || ''}
        balance={balance}
      />
    </div>
  );
}
