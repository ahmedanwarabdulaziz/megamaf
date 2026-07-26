'use client';

import { useRouter } from 'next/navigation';
import { SearchableSelect, SelectOption } from '@/components/ui/searchable-select';

const TYPE_LABEL: Record<string, string> = {
  main_company: 'الشركة الرئيسية',
  project: 'مشروع',
  branch: 'فرع',
  phase: 'مرحلة',
};

export function ProjectPicker({ projects }: { projects: { id: string; name: string; code: string | null; node_type: string }[] }) {
  const router = useRouter();

  const options: SelectOption[] = projects.map(p => ({
    value: p.id,
    label: p.name,
    sub: p.code || undefined,
    badge: TYPE_LABEL[p.node_type] || p.node_type,
  }));

  return (
    <SearchableSelect
      options={options}
      value=""
      onChange={(id) => { if (id) router.push(`/reports/project/${id}`); }}
      placeholder="ابحث عن مشروع لعرض تقريره المالي..."
    />
  );
}
