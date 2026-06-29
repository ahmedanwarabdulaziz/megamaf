'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

export function AllExpensesFilters({
  employees,
  projects,
  categories,
  selectedEmployeeId,
  selectedProjectId,
  selectedCategoryId,
  selectedStatus,
  startDate,
  endDate,
  showAll,
  basePath,
  activeTab,
  hideEmployeeFilter
}: {
  employees: any[];
  projects: any[];
  categories: any[];
  selectedEmployeeId: string;
  selectedProjectId: string;
  selectedCategoryId: string;
  selectedStatus?: string;
  startDate: string;
  endDate: string;
  showAll: boolean;
  basePath?: string;
  activeTab?: string;
  hideEmployeeFilter?: boolean;
}) {
  const router = useRouter();
  const [employee, setEmployee] = useState(selectedEmployeeId);
  const [project, setProject] = useState(selectedProjectId);
  const [category, setCategory] = useState(selectedCategoryId);
  const [status, setStatus] = useState(selectedStatus || '');
  const [start, setStart] = useState(startDate);
  const [end, setEnd] = useState(endDate);
  const [isAll, setIsAll] = useState(showAll);

  const handleSearch = () => {
    const params = new URLSearchParams();
    if (activeTab) params.set('tab', activeTab);
    if (!hideEmployeeFilter && employee) params.set('employee_id', employee);
    if (project) params.set('project_id', project);
    if (category) params.set('category_id', category);
    if (status) params.set('status', status);
    
    if (isAll) {
      params.set('show_all', 'true');
    } else {
      if (start) params.set('start_date', start);
      if (end) params.set('end_date', end);
    }
    const path = basePath || '/expenses';
    router.push(`${path}?${params.toString()}`);
  };

  const handleToggleShowAll = (e: React.ChangeEvent<HTMLInputElement>) => {
    setIsAll(e.target.checked);
  };

  return (
    <div className="bg-muted/30 p-4 rounded-lg border shadow-sm flex flex-wrap gap-4 items-end mb-4">
      {!hideEmployeeFilter && (
        <div className="flex-1 min-w-[200px]">
          <label className="block text-sm font-medium mb-1">الموظف</label>
          <select 
            value={employee} 
            onChange={e => setEmployee(e.target.value)} 
            className="w-full p-2 rounded-md border bg-background"
          >
            <option value="">كل الموظفين</option>
            {employees.map(e => (
              <option key={e.id} value={e.id}>{e.full_name}</option>
            ))}
          </select>
        </div>
      )}

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

      <div className="flex-1 min-w-[150px]">
        <label className="block text-sm font-medium mb-1">بند الصرف</label>
        <select 
          value={category} 
          onChange={e => setCategory(e.target.value)} 
          className="w-full p-2 rounded-md border bg-background"
        >
          <option value="">كل البنود</option>
          {categories.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      <div className="flex-1 min-w-[150px]">
        <label className="block text-sm font-medium mb-1">الحالة</label>
        <select 
          value={status} 
          onChange={e => setStatus(e.target.value)} 
          className="w-full p-2 rounded-md border bg-background"
        >
          <option value="">الكل</option>
          <option value="pending">قيد المراجعة</option>
          <option value="approved">معتمد</option>
          <option value="rejected">مرفوض</option>
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
          id="showAllExp" 
          checked={isAll}
          onChange={handleToggleShowAll}
          className="w-4 h-4 rounded border-gray-300 text-primary"
        />
        <label htmlFor="showAllExp" className="text-sm font-medium">عرض الكل (بدون تاريخ)</label>
      </div>

      <Button onClick={handleSearch} className="w-full sm:w-auto">
        <Search className="w-4 h-4 ml-2" /> تصفية
      </Button>
    </div>
  );
}
