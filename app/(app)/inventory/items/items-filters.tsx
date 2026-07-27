'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';

interface Category { id: string; name: string; parent_id: string | null; }

export function ItemsFilters({
  categories,
  selectedCategoryId,
  searchQuery,
}: {
  categories: Category[];
  selectedCategoryId: string;
  searchQuery: string;
}) {
  const router = useRouter();
  const [category, setCategory] = useState(selectedCategoryId);
  const [search, setSearch] = useState(searchQuery);

  const mainCategories = categories.filter(c => !c.parent_id);

  const applyFilters = () => {
    const params = new URLSearchParams();
    if (category) params.set('category_id', category);
    if (search) params.set('search', search);
    router.push(`/inventory/items${params.size ? `?${params.toString()}` : ''}`);
  };

  return (
    <div className="bg-card p-4 rounded-lg border shadow-sm flex flex-wrap gap-4 items-end">
      <div className="flex-1 min-w-[200px] max-w-sm">
        <label className="block text-sm font-medium mb-1 text-muted-foreground">بحث عن صنف (اسم أو كود)</label>
        <Input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="ابحث هنا..."
          onKeyDown={e => e.key === 'Enter' && applyFilters()}
        />
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

      <Button onClick={applyFilters} className="w-full sm:w-auto h-10">
        <Search className="w-4 h-4 ml-2" /> تصفية
      </Button>
    </div>
  );
}
