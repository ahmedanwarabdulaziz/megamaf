'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search } from 'lucide-react';
import { formatMoney } from '@/lib/money';

export function VendorPayablesTable({ vendors }: { vendors: any[] }) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return vendors;
    return vendors.filter((v: any) => (v.vendor_name || '').toLowerCase().includes(needle));
  }, [vendors, search]);

  return (
    <div className="space-y-3">
      <div className="relative max-w-sm">
        <Search className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="بحث باسم المقاول..."
          className="w-full p-2 pr-9 rounded-md border bg-background text-sm"
        />
      </div>

      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <table className="w-full text-sm text-right">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="p-4 font-medium">المقاول</th>
              <th className="p-4 font-medium text-muted-foreground">إجمالي الأعمال التراكمي</th>
              <th className="p-4 font-medium text-amber-600">المحتجز التراكمي (تأمين)</th>
              <th className="p-4 font-medium">الصافي التراكمي (قابل للدفع)</th>
              <th className="p-4 font-medium text-green-600">المدفوع</th>
              <th className="p-4 font-medium text-primary">المتبقي المستحق</th>
              <th className="p-4 font-medium w-32"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.map((v: any) => {
              const grossTotal    = Number(v.gross_total          || 0);
              const retention     = Number(v.total_retention_held || 0);
              const netCumulative = Number(v.total_due            || 0);
              const totalPaid     = Number(v.total_paid           || 0);
              const rawRemaining  = netCumulative - totalPaid; // negative = vendor was overpaid
              const remaining     = Math.max(0, rawRemaining);
              const overpaid      = rawRemaining < 0 ? Math.abs(rawRemaining) : 0;
              return (
                <tr key={v.vendor_id} className="hover:bg-muted/30 transition-colors">
                  <td className="p-4 font-semibold">{v.vendor_name}</td>
                  <td className="p-4">{formatMoney(grossTotal)}</td>
                  <td className="p-4 text-amber-600">
                    {retention > 0 ? `- ${formatMoney(retention)}` : '-'}
                  </td>
                  <td className="p-4 font-medium">{formatMoney(netCumulative)}</td>
                  <td className="p-4 text-green-700">
                    {totalPaid > 0 ? `- ${formatMoney(totalPaid)}` : '-'}
                  </td>
                  <td className="p-4">
                    <span className={`font-bold ${remaining <= 0 ? 'text-green-600' : 'text-primary'}`}>
                      {remaining <= 0 ? '✓ مسدد' : formatMoney(remaining)}
                    </span>
                    {overpaid > 0 && (
                      <div className="text-xs text-amber-600 mt-0.5 whitespace-nowrap">
                        له رصيد زائد: {formatMoney(overpaid)}
                      </div>
                    )}
                  </td>
                  <td className="p-4">
                    <Link href={`/vendors/${v.vendor_id}/statement`} className="text-xs bg-secondary text-secondary-foreground hover:bg-secondary/80 px-3 py-1.5 rounded-md font-medium">كشف حساب</Link>
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted-foreground">
                  {search ? 'لا يوجد مقاولون مطابقون للبحث' : 'لا يوجد مقاولون بأرصدة مستحقة'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
