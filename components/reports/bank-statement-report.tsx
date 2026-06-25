'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Download, Search } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import { exportToCsv } from '@/lib/export';

export function BankStatementReport({ 
  accounts, 
  data, 
  selectedAccountId,
  dateFrom,
  dateTo,
  openingBalance
}: { 
  accounts: any[], 
  data: any[],
  selectedAccountId: string,
  dateFrom: string,
  dateTo: string,
  openingBalance: number
}) {
  const router = useRouter();
  const [account, setAccount] = useState(selectedAccountId);
  const [from, setFrom] = useState(dateFrom);
  const [to, setTo] = useState(dateTo);

  const handleSearch = () => {
    const params = new URLSearchParams();
    if (account) params.set('account_id', account);
    if (from) params.set('date_from', from);
    if (to) params.set('date_to', to);
    router.push(`/reports/bank-statement?${params.toString()}`);
  };

  const handleExport = () => {
    const selected = accounts.find(a => a.bank_account_id === account);
    const exportData = data.map(row => ({
      'التاريخ': row.entry_date,
      'الوارد': row.amount_in,
      'المنصرف': row.amount_out,
      'الرصيد بعد الحركة': row.balance_after,
      'التصنيف': row.category,
      'الملاحظات': row.memo
    }));
    
    // Add opening balance as first row
    exportData.unshift({
        'التاريخ': '-',
        'الوارد': 0,
        'المنصرف': 0,
        'الرصيد بعد الحركة': openingBalance,
        'التصنيف': 'opening_balance',
        'الملاحظات': 'الرصيد الافتتاحي'
    });

    exportToCsv(`كشف_حساب_${selected?.account_name || 'بنك'}`, exportData);
  };

  return (
    <div className="space-y-6">
      <div className="bg-card p-4 rounded-lg border shadow-sm flex flex-wrap gap-4 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-sm font-medium mb-1">الحساب البنكي</label>
          <select 
            value={account} 
            onChange={e => setAccount(e.target.value)} 
            className="w-full p-2 rounded border bg-background"
          >
            <option value="">-- اختر الحساب --</option>
            {accounts.map((a: any) => (
              <option key={a.bank_account_id} value={a.bank_account_id}>
                {a.bank_name} - {a.account_name} ({formatMoney(a.current_balance)})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">من تاريخ</label>
          <input 
            type="date" 
            value={from} 
            onChange={e => setFrom(e.target.value)} 
            className="w-full p-2 rounded border bg-background" 
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">إلى تاريخ</label>
          <input 
            type="date" 
            value={to} 
            onChange={e => setTo(e.target.value)} 
            className="w-full p-2 rounded border bg-background" 
          />
        </div>
        <Button onClick={handleSearch} disabled={!account}>
          <Search className="w-4 h-4 ml-2" /> عرض التقرير
        </Button>
        {data.length > 0 && (
          <Button variant="outline" onClick={handleExport}>
            <Download className="w-4 h-4 ml-2" /> تصدير CSV
          </Button>
        )}
      </div>

      {account && (
        <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right whitespace-nowrap">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="p-3 font-medium">التاريخ</th>
                  <th className="p-3 font-medium">الوارد</th>
                  <th className="p-3 font-medium">المنصرف</th>
                  <th className="p-3 font-medium">الرصيد بعد الحركة</th>
                  <th className="p-3 font-medium">التصنيف</th>
                  <th className="p-3 font-medium w-1/3">البيان</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(!dateFrom || data.length > 0) && (
                    <tr className="bg-muted/10 font-medium">
                        <td className="p-3">-</td>
                        <td className="p-3">-</td>
                        <td className="p-3">-</td>
                        <td className="p-3 text-primary">{formatMoney(openingBalance)}</td>
                        <td className="p-3">الرصيد الافتتاحي</td>
                        <td className="p-3">رصيد أول المدة أو قبل الفترة المحددة</td>
                    </tr>
                )}
                
                {data.map((row: any) => (
                  <tr key={row.ledger_id} className="hover:bg-muted/30">
                    <td className="p-3">{new Date(row.entry_date).toLocaleDateString('ar-EG')}</td>
                    <td className="p-3 font-medium text-green-600">{row.amount_in ? formatMoney(row.amount_in) : '-'}</td>
                    <td className="p-3 font-medium text-red-600">{row.amount_out ? formatMoney(row.amount_out) : '-'}</td>
                    <td className="p-3 font-bold">{formatMoney(row.balance_after)}</td>
                    <td className="p-3 text-xs text-muted-foreground">{row.category}</td>
                    <td className="p-3 whitespace-normal break-words">{row.memo}</td>
                  </tr>
                ))}
                
                {data.length === 0 && account && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground">لا توجد حركات في هذه الفترة</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
