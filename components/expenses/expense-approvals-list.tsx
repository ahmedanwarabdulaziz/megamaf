'use client';

import { useState } from 'react';
import { ChevronDown, Landmark, Users } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';
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
  const [openGroup, setOpenGroup] = useState<string | null>(null);

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
        key,
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
      {Object.values(grouped).map((group: any) => {
        const isOpen = openGroup === group.key;
        return (
          <div key={group.key} className="border rounded-lg bg-card shadow-sm overflow-hidden mb-6">
            <button
              type="button"
              onClick={() => setOpenGroup(isOpen ? null : group.key)}
              className="w-full bg-muted/40 p-4 border-b flex justify-between items-center gap-2 text-right"
            >
              <div className="font-bold flex items-center gap-2 min-w-0">
                {group.isOwner && <span className="text-[10px] bg-orange-500/10 text-orange-600 px-2 py-0.5 rounded-full shrink-0">مالك</span>}
                <span className="text-lg text-primary truncate">{group.name}</span>
                <span className="text-xs font-normal text-muted-foreground shrink-0">({group.expenses.length})</span>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="font-bold text-lg whitespace-nowrap">{formatMoney(group.total)}</div>
                <ChevronDown className={cn('w-4 h-4 transition-transform', isOpen && 'rotate-180')} />
              </div>
            </button>
            {isOpen && (
              <div className="divide-y">
                {group.expenses.map((expense: any) => {
                  const isBankFunded = expense.funding_type === 'bank';
                  const isCustodyFunded = expense.funding_type === 'employee_custody';
                  return (
                  <div
                    key={expense.id}
                    className={cn(
                      'p-4 flex flex-col gap-3',
                      isBankFunded && 'border-r-4 border-blue-500 bg-blue-500/5',
                      isCustodyFunded && 'border-r-4 border-purple-500 bg-purple-500/5'
                    )}
                  >
                    {(isBankFunded || isCustodyFunded) && (
                      <div
                        className={cn(
                          'flex items-center gap-2 text-xs font-bold px-3 py-1.5 rounded-md w-fit',
                          isBankFunded
                            ? 'bg-blue-500/15 text-blue-700 dark:text-blue-400'
                            : 'bg-purple-500/15 text-purple-700 dark:text-purple-400'
                        )}
                      >
                        {isBankFunded ? <Landmark className="w-3.5 h-3.5 shrink-0" /> : <Users className="w-3.5 h-3.5 shrink-0" />}
                        <span>
                          {isBankFunded
                            ? `صرف تلقائي عند الاعتماد من: ${expense.funding_bank?.banks?.name} - ${expense.funding_bank?.account_name}`
                            : `صرف تلقائي عند الاعتماد من عهدة: ${expense.funding_employee?.full_name}`}
                        </span>
                      </div>
                    )}
                    <div className="flex flex-col sm:flex-row justify-between sm:items-start gap-3">
                      <div className="min-w-0">
                        <p className="font-bold truncate">{expense.category?.name}</p>
                        {expense.project?.name && (
                          <p className="text-xs text-muted-foreground truncate">{expense.project.name}</p>
                        )}
                        {expense.notes && (
                          <p className="text-sm text-muted-foreground mt-1">{expense.notes}</p>
                        )}
                        <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                          <span>{expense.expense_date}</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between sm:flex-col sm:items-end gap-2 shrink-0">
                        <AttachmentViewer attachments={expense.attachments} />
                        <div className="text-lg font-bold whitespace-nowrap">{formatMoney(expense.amount)}</div>
                      </div>
                    </div>

                    {tab === 'pending' && (
                      <div className="flex items-center gap-2 pt-2 border-t">
                        {!expense.owner_id && (
                          <EditExpenseModal
                            expense={expense}
                            categories={categories.filter((c) => c.is_active)}
                            projects={projects || []}
                          />
                        )}
                        <div className="flex-1">
                          <ApproveRejectButtons expenseId={expense.id} onSuccess={() => handleRemove(expense.id)} />
                        </div>
                      </div>
                    )}
                    {tab === 'approved' && expense.status === 'approved' && (
                      <div className="text-center sm:text-right text-green-600 font-bold text-sm pt-2 border-t">
                        معتمد
                      </div>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
