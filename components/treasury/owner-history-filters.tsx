'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

export function OwnerHistoryFilters({
  owners,
  projects,
  selectedOwnerId,
  selectedProjectId,
  startDate,
  endDate,
  showAll
}: {
  owners: any[];
  projects: any[];
  selectedOwnerId: string;
  selectedProjectId: string;
  startDate: string;
  endDate: string;
  showAll: boolean;
}) {
  const router = useRouter();
  const [owner, setOwner] = useState(selectedOwnerId);
  const [project, setProject] = useState(selectedProjectId);
  const [start, setStart] = useState(startDate);
  const [end, setEnd] = useState(endDate);
  const [isAll, setIsAll] = useState(showAll);

  const handleSearch = () => {
    const params = new URLSearchParams({ tab: 'receivables' });
    if (owner) params.set('owner_id', owner);
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
        <label className="block text-sm font-medium mb-1">المالك</label>
        <select 
          value={owner} 
          onChange={e => setOwner(e.target.value)} 
          className="w-full p-2 rounded-md border bg-background"
        >
          <option value="">كل الملاك</option>
          {owners.map(o => (
            <option key={o.id} value={o.id}>{o.name}</option>
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
          id="showAllOwner" 
          checked={isAll}
          onChange={handleToggleShowAll}
          className="w-4 h-4 rounded border-gray-300 text-primary"
        />
        <label htmlFor="showAllOwner" className="text-sm font-medium">عرض الكل (بدون تاريخ)</label>
      </div>

      <Button onClick={handleSearch} className="w-full sm:w-auto">
        <Search className="w-4 h-4 ml-2" /> تصفية
      </Button>
    </div>
  );
}
