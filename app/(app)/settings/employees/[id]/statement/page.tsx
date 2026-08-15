import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { formatMoney } from '@/lib/money';
import Link from 'next/link';
import { ArrowLeft, Wallet, Receipt } from 'lucide-react';
import { StatementMonthFilter } from '@/components/treasury/statement-month-filter';
import { AttachmentViewer } from '@/components/ui/attachment-viewer';

export const metadata = { title: 'كشف حساب عهدة الموظف' };

export default async function EmployeeStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string; year?: string; show_all?: string }>;
}) {
  const { id } = await params;
  const { month, year, show_all } = await searchParams;
  const supabase = await createClient();

  // ── Fetch Employee Info, Disbursements, and Expenses ────────────────────────
  const [
    { data: employee },
    { data: disbursements },
    { data: expenses },
  ] = await Promise.all([
    supabase.from('employees').select('*').eq('id', id).single(),
    supabase
      .from('ledger_entries')
      .select('id, amount, entry_date, memo, created_at, projects(name)')
      .eq('employee_id', id)
      .eq('category', 'custody_disbursement')
      .eq('direction', 'in')
      .order('entry_date', { ascending: true }),
    supabase
      .from('expenses')
      .select('id, amount, expense_date, notes, created_at, category_id, projects(name), expense_categories(name)')
      .eq('employee_id', id)
      .eq('status', 'approved')
      .eq('is_direct', false)
      .order('expense_date', { ascending: true }),
  ]);

  if (!employee) notFound();

  // A salary-advance expense (fixed "سلفة من الراتب" category) is booked
  // against the funding employee's own custody, not the borrower's — join
  // employee_loans back in so the statement shows who the loan is actually for.
  const SALARY_ADVANCE_CATEGORY_ID = '00000000-0000-0000-0000-000000000010';
  const loanExpenseIds = (expenses ?? []).filter(e => e.category_id === SALARY_ADVANCE_CATEGORY_ID).map(e => e.id);
  const loanBorrowerByExpenseId: Record<string, string> = {};
  if (loanExpenseIds.length > 0) {
    const { data: loans } = await supabase
      .from('employee_loans')
      .select('expense_id, borrower:employees!employee_loans_employee_id_fkey(full_name)')
      .in('expense_id', loanExpenseIds);
    for (const l of loans || []) {
      if (l.expense_id) loanBorrowerByExpenseId[l.expense_id] = (l.borrower as any)?.full_name || '';
    }
  }

  // ── Fetch Attachments ─────────────────────────────────────────────────────
  const expenseIds = (expenses ?? []).map(e => e.id);
  const disbIds = (disbursements ?? []).map(d => d.id);
  const allEntityIds = [...expenseIds, ...disbIds];

  let attachmentsData: { entity_id: string; r2_key: string }[] = [];
  if (allEntityIds.length > 0) {
    const { data } = await supabase
      .from('attachments')
      .select('entity_id, r2_key')
      .in('entity_id', allEntityIds);
    if (data) attachmentsData = data;
  }

  // ── Build statement rows ──────────────────────────────────────────────────
  type StatementRow = {
    date: string;
    project_name: string;
    description: string;
    amount_disbursed: number; // + Balance
    amount_spent: number;     // - Balance
    document_type: 'disbursement' | 'expense';
    document_id: string;
    category?: string;
    attachments: { r2_key: string }[];
    created_at: string;
  };

  const rows: StatementRow[] = [];

  for (const disb of disbursements ?? []) {
    rows.push({
      date: disb.entry_date,
      created_at: disb.created_at,
      project_name: (disb.projects as any)?.name ?? '—',
      description: disb.memo || 'صرف عهدة للموظف',
      amount_disbursed: Number(disb.amount),
      amount_spent: 0,
      document_type: 'disbursement',
      document_id: disb.id,
      attachments: attachmentsData.filter(a => a.entity_id === disb.id),
    });
  }

  for (const exp of expenses ?? []) {
    const loanBorrower = loanBorrowerByExpenseId[exp.id];
    rows.push({
      date: exp.expense_date,
      created_at: exp.created_at,
      project_name: (exp.projects as any)?.name ?? '—',
      description: loanBorrower ? `سلفة راتب لصالح: ${loanBorrower}` : (exp.notes || 'مصروف معتمد'),
      amount_disbursed: 0,
      amount_spent: Number(exp.amount),
      document_type: 'expense',
      document_id: exp.id,
      category: (exp.expense_categories as any)?.name ?? '—',
      attachments: attachmentsData.filter(a => a.entity_id === exp.id),
    });
  }

  // Sort all rows by date ASCENDING to compute running balance correctly
  // Use created_at as secondary sort key for same-day transactions
  rows.sort((a, b) => {
    const dateDiff = new Date(a.date).getTime() - new Date(b.date).getTime();
    if (dateDiff !== 0) return dateDiff;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  // Compute running balance
  let running = 0;
  const allRowsWithBalance = rows.map((row) => {
    running += row.amount_disbursed - row.amount_spent;
    return { ...row, running_balance: running };
  });

  // ── Summary totals (Overall) ──────────────────────────────────────────────
  const totalDisbursed = allRowsWithBalance.reduce((s, r) => s + r.amount_disbursed, 0);
  const totalSpent = allRowsWithBalance.reduce((s, r) => s + r.amount_spent, 0);
  const balance = totalDisbursed - totalSpent;

  // ── Filter and Sort (Newest first) ────────────────────────────────────────
  let displayRows = [...allRowsWithBalance];

  if (show_all !== 'true') {
    const currentMonth = (new Date().getMonth() + 1).toString().padStart(2, '0');
    const currentYear = new Date().getFullYear().toString();
    const filterMonth = month ? month.padStart(2, '0') : currentMonth;
    const filterYear = year || currentYear;
    const filterPrefix = `${filterYear}-${filterMonth}`;

    displayRows = displayRows.filter(row => row.date && row.date.startsWith(filterPrefix));
  }

  // Sort DESCENDING (newest to oldest) for display
  // Use created_at as secondary sort key
  displayRows.sort((a, b) => {
    const dateDiff = new Date(b.date).getTime() - new Date(a.date).getTime();
    if (dateDiff !== 0) return dateDiff;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href="/treasury/custody?tab=employees" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-6 h-6" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">كشف حساب عهدة الموظف</h1>
          <p className="text-muted-foreground mt-1">الموظف: {employee.full_name}</p>
        </div>
      </div>

      <StatementMonthFilter />

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card p-4 rounded-xl border shadow-sm">
          <div className="flex items-center justify-between mb-1">
             <p className="text-sm text-muted-foreground">إجمالي العهد المنصرفة</p>
             <Wallet className="w-4 h-4 text-green-600 opacity-70" />
          </div>
          <p className="text-xl font-bold text-green-600">{formatMoney(totalDisbursed)}</p>
        </div>
        <div className="bg-card p-4 rounded-xl border shadow-sm">
          <div className="flex items-center justify-between mb-1">
             <p className="text-sm text-muted-foreground">إجمالي المصروفات المعتمدة</p>
             <Receipt className="w-4 h-4 text-amber-600 opacity-70" />
          </div>
          <p className="text-xl font-bold text-amber-600">{formatMoney(totalSpent)}</p>
        </div>
        <div className="bg-card p-4 rounded-xl border shadow-sm bg-muted/30">
          <p className="text-sm text-muted-foreground mb-1">الرصيد المتبقي لدى الموظف</p>
          <p className={`text-2xl font-bold ${balance < 0 ? 'text-red-500' : 'text-primary'}`}>{formatMoney(balance)}</p>
        </div>
      </div>

      {/* Statement table */}
      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="p-3 font-medium">التاريخ</th>
                <th className="p-3 font-medium">المشروع</th>
                <th className="p-3 font-medium">البيان</th>
                <th className="p-3 font-medium">التصنيف</th>
                <th className="p-3 font-medium text-green-600">منصرف (إيداع عهدة)</th>
                <th className="p-3 font-medium text-amber-600">مصروف (تم صرفه)</th>
                <th className="p-3 font-medium text-primary">رصيد العهدة</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {displayRows.map((row, idx) => (
                <tr
                  key={`${row.document_type}_${row.document_id}_${idx}`}
                  className="hover:bg-muted/30 transition-colors"
                >
                  <td className="p-3 whitespace-nowrap">{row.date}</td>
                  <td className="p-3 text-muted-foreground">{row.project_name}</td>
                  <td className="p-3 font-medium">
                    <div className="flex flex-col gap-1 items-start">
                      <span>{row.description}</span>
                      {row.attachments && row.attachments.length > 0 && (
                        <div className="mt-1">
                          <AttachmentViewer attachments={row.attachments} />
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="p-3 text-muted-foreground">{row.category ?? '—'}</td>
                  <td className="p-3 font-medium text-green-600">
                    {row.amount_disbursed > 0 ? formatMoney(row.amount_disbursed) : '—'}
                  </td>
                  <td className="p-3 font-medium text-amber-600">
                    {row.amount_spent > 0 ? formatMoney(row.amount_spent) : '—'}
                  </td>
                  <td className={`p-3 font-bold ${row.running_balance < 0 ? 'text-red-500' : 'text-primary'}`} dir="ltr">
                    {formatMoney(row.running_balance)}
                  </td>
                </tr>
              ))}
              {displayRows.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    لا يوجد حركات مسجلة على عهدة هذا الموظف في الفترة المحددة.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
