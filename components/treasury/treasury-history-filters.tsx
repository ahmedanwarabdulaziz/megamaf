'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

export function TreasuryHistoryFilters({
  vendors,
  projects,
  selectedVendorId,
  selectedProjectId,
  startDate,
  endDate,
  showAll
}: {
  vendors: any[];
  projects: any[];
  selectedVendorId: string;
  selectedProjectId: string;
  startDate: string;
  endDate: string;
  showAll: boolean;
}) {
  const router = useRouter();
  const [vendor, setVendor] = useState(selectedVendorId);
  const [project, setProject] = useState(selectedProjectId);
  const [start, setStart] = useState(startDate);
  const [end, setEnd] = useState(endDate);
  const [isAll, setIsAll] = useState(showAll);

  const handleSearch = () => {
    const params = new URLSearchParams({ tab: 'payables' });
    if (vendor) params.set('vendor_id', vendor);
    if (project) params.set('project_id', project);
    if (isAll) {
      params.set('show_all', 'true');
    } else {
      if (start) params.set('start_date', start);
      if (end) params.set('end_date', end);
    }
    router.push(`/treasury?${params.toString()}`);
  };

  const handleToggleShowAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsAll(e.target.checked);
  };

  return (
    <div className="bg-muted/30 p-4 rounded-lg border shadow-sm flex flex-wrap gap-4 items-end mb-4">
      <div className="flex-1 min-w-[200px]">
        <label className="block text-sm font-medium mb-1">المقاول</label>
        <select 
          value={vendor} 
          onChange={e => setVendor(e.target.value)} 
          className="w-full p-2 rounded-md border bg-background"
        >
          <option value="">كل المقاولين</option>
          {vendors.map(v => (
            <option key={v.id} value={v.id}>{v.name}</option>
          ))}
        </select>
      </div>
      <div className="flex-1 min-w-[150px]">
        <label className="block text-sm font-medium mb-1">المشروع</label>
        <select 
          value={project} 
          onChange={e => setProject(e.target.value)} 
          className="w-full p-2 rounded-md border bg-background"
        >
          <option value="">كل المشاريع</option>
          {projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
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
          onChange={handleToggleShowAll}
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
