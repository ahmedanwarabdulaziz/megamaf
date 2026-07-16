'use client';

import { useRouter } from 'next/navigation';

interface Category { id: string; name: string; parent_id: string | null; }

export function CategoryFilter({ categories, selectedId }: { categories: Category[]; selectedId: string }) {
  const router = useRouter();
  const mains = categories.filter(c => !c.parent_id);

  return (
    <select
      value={selectedId}
      onChange={e => {
        const params = new URLSearchParams();
        if (e.target.value) params.set('category_id', e.target.value);
        router.push(`/inventory/items${params.size ? `?${params.toString()}` : ''}`);
      }}
      className="h-9 px-3 rounded-md border bg-background text-sm"
    >
      <option value="">كل الفئات</option>
      {mains.map(main => {
        const subs = categories.filter(c => c.parent_id === main.id);
        return (
          <optgroup key={main.id} label={main.name}>
            <option value={main.id}>{main.name} — الكل</option>
            {subs.map(sub => <option key={sub.id} value={sub.id}>{sub.name}</option>)}
          </optgroup>
        );
      })}
    </select>
  );
}
