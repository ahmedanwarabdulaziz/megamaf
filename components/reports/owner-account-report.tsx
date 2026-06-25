'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';
import { formatMoney } from '@/lib/money';

export function OwnerAccountReport({ 
  owners, 
  data, 
  selectedOwnerId 
}: { 
  owners: any[], 
  data: any,
  selectedOwnerId: string 
}) {
  const router = useRouter();
  const [owner, setOwner] = useState(selectedOwnerId);

  const handleSearch = () => {
    if (owner) router.push(`/reports/owner-account?owner_id=${owner}`);
  };

  return (
    <div className="space-y-6">
      <div className="bg-card p-4 rounded-lg border shadow-sm flex flex-wrap gap-4 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-sm font-medium mb-1">المالك / الجهة</label>
          <select 
            value={owner} 
            onChange={e => setOwner(e.target.value)} 
            className="w-full p-2 rounded border bg-background"
          >
            <option value="">-- اختر المالك --</option>
            {owners.map(o => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
        </div>
        <Button onClick={handleSearch} disabled={!owner}>
          <Search className="w-4 h-4 ml-2" /> عرض التقرير
        </Button>
      </div>

      {data && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="bg-card p-6 rounded-lg border shadow-sm">
            <h3 className="text-sm font-medium text-muted-foreground mb-1">إجمالي المستحق على المالك</h3>
            <p className="text-2xl font-bold">{formatMoney(data.total_billed)}</p>
            <p className="text-xs text-muted-foreground mt-1">مستخلصات المالك المعتمدة + الدفعات المجدولة</p>
          </div>
          <div className="bg-card p-6 rounded-lg border shadow-sm">
            <h3 className="text-sm font-medium text-muted-foreground mb-1">إجمالي المقبوض منه</h3>
            <p className="text-2xl font-bold text-green-600">{formatMoney(data.total_paid)}</p>
          </div>
          <div className="bg-card p-6 rounded-lg border shadow-sm">
            <h3 className="text-sm font-medium text-muted-foreground mb-1">المحتجزات لنا (تأمين)</h3>
            <p className="text-2xl font-bold text-amber-600">{formatMoney(data.total_retained)}</p>
          </div>
          <div className="bg-card p-6 rounded-lg border shadow-sm">
            <h3 className="text-sm font-medium text-muted-foreground mb-1">الرصيد المتبقي عليه</h3>
            <p className={`text-2xl font-bold ${data.net_remaining > 0 ? 'text-red-600' : data.net_remaining < 0 ? 'text-green-600' : ''}`}>
              {formatMoney(data.net_remaining)}
            </p>
            {data.net_remaining < 0 && <p className="text-xs text-green-600 mt-1">(المالك دافع بزيادة)</p>}
          </div>
        </div>
      )}
    </div>
  );
}
