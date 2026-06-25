import { getEmployeeExpenses, getOwnerExpenses, getExpenseCategories, getAllExpenses } from '@/lib/queries/expenses';
import { getProjects } from '@/lib/queries/projects';
import { getProfile } from '@/lib/supabase/get-profile';

export const dynamic = 'force-dynamic';

import { createClient } from '@/lib/supabase/server';
import { formatMoney } from '@/lib/money';
import { CreateExpenseModal } from '@/components/expenses/create-expense-modal';
import { CreateOwnerExpenseModal } from '@/components/expenses/create-owner-expense-modal';
import { AllExpensesFilters } from '@/components/expenses/all-expenses-filters';

export const metadata = {
  title: 'المصروفات',
};

export default async function EmployeeExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string, employee_id?: string, project_id?: string, category_id?: string, start_date?: string, end_date?: string, show_all?: string }>;
}) {
  const { tab = 'mine', employee_id, project_id, category_id, start_date, end_date, show_all } = await searchParams;
  const { profile: employee } = await getProfile();
  if (!employee) return <div>Not authenticated</div>;

  const isApprover = employee.can_approve || employee.is_super_admin;
  const isSuperAdmin = employee.is_super_admin;

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

  const activeCategories = categories.filter(c => c.is_active);

  // Load data based on tab
  const myExpenses   = tab === 'mine'   ? await getEmployeeExpenses(employee.id) : [];
  const ownerExpenses = (tab === 'owners' && isApprover) ? await getOwnerExpenses() : [];
  
  let allExpensesData: any[] = [];
  if (tab === 'all' && isSuperAdmin) {
    allExpensesData = await getAllExpenses({
      employeeId: employee_id,
      projectId: project_id,
      categoryId: category_id,
      startDate: isShowAll ? undefined : startDate,
      endDate: isShowAll ? undefined : endDate
    });
  }

  // Owner list for the create owner expense modal
  let owners: any[] = [];
  // Employees list for super admin to pick who to add expense for
  let allEmployees: any[] = [];
  if (isApprover) {
    const supabase = await createClient();
    const [{ data: ownerData }, { data: empData }] = await Promise.all([
      supabase.from('project_owners').select('id, name').order('name'),
      employee.is_super_admin
        ? supabase.from('employees').select('id, full_name').eq('is_active', true).order('full_name')
        : Promise.resolve({ data: [] }),
    ]);
    owners = ownerData || [];
    allEmployees = empData || [];
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">المصروفات</h1>
        <div className="flex gap-2">
          {(tab === 'mine' || tab === 'all') && (employee.has_custody_access || employee.is_super_admin) && (
            <CreateExpenseModal
              categories={activeCategories}
              projects={projects || []}
              isSuperAdmin={employee.is_super_admin}
              employees={allEmployees}
            />
          )}
          {tab === 'owners' && isApprover && (
            <CreateOwnerExpenseModal
              owners={owners}
              categories={activeCategories}
              projects={projects}
            />
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b overflow-x-auto pb-1">
        <a
          href="?tab=mine"
          className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
            tab === 'mine'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          مصروفاتي
        </a>
        {isApprover && (
          <a
            href="?tab=owners"
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              tab === 'owners'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            مصروفات الملاك
          </a>
        )}
        {isSuperAdmin && (
          <a
            href="?tab=all"
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              tab === 'all'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            كل المصروفات (للإدارة)
          </a>
        )}
      </div>

      {/* My expenses list */}
      {tab === 'mine' && (
        <div className="bg-card rounded-lg border shadow-sm divide-y">
          {myExpenses.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">لا توجد مصروفات</div>
          ) : (
            myExpenses.map((expense: any) => (
              <div key={expense.id} className="p-4 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                <div>
                  <p className="font-bold">{expense.project?.name} - {expense.category?.name}</p>
                  <p className="text-sm text-muted-foreground">{expense.notes}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <span>{expense.expense_date}</span>
                    <span>•</span>
                    <StatusBadge status={expense.status} />
                    {expense.status === 'approved' && (
                      <>
                        <span>•</span>
                        <span className="text-primary">تمت التسوية: {formatMoney(expense.settled_amount)}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="text-xl font-bold whitespace-nowrap">
                  {formatMoney(expense.amount)}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Owner expenses list */}
      {tab === 'owners' && isApprover && (
        <div className="bg-card rounded-lg border shadow-sm divide-y">
          {ownerExpenses.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              <p className="text-base">لا توجد مصروفات مسجلة للملاك</p>
              <p className="text-sm mt-1">اضغط "مصروف مالك جديد" لإضافة مصروف</p>
            </div>
          ) : (
            ownerExpenses.map(expense => (
              <div key={expense.id} className="p-4 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium bg-orange-500/10 text-orange-600 px-2 py-0.5 rounded-full">مالك</span>
                    <p className="font-bold">{(expense as any).owner?.name}</p>
                  </div>
                  <p className="text-sm text-muted-foreground mt-0.5">
                    {expense.project?.name ? `${expense.project.name} - ` : ''}
                    {expense.category?.name}
                  </p>
                  <p className="text-sm text-muted-foreground">{expense.notes}</p>
                  <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                    <span>{expense.expense_date}</span>
                    <span>•</span>
                    <StatusBadge status={expense.status} />
                  </div>
                </div>
                <div className="text-xl font-bold whitespace-nowrap">
                  {formatMoney(expense.amount)}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* All expenses list */}
      {tab === 'all' && isSuperAdmin && (
        <div className="space-y-4">
          <AllExpensesFilters 
            employees={allEmployees}
            projects={projects || []}
            categories={categories || []}
            selectedEmployeeId={employee_id || ''}
            selectedProjectId={project_id || ''}
            selectedCategoryId={category_id || ''}
            startDate={startDate}
            endDate={endDate}
            showAll={isShowAll}
          />

          <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
            <table className="w-full text-sm text-right">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="p-4 font-medium">التاريخ</th>
                  <th className="p-4 font-medium">الموظف / المالك</th>
                  <th className="p-4 font-medium">المشروع</th>
                  <th className="p-4 font-medium">بند الصرف</th>
                  <th className="p-4 font-medium">المبلغ</th>
                  <th className="p-4 font-medium">الحالة</th>
                  <th className="p-4 font-medium">البيان</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {allExpensesData?.map((expense: any) => (
                  <tr key={expense.id} className="hover:bg-muted/30 transition-colors">
                    <td className="p-4 whitespace-nowrap">{expense.expense_date}</td>
                    <td className="p-4 font-semibold">
                      {expense.owner_id ? (
                        <span className="text-orange-600">مالك: {expense.owner?.name}</span>
                      ) : (
                        <span className="text-primary">{expense.employee?.full_name}</span>
                      )}
                    </td>
                    <td className="p-4 text-muted-foreground">{expense.project?.name || '-'}</td>
                    <td className="p-4 text-muted-foreground">{expense.category?.name || '-'}</td>
                    <td className="p-4 font-bold">{formatMoney(expense.amount)}</td>
                    <td className="p-4"><StatusBadge status={expense.status} /></td>
                    <td className="p-4 text-muted-foreground">{expense.notes || '-'}</td>
                  </tr>
                ))}
                {(!allExpensesData || allExpensesData.length === 0) && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-muted-foreground">لا توجد مصروفات مسجلة</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; classes: string }> = {
    pending:  { label: 'قيد المراجعة', classes: 'bg-yellow-500/10 text-yellow-600' },
    approved: { label: 'معتمد',        classes: 'bg-green-500/10 text-green-600'  },
    rejected: { label: 'مرفوض',        classes: 'bg-red-500/10 text-red-600'     },
  };
  const config = map[status] || { label: status, classes: 'bg-accent text-foreground' };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${config.classes}`}>
      {config.label}
    </span>
  );
}
