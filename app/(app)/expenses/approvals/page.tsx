import { getAllExpenses, getExpenseCategories } from '@/lib/queries/expenses';
import { getProjects } from '@/lib/queries/projects';
import { getProfile } from '@/lib/supabase/get-profile';
import { AllExpensesFilters } from '@/components/expenses/all-expenses-filters';
import { ExpenseApprovalsList } from '@/components/expenses/expense-approvals-list';
import { VendorPaymentApprovalsList } from '@/components/expenses/vendor-payment-approvals-list';
import { getVendorPaymentRequests } from '@/lib/queries/vendor-payment-requests';
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

  // Load data based on tab. Vendor payment requests (payments to contractors
  // funded from a bank / another employee's custody) are approved in the same
  // place as expenses but are a different kind of record, so they're fetched
  // separately and rendered in their own, visually distinct section. They have
  // no expense category, so a category filter hides them.
  const [expenses, vendorPaymentRequests] = await Promise.all([
    getAllExpenses({
      employeeId: employee_id,
      projectId: project_id,
      categoryId: category_id,
      startDate: isShowAll ? undefined : startDate,
      endDate: isShowAll ? undefined : endDate,
      status: tab === 'approved' ? 'approved' : 'pending'
    }),
    category_id
      ? Promise.resolve([] as any[])
      : getVendorPaymentRequests({
          statuses: [tab === 'approved' ? 'approved' : 'pending'],
          requestedBy: employee_id,
          projectId: project_id,
          startDate: isShowAll ? undefined : startDate,
          endDate: isShowAll ? undefined : endDate,
        }),
  ]);
  const pendingCount = expenses.length + vendorPaymentRequests.length;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">اعتمادات المصروفات</h1>
        {tab === 'pending' && pendingCount > 0 && (
          <span className="text-sm bg-yellow-500/10 text-yellow-600 px-3 py-1 rounded-full font-medium">
            {pendingCount} بانتظار الاعتماد
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

      <div className="space-y-6">
        <VendorPaymentApprovalsList
          key={`vpr-${tab}-${employee_id || ''}-${project_id || ''}-${category_id || ''}-${startDate}-${endDate}-${isShowAll}`}
          requests={vendorPaymentRequests}
          tab={tab}
          currentEmployeeId={employee.id}
          isSuperAdmin={!!employee.is_super_admin}
        />
        {/* The list's own empty state ("no expenses") would be misleading while
            payment vouchers are showing above it, so only render it when there's
            something to list or nothing else on the page. */}
        {(expenses.length > 0 || vendorPaymentRequests.length === 0) && (
          <ExpenseApprovalsList
            key={`${tab}-${employee_id || ''}-${project_id || ''}-${category_id || ''}-${startDate}-${endDate}-${isShowAll}`}
            expenses={expenses}
            tab={tab}
            categories={categories}
            projects={projects || []}
          />
        )}
      </div>
    </div>
  );
}
