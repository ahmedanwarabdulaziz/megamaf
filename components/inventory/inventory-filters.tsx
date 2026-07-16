'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

interface Category { id: string; name: string; parent_id: string | null; }

export function InventoryFilters({
  warehouses,
  categories,
  selectedWarehouseId,
  selectedCategoryId,
  searchQuery,
}: {
  warehouses: any[];
  categories: Category[];
  selectedWarehouseId: string;
  selectedCategoryId: string;
  searchQuery: string;
}) {
  const router = useRouter();
  const [warehouse, setWarehouse] = useState(selectedWarehouseId);
  const [category, setCategory] = useState(selectedCategoryId);
  const [search, setSearch] = useState(searchQuery);

  const mainCategories = categories.filter(c => !c.parent_id);

  const handleSearch = () => {
    const params = new URLSearchParams();
    if (warehouse) params.set('warehouse_id', warehouse);
    if (category) params.set('category_id', category);
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

      <div className="flex-1 min-w-[180px] max-w-sm">
        <label className="block text-sm font-medium mb-1 text-muted-foreground">الفئة</label>
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="w-full h-10 px-3 rounded-md border bg-background"
        >
          <option value="">كل الفئات</option>
          {mainCategories.map(main => {
            const subs = categories.filter(c => c.parent_id === main.id);
            return (
              <optgroup key={main.id} label={main.name}>
                <option value={main.id}>{main.name} — الكل</option>
                {subs.map(sub => <option key={sub.id} value={sub.id}>{sub.name}</option>)}
              </optgroup>
            );
          })}
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
