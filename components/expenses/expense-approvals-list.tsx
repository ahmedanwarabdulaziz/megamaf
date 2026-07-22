'use client';

import { useState } from 'react';
import { formatMoney } from '@/lib/money';
import { ApproveRejectButtons } from '@/components/expenses/approve-reject-buttons';
import { EditExpenseModal } from '@/components/expenses/create-expense-modal';
import { AttachmentViewer } from '@/components/ui/attachment-viewer';

export function ExpenseApprovalsList({
  expenses,
  tab,
  categories,
  projects,
}: {
  expenses: any[];
  tab: string;
  categories: any[];
  projects: any[];
}) {
  const [items, setItems] = useState(expenses);

  function handleRemove(expenseId: string) {
    setItems((prev) => prev.filter((e) => e.id !== expenseId));
  }

  if (items.length === 0) {
    return (
      <div className="p-8 text-center bg-card border rounded-lg shadow-sm text-muted-foreground">
        لا توجد مصروفات
      </div>
    );
  }

  const grouped = items.reduce((acc: any, expense: any) => {
    const isOwnerExpense = !expense.employee_id && expense.owner_id;
    const partyName = isOwnerExpense ? expense.owner?.name : expense.employee?.full_name;
    const key = isOwnerExpense ? `owner-${expense.owner_id}` : `employee-${expense.employee_id}`;

    if (!acc[key]) {
      acc[key] = {
        name: partyName,
        isOwner: isOwnerExpense,
        total: 0,
        expenses: [],
      };
    }
    acc[key].expenses.push(expense);
    acc[key].total += expense.amount;
    return acc;
  }, {});

  return (
    <>
      {Object.values(grouped).map((group: any) => (
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
                        <div className="flex justify-center items-center gap-2">
                          {!expense.owner_id && (
                            <EditExpenseModal
                              expense={expense}
                              categories={categories.filter((c) => c.is_active)}
                              projects={projects || []}
                            />
                          )}
                          <ApproveRejectButtons expenseId={expense.id} onSuccess={() => handleRemove(expense.id)} />
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
      ))}
    </>
  );
}
