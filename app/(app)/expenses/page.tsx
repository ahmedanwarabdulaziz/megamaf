import { getEmployeeExpenses, getOwnerExpenses, getExpenseCategories, getAllExpenses } from '@/lib/queries/expenses';
import { getProjects } from '@/lib/queries/projects';
import { getBanks } from '@/lib/queries/banks';
import { getProfile } from '@/lib/supabase/get-profile';
import { Wallet, CheckCircle, AlertCircle, TrendingDown } from 'lucide-react';

export const dynamic = 'force-dynamic';

import { createClient } from '@/lib/supabase/server';
import { formatMoney } from '@/lib/money';
import { CreateExpenseModal } from '@/components/expenses/create-expense-modal';
import { CreateOwnerExpenseModal } from '@/components/expenses/create-owner-expense-modal';
import { AllExpensesFilters } from '@/components/expenses/all-expenses-filters';
import { AttachmentViewer } from '@/components/ui/attachment-viewer';
import { MyExpensesList } from '@/components/expenses/my-expenses-list';
import { AllExpensesTable } from '@/components/expenses/all-expenses-table';
import { StatusBadge } from '@/components/expenses/status-badge';

export const metadata = {
  title: 'المصروفات',
};

export default async function EmployeeExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string, employee_id?: string, project_id?: string, category_id?: string, start_date?: string, end_date?: string, show_all?: string, status?: string }>;
}) {
  const { tab = 'mine', employee_id, project_id, category_id, start_date, end_date, show_all, status } = await searchParams;
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

  const [categories, projects, banks] = await Promise.all([
    getExpenseCategories(),
    getProjects(),
    isSuperAdmin ? getBanks() : Promise.resolve([]),
  ]);

  const activeCategories = categories.filter(c => c.is_active);

  const bankAccounts = (banks || []).flatMap((b: any) =>
    (b.accounts || []).map((a: any) => ({
      bank_account_id: a.bank_account_id,
      bank_name: b.name,
      account_name: a.account_name,
      current_balance: a.current_balance,
    }))
  );

  // Load data based on tab
  const myExpenses = tab === 'mine' ? await getAllExpenses({
    employeeId: employee.id,
    projectId: project_id,
    categoryId: category_id,
    startDate: isShowAll ? undefined : startDate,
    endDate: isShowAll ? undefined : endDate,
    status: status
  }) : [];
  
  const ownerExpenses = (tab === 'owners' && isApprover) ? await getOwnerExpenses() : [];
  
  let allExpensesData: any[] = [];
  if (tab === 'all' && isSuperAdmin) {
    allExpensesData = await getAllExpenses({
      employeeId: employee_id,
      projectId: project_id,
      categoryId: category_id,
      startDate: isShowAll ? undefined : startDate,
      endDate: isShowAll ? undefined : endDate,
      status: status
    });
  }

  // Owner list for the create owner expense modal
  let owners: any[] = [];
  // Employees list for super admin to pick who to add expense for
  let allEmployees: any[] = [];

  // Fetch custody balance for the current employee
  let custodyBalance: any = null;
  const supabase = await createClient();

  const custodyBalancePromise = supabase
    .from('v_employee_custody_balance')
    .select('*')
    .eq('employee_id', employee.id)
    .maybeSingle();

  if (isApprover) {
    const [{ data: ownerData }, { data: empData }, { data: custodyData }] = await Promise.all([
      supabase.from('project_owners').select('id, name').order('name'),
      employee.is_super_admin
        ? supabase.from('employees').select('id, full_name').eq('is_active', true).order('full_name')
        : Promise.resolve({ data: [] }),
      custodyBalancePromise,
    ]);
    owners = ownerData || [];
    allEmployees = empData || [];
    custodyBalance = custodyData;
  } else {
    const { data: custodyData } = await custodyBalancePromise;
    custodyBalance = custodyData;
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
              bankAccounts={bankAccounts}
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

      {/* Summary cards – only shown on "mine" tab */}
      {tab === 'mine' && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {/* Total custody received */}
          <div className="bg-card rounded-lg border shadow-sm p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-600 shrink-0">
              <Wallet className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">إجمالي العهد المستلمة</p>
              <p className="text-lg font-bold truncate">{formatMoney(custodyBalance?.total_disbursed ?? 0)}</p>
            </div>
          </div>

          {/* Total approved expenses */}
          <div className="bg-card rounded-lg border shadow-sm p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-green-500/10 text-green-600 shrink-0">
              <CheckCircle className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">إجمالي المصروفات المعتمدة</p>
              <p className="text-lg font-bold truncate text-green-600">{formatMoney(custodyBalance?.total_approved_expenses ?? 0)}</p>
            </div>
          </div>

          {/* Remaining balance */}
          <div className="bg-card rounded-lg border shadow-sm p-4 flex items-center gap-3">
            <div className={`p-2 rounded-lg shrink-0 ${(custodyBalance?.balance ?? 0) >= 0 ? 'bg-emerald-500/10 text-emerald-600' : 'bg-red-500/10 text-red-600'}`}>
              <TrendingDown className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">الرصيد المتبقي</p>
              <p className={`text-lg font-bold truncate ${(custodyBalance?.balance ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {formatMoney(custodyBalance?.balance ?? 0)}
              </p>
            </div>
          </div>

          {/* Pending (unapproved) expenses */}
          <div className="bg-card rounded-lg border shadow-sm p-4 flex items-center gap-3">
            <div className="p-2 rounded-lg bg-yellow-500/10 text-yellow-600 shrink-0">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">المصروفات غير المعتمدة</p>
              <p className="text-lg font-bold truncate text-yellow-600">
                {formatMoney(myExpenses.filter((e: any) => e.status === 'pending').reduce((s: number, e: any) => s + (e.amount ?? 0), 0))}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* My expenses list */}

      {tab === 'mine' && (
        <div className="space-y-4">
          <AllExpensesFilters 
            employees={allEmployees}
            projects={projects || []}
            categories={categories || []}
            selectedEmployeeId=""
            selectedProjectId={project_id || ''}
            selectedCategoryId={category_id || ''}
            selectedStatus={status || ''}
            startDate={startDate}
            endDate={endDate}
            showAll={isShowAll}
            activeTab="mine"
            hideEmployeeFilter={true}
          />
          <MyExpensesList
            expenses={myExpenses}
            categories={activeCategories}
            projects={projects || []}
          />
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
                <div className="flex items-center gap-2">
                  <AttachmentViewer attachments={(expense as any).attachments} />
                  <div className="text-xl font-bold whitespace-nowrap">
                    {formatMoney(expense.amount)}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'all' && isSuperAdmin && (
        <div className="space-y-4">
          <AllExpensesFilters 
            employees={allEmployees}
            projects={projects || []}
            categories={categories || []}
            selectedEmployeeId={employee_id || ''}
            selectedProjectId={project_id || ''}
            selectedCategoryId={category_id || ''}
            selectedStatus={status || ''}
            startDate={startDate}
            endDate={endDate}
            showAll={isShowAll}
            activeTab="all"
          />

          <AllExpensesTable
            expenses={allExpensesData || []}
            categories={categories || []}
            projects={projects || []}
          />
        </div>
      )}
    </div>
  );
}
