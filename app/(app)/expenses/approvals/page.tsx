import { getAllExpenses, getExpenseCategories } from '@/lib/queries/expenses';
import { getProjects } from '@/lib/queries/projects';
import { getProfile } from '@/lib/supabase/get-profile';
import { formatMoney } from '@/lib/money';
import { ApproveRejectButtons } from '@/components/expenses/approve-reject-buttons';
import { EditExpenseModal } from '@/components/expenses/create-expense-modal';
import { AllExpensesFilters } from '@/components/expenses/all-expenses-filters';
import { AttachmentViewer } from '@/components/ui/attachment-viewer';
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

      <div>
        {expenses.length === 0 ? (
          <div className="p-8 text-center bg-card border rounded-lg shadow-sm text-muted-foreground">لا توجد مصروفات</div>
        ) : (
          (() => {
            const grouped = expenses.reduce((acc: any, expense: any) => {
              const isOwnerExpense = !expense.employee_id && expense.owner_id;
              const partyName = isOwnerExpense ? expense.owner?.name : expense.employee?.full_name;
              const key = isOwnerExpense ? `owner-${expense.owner_id}` : `employee-${expense.employee_id}`;
              
              if (!acc[key]) {
                acc[key] = {
                  name: partyName,
                  isOwner: isOwnerExpense,
                  total: 0,
                  expenses: []
                };
              }
              acc[key].expenses.push(expense);
              acc[key].total += expense.amount;
              return acc;
            }, {});

            return Object.values(grouped).map((group: any) => (
              <div key={group.name} className="border rounded-lg bg-card shadow-sm overflow-hidden mb-6">
                <div className="bg-muted/40 p-4 border-b flex justify-between items-center">
                  <div className="font-bold flex items-center gap-2">
                    {group.isOwner && <span className="text-[10px] bg-orange-500/10 text-orange-600 px-2 py-0.5 rounded-full">مالك</span>}
                    <span className="text-lg text-primary">{group.name}</span>
                  </div>
                  <div className="font-bold text-lg">{formatMoney(group.total)}</div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-right">
                    <thead className="bg-muted/20 text-muted-foreground">
                      <tr>
                        <th className="px-4 py-3 font-medium whitespace-nowrap">التاريخ</th>
                        <th className="px-4 py-3 font-medium">المشروع</th>
                        <th className="px-4 py-3 font-medium">التصنيف</th>
                        <th className="px-4 py-3 font-medium">البيان</th>
                        <th className="px-4 py-3 font-medium">المبلغ</th>
                        <th className="px-4 py-3 font-medium text-center">المرفقات</th>
                        {tab === 'pending' && <th className="px-4 py-3 font-medium text-center">الإجراء</th>}
                        {tab === 'approved' && <th className="px-4 py-3 font-medium text-center">الحالة</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {group.expenses.map((expense: any) => (
                        <tr key={expense.id} className="hover:bg-muted/30 transition-colors">
                          <td className="px-4 py-3 whitespace-nowrap">{expense.expense_date}</td>
                          <td className="px-4 py-3 max-w-[150px] truncate" title={expense.project?.name}>{expense.project?.name}</td>
                          <td className="px-4 py-3 max-w-[150px] truncate" title={expense.category?.name}>{expense.category?.name}</td>
                          <td className="px-4 py-3 max-w-[200px] truncate" title={expense.notes}>{expense.notes}</td>
                          <td className="px-4 py-3 font-bold whitespace-nowrap">{formatMoney(expense.amount)}</td>
                          <td className="px-4 py-3 text-center">
                            <AttachmentViewer attachments={expense.attachments} />
                          </td>
                          {tab === 'pending' && (
                            <td className="px-4 py-2 text-center">
                              <div className="flex justify-center items-center gap-2 transform scale-90 origin-center">
                                {!expense.owner_id && (
                                  <EditExpenseModal 
                                    expense={expense} 
                                    categories={categories.filter(c => c.is_active)} 
                                    projects={projects || []} 
                                  />
                                )}
                                <ApproveRejectButtons expenseId={expense.id} />
                              </div>
                            </td>
                          )}
                          {tab === 'approved' && expense.status === 'approved' && (
                            <td className="px-4 py-3 text-center text-green-600 font-bold whitespace-nowrap">
                              معتمد
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ));
          })()
        )}
      </div>
    </div>
  );
}
