'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

export function InventoryFilters({
  warehouses,
  selectedWarehouseId,
  searchQuery,
}: {
  warehouses: any[];
  selectedWarehouseId: string;
  searchQuery: string;
}) {
  const router = useRouter();
  const [warehouse, setWarehouse] = useState(selectedWarehouseId);
  const [search, setSearch] = useState(searchQuery);

  const handleSearch = () => {
    const params = new URLSearchParams();
    if (warehouse) params.set('warehouse_id', warehouse);
    if (search) params.set('search', search);
    
    router.push(`/inventory?${params.toString()}`);
  };

  return (
    <div className="bg-card p-4 rounded-lg border shadow-sm flex flex-wrap gap-4 items-end mb-6">
      <div className="flex-1 min-w-[200px] max-w-sm">
        <label className="block text-sm font-medium mb-1 text-muted-foreground">المستودع</label>
        <select 
          value={warehouse} 
          onChange={e => setWarehouse(e.target.value)} 
          className="w-full h-10 px-3 rounded-md border bg-background"
        >
          <option value="">كل المستودعات</option>
          {warehouses.map(w => (
            <option key={w.id} value={w.id}>{w.name} {w.projects ? `(${w.projects.name})` : '(رئيسي)'}</option>
          ))}
        </select>
      </div>

      <div className="flex-1 min-w-[200px] max-w-sm">
        <label className="block text-sm font-medium mb-1 text-muted-foreground">بحث عن صنف (اسم أو كود)</label>
        <Input 
          value={search} 
          onChange={e => setSearch(e.target.value)} 
          placeholder="ابحث هنا..."
          onKeyDown={e => e.key === 'Enter' && handleSearch()}
        />
      </div>

      <Button onClick={handleSearch} className="w-full sm:w-auto h-10">
        <Search className="w-4 h-4 ml-2" /> تصفية
      </Button>
    </div>
  );
}
