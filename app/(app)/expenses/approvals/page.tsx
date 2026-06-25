import { getAllExpenses, getExpenseCategories } from '@/lib/queries/expenses';
import { getProjects } from '@/lib/queries/projects';
import { getProfile } from '@/lib/supabase/get-profile';
import { formatMoney } from '@/lib/money';
import { ApproveRejectButtons } from '@/components/expenses/approve-reject-buttons';
import { AllExpensesFilters } from '@/components/expenses/all-expenses-filters';
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
  const isShowAll = show_all === 'true';

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

      <div className="bg-card rounded-lg border shadow-sm divide-y">
        {expenses.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">لا توجد مصروفات</div>
        ) : (
          expenses.map(expense => {
            const isOwnerExpense = !expense.employee_id && expense.owner_id;
            const partyName = isOwnerExpense
              ? expense.owner?.name
              : expense.employee?.full_name;

            return (
              <div key={expense.id} className="p-4 flex flex-col sm:flex-row justify-between sm:items-center gap-4 hover:bg-muted/30 transition-colors">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    {isOwnerExpense && (
                      <span className="text-[10px] font-medium bg-orange-500/10 text-orange-600 px-2 py-0.5 rounded-full">
                        مالك
                      </span>
                    )}
                    <p className="font-bold">{partyName}</p>
                  </div>
                  <p className="text-sm">{expense.project?.name} - {expense.category?.name}</p>
                  <p className="text-sm text-muted-foreground">{expense.notes}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <span>التاريخ: {expense.expense_date}</span>
                    {expense.attachments && expense.attachments.length > 0 && (
                      <span className="text-primary font-medium">مرفق</span>
                    )}
                    {tab === 'approved' && expense.status === 'approved' && (
                      <>
                        <span>•</span>
                        <span className="text-green-600">معتمد</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-xl font-bold whitespace-nowrap">
                    {formatMoney(expense.amount)}
                  </div>
                  {tab === 'pending' && <ApproveRejectButtons expenseId={expense.id} />}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
