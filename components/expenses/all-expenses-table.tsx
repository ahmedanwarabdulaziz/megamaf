'use client';

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import { EditExpenseModal, DeleteExpenseButton } from './create-expense-modal';
import { AttachmentViewer } from '@/components/ui/attachment-viewer';
import { StatusBadge } from './status-badge';

export function AllExpensesTable({
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
              <th className="p-4 font-medium">اعتمد بواسطة</th>
              <th className="p-4 font-medium">البيان</th>
              <th className="p-4 font-medium text-center">المرفقات</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((expense: any) => (
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
                <td className="p-4 font-bold">
                  <div className="flex items-center gap-2 justify-end">
                    {formatMoney(expense.amount)}
                    {expense.status !== 'approved' && !expense.owner_id && (
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
                </td>
                <td className="p-4"><StatusBadge status={expense.status} /></td>
                <td className="p-4 text-muted-foreground">{expense.approver?.full_name || '-'}</td>
                <td className="p-4 text-muted-foreground">{expense.notes || '-'}</td>
                <td className="p-4 text-center">
                  <AttachmentViewer attachments={expense.attachments} />
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={9} className="p-8 text-center text-muted-foreground">
                  {notesSearch ? 'لا توجد مصروفات مطابقة للبحث' : 'لا توجد مصروفات مسجلة'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
