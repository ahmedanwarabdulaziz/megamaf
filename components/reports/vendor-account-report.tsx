'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';
import { formatMoney } from '@/lib/money';

export function VendorAccountReport({ 
  vendors, 
  data, 
  selectedVendorId 
}: { 
  vendors: any[], 
  data: any,
  selectedVendorId: string 
}) {
  const router = useRouter();
  const [vendor, setVendor] = useState(selectedVendorId);

  const handleSearch = () => {
    if (vendor) router.push(`/reports/vendor-account?vendor_id=${vendor}`);
  };

  return (
    <div className="space-y-6">
      <div className="bg-card p-4 rounded-lg border shadow-sm flex flex-wrap gap-4 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-sm font-medium mb-1">المقاول / المورد</label>
          <select 
            value={vendor} 
            onChange={e => setVendor(e.target.value)} 
            className="w-full p-2 rounded border bg-background"
          >
            <option value="">-- اختر المورد --</option>
            {vendors.map(v => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </div>
        <Button onClick={handleSearch} disabled={!vendor}>
          <Search className="w-4 h-4 ml-2" /> عرض التقرير
        </Button>
      </div>

      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-card p-6 rounded-lg border shadow-sm">
            <h3 className="text-sm font-medium text-muted-foreground mb-1">إجمالي الفواتير والمستخلصات</h3>
            <p className="text-2xl font-bold">{formatMoney(data.total_billed)}</p>
          </div>
          <div className="bg-card p-6 rounded-lg border shadow-sm">
            <h3 className="text-sm font-medium text-muted-foreground mb-1">إجمالي المدفوع نقداً</h3>
            <p className="text-2xl font-bold text-green-600">{formatMoney(data.total_paid)}</p>
          </div>
          <div className="bg-card p-6 rounded-lg border shadow-sm">
            <h3 className="text-sm font-medium text-muted-foreground mb-1">المحتجزات (تأمين)</h3>
            <p className="text-2xl font-bold text-amber-600">{formatMoney(data.total_retained)}</p>
          </div>
          <div className="bg-card p-6 rounded-lg border shadow-sm">
            <h3 className="text-sm font-medium text-muted-foreground mb-1">الرصيد المتبقي له</h3>
            <p className={`text-2xl font-bold ${data.net_remaining > 0 ? 'text-red-600' : data.net_remaining < 0 ? 'text-green-600' : ''}`}>
              {formatMoney(data.net_remaining)}
            </p>
            {data.net_remaining < 0 && <p className="text-xs text-green-600 mt-1">(رصيد دائن للمورد)</p>}
          </div>
        </div>
      )}
    </div>
  );
}
