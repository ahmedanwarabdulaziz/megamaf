'use client';

import { useMemo } from 'react';

interface Category { id: string; name: string; parent_id: string | null; }

export function CategoryFields({
  categories,
  mainCatId,
  subCatId,
  onMainChange,
  onSubChange,
}: {
  categories: Category[];
  mainCatId: string;
  subCatId: string;
  onMainChange: (id: string) => void;
  onSubChange: (id: string) => void;
}) {
  const mains = useMemo(() => categories.filter(c => !c.parent_id), [categories]);
  const subs = useMemo(() => categories.filter(c => c.parent_id === mainCatId), [categories, mainCatId]);

  return (
    <>
      <div>
        <label className="block text-sm font-medium mb-1">الفئة الرئيسية</label>
        <select
          required
          value={mainCatId}
          onChange={e => onMainChange(e.target.value)}
          className="w-full p-2 rounded border bg-background"
        >
          <option value="">اختر الفئة...</option>
          {mains.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {subs.length > 0 && (
        <div>
          <label className="block text-sm font-medium mb-1">الفئة الفرعية</label>
          <select
            required
            value={subCatId}
            onChange={e => onSubChange(e.target.value)}
            className="w-full p-2 rounded border bg-background"
          >
            <option value="">اختر الفئة الفرعية...</option>
            {subs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
      )}
    </>
  );
}
