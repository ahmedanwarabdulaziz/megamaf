'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';

export function InvoicesFilters({
  projects,
  vendors,
  selectedProjectId,
  selectedVendorId,
  selectedStatus,
  searchQuery,
  startDate,
  endDate,
}: {
  projects: any[];
  vendors: any[];
  selectedProjectId: string;
  selectedVendorId: string;
  selectedStatus: string;
  searchQuery: string;
  startDate: string;
  endDate: string;
}) {
  const router = useRouter();
  const [project, setProject] = useState(selectedProjectId);
  const [vendor, setVendor] = useState(selectedVendorId);
  const [status, setStatus] = useState(selectedStatus);
  const [search, setSearch] = useState(searchQuery);
  const [start, setStart] = useState(startDate);
  const [end, setEnd] = useState(endDate);

  const handleSearch = () => {
    const params = new URLSearchParams();
    if (project) params.set('project_id', project);
    if (vendor) params.set('vendor_id', vendor);
    if (status) params.set('status', status);
    if (search) params.set('search', search);
    if (start) params.set('start_date', start);
    if (end) params.set('end_date', end);
    
    router.push(`/invoices?${params.toString()}`);
  };

  return (
    <div className="bg-muted/30 p-4 rounded-lg border shadow-sm flex flex-wrap gap-4 items-end mb-6">
      <div className="flex-1 min-w-[150px]">
        <label className="block text-sm font-medium mb-1">بحث</label>
        <Input 
          type="text" 
          placeholder="ابحث باسم المورد أو المشروع..." 
          value={search} 
          onChange={e => setSearch(e.target.value)} 
        />
      </div>

      <div className="flex-1 min-w-[150px]">
        <label className="block text-sm font-medium mb-1">المورد</label>
        <select 
          value={vendor} 
          onChange={e => setVendor(e.target.value)} 
          className="w-full p-2 rounded-md border bg-background"
        >
          <option value="">كل الموردين</option>
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

      <div className="flex-1 min-w-[140px]">
        <label className="block text-sm font-medium mb-1">من تاريخ</label>
        <Input type="date" value={start} onChange={e => setStart(e.target.value)} />
      </div>
      
      <div className="flex-1 min-w-[140px]">
        <label className="block text-sm font-medium mb-1">إلى تاريخ</label>
        <Input type="date" value={end} onChange={e => setEnd(e.target.value)} />
      </div>

      <Button onClick={handleSearch} className="w-full sm:w-auto">
        <Search className="w-4 h-4 ml-2" /> بحث
      </Button>
    </div>
  );
}
