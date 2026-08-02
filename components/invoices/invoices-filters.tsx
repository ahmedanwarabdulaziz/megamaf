'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Search, SlidersHorizontal, ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { cn } from '@/lib/utils';

export function InvoicesFilters({
  projects,
  vendors,
  selectedProjectId,
  selectedVendorId,
  selectedStatus,
  searchQuery,
  startDate,
  endDate,
  basePath,
  activeTab,
  showStatusFilter = true,
}: {
  projects: any[];
  vendors: any[];
  selectedProjectId: string;
  selectedVendorId: string;
  selectedStatus: string;
  searchQuery: string;
  startDate: string;
  endDate: string;
  basePath?: string;
  activeTab?: string;
  showStatusFilter?: boolean;
}) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [project, setProject] = useState(selectedProjectId);
  const [vendor, setVendor] = useState(selectedVendorId);
  const [status, setStatus] = useState(selectedStatus);
  const [search, setSearch] = useState(searchQuery);
  const [start, setStart] = useState(startDate);
  const [end, setEnd] = useState(endDate);

  const activeFilterCount = [project, vendor, showStatusFilter ? status : '', search, start, end].filter(Boolean).length;

  const handleSearch = () => {
    const params = new URLSearchParams();
    if (activeTab) params.set('tab', activeTab);
    if (project) params.set('project_id', project);
    if (vendor) params.set('vendor_id', vendor);
    if (showStatusFilter && status) params.set('status', status);
    if (search) params.set('search', search);
    if (start) params.set('start_date', start);
    if (end) params.set('end_date', end);

    const path = basePath || '/invoices';
    router.push(`${path}?${params.toString()}`);
  };

  const vendorOptions = [
    { value: '', label: 'كل الموردين' },
    ...vendors.map(v => ({ value: v.id, label: v.name })),
  ];

  const projectOptions = [
    { value: '', label: 'كل المشاريع' },
    ...projects.map(p => ({ value: p.id, label: p.name })),
  ];

  const statusOptions = [
    { value: '', label: 'الكل' },
    { value: 'pending', label: 'قيد المراجعة' },
    { value: 'approved', label: 'معتمد' },
    { value: 'rejected', label: 'مرفوض' },
  ];

  return (
    <div className="mb-4">
      <button
        type="button"
        onClick={() => setIsOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-2 bg-muted/30 p-3 rounded-lg border shadow-sm text-sm font-medium"
      >
        <span className="flex items-center gap-2">
          <SlidersHorizontal className="w-4 h-4" />
          الفلاتر
          {activeFilterCount > 0 && (
            <span className="text-[10px] bg-primary text-primary-foreground rounded-full px-1.5 py-0.5 min-w-[1.25rem] text-center">
              {activeFilterCount}
            </span>
          )}
        </span>
        <ChevronDown className={cn('w-4 h-4 transition-transform shrink-0', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <div className="bg-muted/30 p-4 rounded-lg border border-t-0 rounded-t-none shadow-sm flex flex-wrap gap-4 items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium mb-1">بحث</label>
            <Input
              type="text"
              placeholder="ابحث باسم المورد أو المشروع..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium mb-1">المورد</label>
            <SearchableSelect
              options={vendorOptions}
              value={vendor}
              onChange={setVendor}
              placeholder="كل الموردين"
            />
          </div>

          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium mb-1">المشروع</label>
            <SearchableSelect
              options={projectOptions}
              value={project}
              onChange={setProject}
              placeholder="كل المشاريع"
            />
          </div>

          {showStatusFilter && (
            <div className="flex-1 min-w-[150px]">
              <label className="block text-sm font-medium mb-1">الحالة</label>
              <SearchableSelect
                options={statusOptions}
                value={status}
                onChange={setStatus}
                placeholder="الكل"
              />
            </div>
          )}

          <div className="flex-1 min-w-[140px]">
            <label className="block text-sm font-medium mb-1">من تاريخ</label>
            <Input type="date" autoComplete="off" value={start} onChange={e => setStart(e.target.value)} />
          </div>

          <div className="flex-1 min-w-[140px]">
            <label className="block text-sm font-medium mb-1">إلى تاريخ</label>
            <Input type="date" autoComplete="off" value={end} onChange={e => setEnd(e.target.value)} />
          </div>

          <Button onClick={handleSearch} className="w-full sm:w-auto">
            <Search className="w-4 h-4 ml-2" /> تصفية
          </Button>
        </div>
      )}
    </div>
  );
}
