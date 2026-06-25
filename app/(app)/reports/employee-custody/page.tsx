import { createClient } from '@/lib/supabase/server';
import { EmployeeCustodyReport } from '@/components/reports/employee-custody-report';
import { Users, ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export const metadata = { title: 'كشوف عهد الموظفين' };

export default async function EmployeeCustodyPage({
  searchParams,
}: {
  searchParams: Promise<{ employee_id?: string, project_id?: string, category_id?: string, start_date?: string, end_date?: string }>
}) {
  const { employee_id, project_id, category_id, start_date, end_date } = await searchParams;
  const supabase = await createClient();

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
  
  const defaultStart = `${year}-${month}-01`;
  const defaultEnd = `${year}-${month}-${lastDay}`;

  const startDate = start_date || defaultStart;
  const endDate = end_date || defaultEnd;

  const [
    { data: employees },
    { data: projects },
    { data: categories }
  ] = await Promise.all([
    supabase.from('employees').select('id, full_name').order('full_name'),
    supabase.from('projects').select('id, name').order('name'),
    supabase.from('expense_categories').select('id, name').order('name')
  ]);

  let statementData: any[] = [];
  let balance = 0;

  if (employee_id && employees) {
    const { data: balanceData } = await supabase.from('v_employee_custody_balance').select('*').eq('employee_id', employee_id).single();
    
    // For disbursements, there is no "category_id" of expenses, so if they filter by an expense category, 
    // we should NOT return any disbursements.
    let disburseQuery = supabase.from('ledger_entries')
      .select('id, entry_date, amount, memo, projects(name)')
      .eq('category', 'custody_disbursement')
      .eq('employee_id', employee_id)
      .gte('entry_date', startDate)
      .lte('entry_date', endDate);
      
    if (project_id) disburseQuery = disburseQuery.eq('project_id', project_id);
    
    let expenseQuery = supabase.from('expenses')
      .select('id, expense_date, amount, notes, status, settled_amount, projects(name), expense_categories(name)')
      .eq('employee_id', employee_id)
      .eq('status', 'approved')
      .gte('expense_date', startDate)
      .lte('expense_date', endDate);
      
    if (project_id) expenseQuery = expenseQuery.eq('project_id', project_id);
    if (category_id) expenseQuery = expenseQuery.eq('category_id', category_id);

    const [
      { data: disbursements },
      { data: expenses },
    ] = await Promise.all([
      category_id ? Promise.resolve({ data: [] }) : disburseQuery, // Skip disbursements if filtering by expense category
      expenseQuery
    ]);

    if (balanceData) {
      balance = balanceData.balance;
    }
    
    statementData = [
      ...(disbursements || []).map(d => ({ 
        type: 'disbursement', 
        date: d.entry_date, 
        amount: d.amount, 
        notes: d.memo, 
        project: (d.projects as any)?.name,
        category: 'تمويل عهدة',
        id: d.id 
      })),
      ...(expenses || []).map(e => ({ 
        type: 'expense', 
        date: e.expense_date, 
        amount: e.amount, 
        notes: e.notes, 
        project: (e.projects as any)?.name,
        category: (e.expense_categories as any)?.name,
        id: e.id, 
        settled: e.settled_amount 
      }))
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }


  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card p-6 rounded-lg border shadow-sm">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-indigo-100 text-indigo-600 rounded-full">
            <Users className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">كشوف عهد الموظفين</h1>
            <p className="text-muted-foreground mt-1">العهد المنصرفة للموظفين وتسوياتها</p>
          </div>
        </div>
        <Link href="/treasury?tab=emp_custodies">
          <Button variant="outline"><ArrowRight className="w-4 h-4 ml-2" /> العودة للخزينة</Button>
        </Link>
      </div>

      <EmployeeCustodyReport 
        employees={employees || []} 
        projects={projects || []}
        categories={categories || []}
        data={statementData} 
        selectedEmployeeId={employee_id || ''}
        selectedProjectId={project_id || ''}
        selectedCategoryId={category_id || ''}
        startDate={startDate}
        endDate={endDate}
        balance={balance}
      />
    </div>
  );
}
