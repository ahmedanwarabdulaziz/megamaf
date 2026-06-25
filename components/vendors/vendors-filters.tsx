'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

export function VendorsFilters({
  projects,
  selectedProjectId,
  selectedKind,
  searchQuery,
  startDate,
  endDate,
  showAll
}: {
  projects: any[];
  selectedProjectId: string;
  selectedKind: string;
  searchQuery: string;
  startDate: string;
  endDate: string;
  showAll: boolean;
}) {
  const router = useRouter();
  const [project, setProject] = useState(selectedProjectId);
  const [kind, setKind] = useState(selectedKind);
  const [search, setSearch] = useState(searchQuery);
  const [start, setStart] = useState(startDate);
  const [end, setEnd] = useState(endDate);
  const [isAll, setIsAll] = useState(showAll);

  const handleSearch = () => {
    const params = new URLSearchParams();
    if (project) params.set('project_id', project);
    if (kind) params.set('kind', kind);
    if (search) params.set('search', search);
    
    if (isAll) {
      params.set('show_all', 'true');
    } else {
      if (start) params.set('start_date', start);
      if (end) params.set('end_date', end);
    }
    
    router.push(`/vendors?${params.toString()}`);
  };

  const handleToggleShowAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsAll(e.target.checked);
  };

  return (
    <div className="bg-muted/30 p-4 rounded-lg border shadow-sm flex flex-wrap gap-4 items-end mb-6">
      <div className="flex-1 min-w-[150px]">
        <label className="block text-sm font-medium mb-1">الاسم / بحث</label>
        <Input 
          type="text" 
          placeholder="ابحث باسم المقاول أو المورد..." 
          value={search} 
          onChange={e => setSearch(e.target.value)} 
        />
      </div>

      <div className="flex-1 min-w-[150px]">
        <label className="block text-sm font-medium mb-1">النوع</label>
        <select 
          value={kind} 
          onChange={e => setKind(e.target.value)} 
          className="w-full p-2 rounded-md border bg-background"
        >
          <option value="">الكل</option>
          <option value="contractor">مقاول</option>
          <option value="supplier">مورد</option>
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
          id="showAllVendors" 
          checked={isAll}
          onChange={handleToggleShowAll}
          className="w-4 h-4 rounded border-gray-300 text-primary"
        />
        <label htmlFor="showAllVendors" className="text-sm font-medium">عرض إجمالي الرصيد (بدون تاريخ)</label>
      </div>

      <Button onClick={handleSearch} className="w-full sm:w-auto">
        <Search className="w-4 h-4 ml-2" /> بحث
      </Button>
    </div>
  );
}
