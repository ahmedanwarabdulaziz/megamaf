import { getPendingExpenses } from '@/lib/queries/expenses';
import { getProfile } from '@/lib/supabase/get-profile';
import { formatMoney } from '@/lib/money';
import { ApproveRejectButtons } from '@/components/expenses/approve-reject-buttons';

export const metadata = {
  title: 'اعتمادات المصروفات',
};

export default async function ExpenseApprovalsPage() {
  const { profile: employee } = await getProfile();
  if (!employee?.can_approve && !employee?.is_super_admin) {
    return <div className="p-8 text-center text-red-500">غير مصرح لك بدخول هذه الصفحة</div>;
  }

  const pending = await getPendingExpenses();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">اعتمادات المصروفات</h1>
        {pending.length > 0 && (
          <span className="text-sm bg-yellow-500/10 text-yellow-600 px-3 py-1 rounded-full font-medium">
            {pending.length} بانتظار الاعتماد
          </span>
        )}
      </div>

      <div className="bg-card rounded-lg border shadow-sm divide-y">
        {pending.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">لا توجد مصروفات قيد المراجعة</div>
        ) : (
          pending.map(expense => {
            const isOwnerExpense = !expense.employee_id && (expense as any).owner_id;
            const partyName = isOwnerExpense
              ? (expense as any).owner?.name
              : expense.employee?.full_name;

            return (
              <div key={expense.id} className="p-4 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
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
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-xl font-bold whitespace-nowrap">
                    {formatMoney(expense.amount)}
                  </div>
                  <ApproveRejectButtons expenseId={expense.id} />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
