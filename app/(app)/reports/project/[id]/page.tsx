import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Building2, ArrowRight } from 'lucide-react';
import { getProjectReportData } from '@/lib/queries/project-report';
import { ProjectReport } from '@/components/reports/project-report';

export const dynamic = 'force-dynamic';

const TYPE_LABEL: Record<string, string> = {
  main_company: 'الشركة الرئيسية',
  project: 'مشروع',
  branch: 'فرع',
  phase: 'مرحلة',
};

export default async function ProjectReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await getProjectReportData(id);

  if (!data) notFound();

  const { project } = data;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-card p-6 rounded-lg border shadow-sm">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-blue-100 text-blue-600 rounded-full">
            <Building2 className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{project.name}</h1>
            <p className="text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
              {project.code && <span className="font-mono bg-muted px-1.5 rounded text-xs">{project.code}</span>}
              <span>{TYPE_LABEL[project.node_type] || project.node_type}</span>
              {project.project_owners?.name && <span>· المالك: {project.project_owners.name}</span>}
            </p>
          </div>
        </div>
        <Link href="/reports/project" className="inline-flex items-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent transition-colors">
          <ArrowRight className="w-4 h-4" /> اختيار مشروع آخر
        </Link>
      </div>

      <ProjectReport data={data} />
    </div>
  );
}
