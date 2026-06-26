'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Search } from 'lucide-react';

export function ClaimsFilters({
  projects,
  selectedProjectId,
}: {
  projects: any[];
  selectedProjectId: string;
}) {
  const router = useRouter();
  const [project, setProject] = useState(selectedProjectId);

  const handleSearch = () => {
    const params = new URLSearchParams();
    if (project) params.set('project_id', project);
    
    router.push(`/claims?${params.toString()}`);
  };

  return (
    <div className="bg-muted/30 p-4 rounded-lg border shadow-sm flex flex-wrap gap-4 items-end mb-6">
      <div className="flex-1 min-w-[200px] max-w-sm">
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

      <Button onClick={handleSearch} className="w-full sm:w-auto">
        <Search className="w-4 h-4 ml-2" /> تصفية
      </Button>
    </div>
  );
}
