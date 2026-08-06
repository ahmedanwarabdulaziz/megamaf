import { getAllExpenses, getExpenseCategories } from '@/lib/queries/expenses';
import { getProjects } from '@/lib/queries/projects';
import { getProfile } from '@/lib/supabase/get-profile';
import { AllExpensesFilters } from '@/components/expenses/all-expenses-filters';
import { ExpenseApprovalsList } from '@/components/expenses/expense-approvals-list';
import { createClient } from '@/lib/supabase/server';

export const metadata = {
  title: 'اعتمادات المصروفات',
};

export default async function ExpenseApprovalsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string, employee_id?: string, project_id?: string, category_id?: string, start_date?: string, end_date?: string, show_all?: string }>;
}) {
  const { tab = 'pending', employee_id, project_id, category_id, start_date, end_date, show_all } = await searchParams;
  const { profile: employee } = await getProfile();
  if (!employee?.can_approve && !employee?.is_super_admin) {
    return <div className="p-8 text-center text-red-500">غير مصرح لك بدخول هذه الصفحة</div>;
  }

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
  const defaultStart = `${year}-${month}-01`;
  const defaultEnd = `${year}-${month}-${lastDay}`;

  const startDate = start_date || defaultStart;
  const endDate = end_date || defaultEnd;
  // Default to showing all dates when the page loads with no filters at
  // all. Once the user explicitly picks a date range (or checks "show all"),
  // that choice is respected via the query params.
  const isShowAll = show_all === 'true' || (show_all === undefined && !start_date && !end_date);

  const [categories, projects] = await Promise.all([
    getExpenseCategories(),
    getProjects(),
  ]);

  const supabase = await createClient();
  const { data: allEmployeesData } = await supabase.from('employees').select('id, full_name').eq('is_active', true).order('full_name');

  // Load data based on tab
  let expenses: any[] = [];
  
  expenses = await getAllExpenses({
    employeeId: employee_id,
    projectId: project_id,
    categoryId: category_id,
    startDate: isShowAll ? undefined : startDate,
    endDate: isShowAll ? undefined : endDate,
    status: tab === 'approved' ? 'approved' : 'pending'
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">اعتمادات المصروفات</h1>
        {tab === 'pending' && expenses.length > 0 && (
          <span className="text-sm bg-yellow-500/10 text-yellow-600 px-3 py-1 rounded-full font-medium">
            {expenses.length} بانتظار الاعتماد
          </span>
        )}
      </div>

      <div className="flex gap-1 border-b overflow-x-auto pb-1">
        <a
          href="?tab=pending"
          className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
            tab === 'pending'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          قيد المراجعة (غير معتمد)
        </a>
        <a
          href="?tab=approved"
          className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
            tab === 'approved'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          المعتمدة
        </a>
      </div>

      <AllExpensesFilters 
        employees={allEmployeesData || []}
        projects={projects || []}
        categories={categories || []}
        selectedEmployeeId={employee_id || ''}
        selectedProjectId={project_id || ''}
        selectedCategoryId={category_id || ''}
        startDate={startDate}
        endDate={endDate}
        showAll={isShowAll}
        basePath="/expenses/approvals"
        activeTab={tab}
      />

      <div>
        <ExpenseApprovalsList
          key={`${tab}-${employee_id || ''}-${project_id || ''}-${category_id || ''}-${startDate}-${endDate}-${isShowAll}`}
          expenses={expenses}
          tab={tab}
          categories={categories}
          projects={projects || []}
        />
      </div>
    </div>
  );
}
