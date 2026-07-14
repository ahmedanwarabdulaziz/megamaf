import { getBankAccountDetails, getBanks, getAllBanksLedger, getAllBanksLedgerSummary } from '@/lib/queries/banks';
import { AdjustmentModal } from '@/components/banks/adjustment-modal';
import { TransferModal } from '@/components/banks/transfer-modal';
import { AccountStatementFilters } from '@/components/banks/account-statement-filters';
import Link from 'next/link';
import { ChevronRight, ArrowDownLeft, ArrowUpRight, FileDown } from 'lucide-react';
import { formatMoney } from '@/lib/money';

export const dynamic = 'force-dynamic';

const categoryMap: Record<string, string> = {
  'opening_balance': 'رصيد افتتاحي',
  'bank_in': 'إيداع بنكي',
  'bank_out': 'سحب بنكي',
  'custody_disbursement': 'صرف عهدة',
  'vendor_payment': 'دفعة مقاول/مورد',
  'owner_payment': 'دفعة مالك',
  'deposit_collection': 'تحصيل وديعة',
  'interest': 'فوائد',
  'deduction': 'خصومات/مصروفات',
  'transfer_in': 'تحويل وارد',
  'transfer_out': 'تحويل صادر',
  'salary_payment': 'دفعة راتب',
  'loan_disbursement': 'صرف سلفة',
  'expense_direct': 'مصروف مباشر',
};

const counterpartyTypeMap: Record<string, string> = {
  vendor: 'مقاول/مورد',
  owner: 'مالك',
  employee: 'موظف',
  bank: 'حساب بنكي',
  internal: 'داخلي',
};

export default async function BankStatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ accountId: string }>;
  searchParams: Promise<{ start_date?: string; end_date?: string; show_all?: string }>;
}) {
  const { accountId } = await params;
  const { start_date, end_date, show_all } = await searchParams;

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const lastDay = new Date(year, now.getMonth() + 1, 0).getDate();
  const defaultStart = `${year}-${month}-01`;
  const defaultEnd = `${year}-${month}-${lastDay}`;

  const startDate = start_date || defaultStart;
  const endDate = end_date || defaultEnd;
  const isShowAll = show_all === 'true';
  const isFiltered = isShowAll || !!start_date || !!end_date;

  const [account, banks, { totalIn, totalOut }, { items, totalCount }] = await Promise.all([
    getBankAccountDetails(accountId),
    getBanks(),
    getAllBanksLedgerSummary({ startDate, endDate, showAll: isShowAll, bankAccountId: accountId }),
    getAllBanksLedger({
      startDate,
      endDate,
      showAll: isShowAll,
      bankAccountId: accountId,
      limit: isFiltered ? 200 : 50,
    }),
  ]);

  const exportParams = new URLSearchParams({ account_id: accountId });
  if (isShowAll) {
    exportParams.set('show_all', 'true');
  } else {
    exportParams.set('start_date', startDate);
    exportParams.set('end_date', endDate);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Link href="/banks" className="hover:text-foreground transition-colors">البنوك</Link>
        <ChevronRight className="h-4 w-4" />
        <span className="text-foreground font-medium">{account.account_name}</span>
      </div>

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h1 className="text-2xl font-bold">كشف حساب</h1>
          <div className="flex items-center gap-4 mt-2 text-muted-foreground">
            <p>البنك: {account.bank_name}</p>
            <p>رقم الحساب: {account.account_number}</p>
          </div>
          <p className="text-2xl font-black mt-4 text-primary">{formatMoney(account.current_balance)}</p>
        </div>

        <div className="flex gap-2 flex-wrap">
          <AdjustmentModal accountId={accountId} />
          <TransferModal banks={banks} currentAccountId={accountId} />
          <a
            href={`/api/banks/transactions/export?${exportParams.toString()}`}
            className="text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap"
          >
            <FileDown className="w-4 h-4" /> تصدير إلى Excel
          </a>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-card p-5 rounded-lg border shadow-sm">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-1">
            <ArrowDownLeft className="w-4 h-4 text-emerald-500" /> إجمالي الإيداعات (للفترة المحددة)
          </div>
          <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">+{formatMoney(totalIn)}</p>
        </div>
        <div className="bg-card p-5 rounded-lg border shadow-sm">
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground mb-1">
            <ArrowUpRight className="w-4 h-4 text-rose-500" /> إجمالي المسحوبات (للفترة المحددة)
          </div>
          <p className="text-2xl font-black text-rose-600 dark:text-rose-400">-{formatMoney(totalOut)}</p>
        </div>
      </div>

      <AccountStatementFilters
        accountId={accountId}
        startDate={startDate}
        endDate={endDate}
        showAll={isShowAll}
      />

      <div className="bg-card rounded-lg border shadow-sm overflow-x-auto">
        <table className="w-full text-sm text-right">
          <thead className="bg-muted/50 border-b whitespace-nowrap">
            <tr>
              <th className="p-4 font-medium">التاريخ</th>
              <th className="p-4 font-medium">التصنيف</th>
              <th className="p-4 font-medium">لمن / من</th>
              <th className="p-4 font-medium">البيان</th>
              <th className="p-4 font-medium">المبلغ</th>
              <th className="p-4 font-medium">بواسطة</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {items.map((entry: any) => (
              <tr key={entry.id} className="hover:bg-muted/30 transition-colors">
                <td className="p-4 whitespace-nowrap">{entry.entry_date}</td>
                <td className="p-4">
                  <span className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-secondary-foreground whitespace-nowrap">
                    {categoryMap[entry.category] || entry.category}
                  </span>
                </td>
                <td className="p-4 whitespace-nowrap">
                  {entry.counterparty_name ? (
                    <div className="flex flex-col">
                      <span className="text-xs text-muted-foreground">{counterpartyTypeMap[entry.counterparty_type] || entry.counterparty_type}</span>
                      {entry.counterparty_type === 'vendor' ? (
                        <Link href={`/vendors/${entry.counterparty_id}/statement`} className="font-medium hover:text-primary hover:underline">{entry.counterparty_name}</Link>
                      ) : entry.counterparty_type === 'owner' ? (
                        <Link href={`/settings/owners/${entry.counterparty_id}/statement`} className="font-medium hover:text-primary hover:underline">{entry.counterparty_name}</Link>
                      ) : entry.counterparty_type === 'employee' ? (
                        <Link href={`/employees/${entry.counterparty_id}`} className="font-medium hover:text-primary hover:underline">{entry.counterparty_name}</Link>
                      ) : (
                        <span className="font-medium">{entry.counterparty_name}</span>
                      )}
                    </div>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </td>
                <td className="p-4 max-w-[280px] truncate" title={entry.memo || ''}>
                  {entry.memo || '-'}
                </td>
                <td className={`p-4 font-bold whitespace-nowrap ${entry.direction === 'in' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                  {entry.direction === 'in' ? '+' : '-'}{formatMoney(entry.amount)}
                </td>
                <td className="p-4 text-muted-foreground whitespace-nowrap">
                  {entry.created_by_name || '-'}
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">
                  لا توجد معاملات مطابقة لخيارات التصفية المحددة
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {totalCount > items.length && (
        <p className="text-xs text-muted-foreground text-center">
          المعروض {items.length} من أصل {totalCount} معاملة مطابقة للتصفية الحالية. ضيّق نطاق التاريخ لرؤية نتائج أدق.
        </p>
      )}
    </div>
  );
}
