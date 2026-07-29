'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';

export function StatementMonthFilter() {
  const router = useRouter();
  const searchParams = useSearchParams();
  
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();

  const initialMonth = searchParams.get('month') || currentMonth.toString();
  const initialYear = searchParams.get('year') || currentYear.toString();

  const [month, setMonth] = useState(initialMonth.padStart(2, '0'));
  const [year, setYear] = useState(initialYear);

  // Allow showing all if user wants to clear filters
  const [showAll, setShowAll] = useState(searchParams.get('show_all') === 'true');

  const handleSearch = () => {
    const params = new URLSearchParams(searchParams.toString());
    if (showAll) {
      params.set('show_all', 'true');
      params.delete('month');
      params.delete('year');
    } else {
      params.delete('show_all');
      params.set('month', month);
      params.set('year', year);
    }
    router.push(`?${params.toString()}`);
  };

  const handleToggleShowAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    setShowAll(e.target.checked);
  };

  const years = Array.from({ length: 5 }, (_, i) => currentYear - i);
  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  return (
    <div className="bg-muted/30 p-4 rounded-lg border shadow-sm flex flex-wrap gap-4 items-end mb-4">
      {!showAll && (
        <>
          <div className="flex-1 min-w-[120px]">
            <label className="block text-sm font-medium mb-1">الشهر</label>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-full p-2 rounded-md border bg-background"
            >
              {months.map((m) => {
                const val = m.toString().padStart(2, '0');
                return (
                  <option key={val} value={val}>
                    {val}
                  </option>
                );
              })}
            </select>
          </div>
          <div className="flex-1 min-w-[120px]">
            <label className="block text-sm font-medium mb-1">السنة</label>
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="w-full p-2 rounded-md border bg-background"
            >
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      <div className="flex items-center gap-2 mb-2 px-2">
        <input
          type="checkbox"
          id="showAllStatement"
          checked={showAll}
          onChange={handleToggleShowAll}
          className="w-4 h-4 rounded border-gray-300 text-primary"
        />
        <label htmlFor="showAllStatement" className="text-sm font-medium">عرض الكل</label>
      </div>

      <Button onClick={handleSearch} className="w-full sm:w-auto">
        <Search className="w-4 h-4 ml-2" /> تصفية
      </Button>
    </div>
  );
}
