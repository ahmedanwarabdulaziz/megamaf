'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';

export function AllTransactionsFilters({
  accounts,
  selectedAccountId,
  startDate,
  endDate,
  showAll,
}: {
  accounts: { bank_account_id: string; account_name: string; bank_name: string }[];
  selectedAccountId: string;
  startDate: string;
  endDate: string;
  showAll: boolean;
}) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(selectedAccountId);
  const [start, setStart] = useState(startDate);
  const [end, setEnd] = useState(endDate);
  const [isAll, setIsAll] = useState(showAll);

  const handleSearch = () => {
    const params = new URLSearchParams();
    if (accountId) params.set('account_id', accountId);
    if (isAll) {
      params.set('show_all', 'true');
    } else {
      if (start) params.set('start_date', start);
      if (end) params.set('end_date', end);
    }
    router.push(`/banks/transactions?${params.toString()}`);
  };

  return (
    <div className="bg-muted/30 p-4 rounded-lg border shadow-sm flex flex-wrap gap-4 items-end mb-4">
      <div className="flex-1 min-w-[220px]">
        <label className="block text-sm font-medium mb-1">الحساب البنكي</label>
        <select
          value={accountId}
          onChange={e => setAccountId(e.target.value)}
          className="w-full p-2 rounded-md border bg-background"
        >
          <option value="">كل الحسابات</option>
          {accounts.map(a => (
            <option key={a.bank_account_id} value={a.bank_account_id}>
              {a.bank_name} - {a.account_name}
            </option>
          ))}
        </select>
      </div>

      {!isAll && (
        <>
          <div className="flex-1 min-w-[140px]">
            <label className="block text-sm font-medium mb-1">من تاريخ</label>
            <Input type="date" value={start} onChange={e => setStart(e.target.value)} />
          </div>
          <div className="flex-1 min-w-[140px]">
            <label className="block text-sm font-medium mb-1">إلى تاريخ</label>
            <Input type="date" value={end} onChange={e => setEnd(e.target.value)} />
          </div>
        </>
      )}

      <div className="flex items-center gap-2 mb-2 px-2">
        <input
          type="checkbox"
          id="showAll"
          checked={isAll}
          onChange={e => setIsAll(e.target.checked)}
          className="w-4 h-4 rounded border-gray-300 text-primary"
        />
        <label htmlFor="showAll" className="text-sm font-medium">عرض الكل (بدون تاريخ)</label>
      </div>

      <Button onClick={handleSearch} className="w-full sm:w-auto">
        <Search className="w-4 h-4 ml-2" /> تصفية
      </Button>
    </div>
  );
}
