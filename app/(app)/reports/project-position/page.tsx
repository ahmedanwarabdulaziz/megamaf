import { createClient } from '@/lib/supabase/server';
import { ProjectPositionReport } from '@/components/reports/project-position-report';
import { Building2 } from 'lucide-react';

export const metadata = { title: 'الموقف المالي للمشاريع' };

export default async function ProjectPositionPage() {
  const supabase = await createClient();

  const { data } = await supabase
    .from('v_project_financial_position')
    .select('*')
    .order('node_type', { ascending: false }) // main_company first, then projects, etc.
    .order('name');

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-4 bg-card p-6 rounded-lg border shadow-sm">
        <div className="p-3 bg-blue-100 text-blue-600 rounded-full">
          <Building2 className="w-8 h-8" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">الموقف المالي للمشاريع (P&L)</h1>
          <p className="text-muted-foreground mt-1">ملخص الإيرادات والتكاليف والسيولة النقدية لكل مشروع</p>
        </div>
      </div>

      <ProjectPositionReport data={data || []} />
    </div>
  );
}
