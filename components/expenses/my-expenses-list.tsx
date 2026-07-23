'use client';

import { useMemo, useState } from 'react';
import { Search, AlertTriangle } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import { EditExpenseModal, DeleteExpenseButton } from './create-expense-modal';
import { AttachmentViewer } from '@/components/ui/attachment-viewer';
import { StatusBadge } from './status-badge';

export function MyExpensesList({
  expenses,
  categories,
  projects,
}: {
  expenses: any[];
  categories: any[];
  projects: any[];
}) {
  const [notesSearch, setNotesSearch] = useState('');

  const filtered = useMemo(() => {
    const needle = notesSearch.trim().toLowerCase();
    if (!needle) return expenses;
    return expenses.filter((e: any) => (e.notes || '').toLowerCase().includes(needle));
  }, [expenses, notesSearch]);

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={notesSearch}
          onChange={e => setNotesSearch(e.target.value)}
          placeholder="بحث في البيان..."
          className="w-full p-2 pr-9 rounded-md border bg-background text-sm"
        />
      </div>

      <div className="bg-card rounded-lg border shadow-sm divide-y">
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            {notesSearch ? 'لا توجد مصروفات مطابقة للبحث' : 'لا توجد مصروفات'}
          </div>
        ) : (
          filtered.map((expense: any) => (
            <div key={expense.id} className="p-4 flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row justify-between sm:items-center gap-4">
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
                <div className="flex items-center gap-2">
                  <AttachmentViewer attachments={expense.attachments} />
                  <div className="text-xl font-bold whitespace-nowrap">
                    {formatMoney(expense.amount)}
                  </div>
                  {expense.status !== 'approved' && (
                    <>
                      <EditExpenseModal
                        expense={expense}
                        categories={categories}
                        projects={projects}
                      />
                      <DeleteExpenseButton expenseId={expense.id} />
                    </>
                  )}
                </div>
              </div>
              {expense.status === 'rejected' && expense.rejection_reason && (
                <div className="flex gap-2 items-start bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-400 rounded-lg p-3 text-sm">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">سبب الرفض:</p>
                    <p>{expense.rejection_reason}</p>
                    <p className="text-xs mt-1 opacity-80">يرجى تعديل المصروف وإعادة إرساله للاعتماد.</p>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
