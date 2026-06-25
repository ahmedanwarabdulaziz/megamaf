import { getEmployeeCustodyBalance, getEmployeeDisbursements, getEmployeeExpenses } from '@/lib/queries/expenses';
import { getProfile } from '@/lib/supabase/get-profile';
import { formatMoney } from '@/lib/money';

export const metadata = {
  title: 'كشف حساب العهدة',
};

export default async function EmployeeCustodyStatementPage() {
  const { profile: employee } = await getProfile();
  if (!employee) return <div>Not authenticated</div>;

  const balance = await getEmployeeCustodyBalance(employee.id);
  const disbursements = await getEmployeeDisbursements(employee.id);
  const expenses = await getEmployeeExpenses(employee.id);

  // Combine and sort by date descending
  type TimelineItem = { type: 'disb' | 'exp', date: string, id: string, amount: number, memo?: string, entity: any };
  
  const timeline: TimelineItem[] = [
    ...disbursements.map(d => ({ type: 'disb' as const, date: d.entry_date, id: d.id, amount: d.amount, memo: d.memo, entity: d })),
    ...expenses.map(e => ({ type: 'exp' as const, date: e.expense_date, id: e.id, amount: e.amount, memo: e.notes, entity: e }))
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">كشف حساب العهدة</h1>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card p-4 rounded-lg border shadow-sm">
          <p className="text-sm text-muted-foreground mb-1">إجمالي المنصرف لك</p>
          <p className="text-2xl font-bold">{formatMoney(balance.total_disbursed)}</p>
        </div>
        <div className="bg-card p-4 rounded-lg border shadow-sm">
          <p className="text-sm text-muted-foreground mb-1">إجمالي المصروفات المعتمدة</p>
          <p className="text-2xl font-bold">{formatMoney(balance.total_approved_expenses)}</p>
        </div>
        <div className="bg-card p-4 rounded-lg border shadow-sm">
          <p className="text-sm text-muted-foreground mb-1">الرصيد المتبقي معك</p>
          <p className={`text-2xl font-bold ${balance.balance < 0 ? 'text-red-500' : 'text-green-500'}`}>
            {formatMoney(balance.balance)}
          </p>
          {balance.balance < 0 && <p className="text-xs text-red-500 mt-1">الشركة مدينة لك بهذا المبلغ</p>}
        </div>
      </div>

      <div className="bg-card rounded-lg border shadow-sm divide-y">
        {timeline.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">لا توجد حركات عهدة مسجلة</div>
        ) : (
          timeline.map(item => (
            <div key={`${item.type}-${item.id}`} className="p-4 flex flex-col sm:flex-row justify-between sm:items-center gap-4">
              <div>
                <p className="font-bold flex items-center gap-2">
                  {item.type === 'disb' ? (
                    <span className="text-green-600 bg-green-500/10 px-2 py-0.5 rounded text-xs">استلام عهدة</span>
                  ) : (
                    <span className="text-blue-600 bg-blue-500/10 px-2 py-0.5 rounded text-xs">تسجيل مصروف</span>
                  )}
                  <span>{item.type === 'disb' ? 'من الخزينة' : `${item.entity.project?.name} - ${item.entity.category?.name}`}</span>
                </p>
                <p className="text-sm text-muted-foreground mt-1">{item.memo}</p>
                <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                  <span>{item.date}</span>
                  {item.type === 'exp' && (
                    <>
                      <span>•</span>
                      <StatusBadge status={item.entity.status} />
                      {item.entity.status === 'approved' && (
                        <>
                          <span>•</span>
                          <span className="text-primary">مسوى: {formatMoney(item.entity.settled_amount)}</span>
                        </>
                      )}
                    </>
                  )}
                  {item.type === 'disb' && (
                    <>
                      <span>•</span>
                      <span>من حساب: {item.entity.bank_account?.account_name}</span>
                    </>
                  )}
                </div>
              </div>
              <div className="text-xl font-bold whitespace-nowrap">
                {item.type === 'disb' ? '+' : '-'}{formatMoney(item.amount)}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string, classes: string }> = {
    pending: { label: 'قيد المراجعة', classes: 'bg-yellow-500/10 text-yellow-600' },
    approved: { label: 'معتمد', classes: 'bg-green-500/10 text-green-600' },
    rejected: { label: 'مرفوض', classes: 'bg-red-500/10 text-red-600' },
  };
  const config = map[status] || { label: status, classes: 'bg-accent text-foreground' };
  
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${config.classes}`}>
      {config.label}
    </span>
  );
}
