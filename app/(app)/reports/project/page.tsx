import { createClient } from '@/lib/supabase/server';
import { Building2 } from 'lucide-react';
import Link from 'next/link';
import { ProjectPicker } from './project-picker';

export const metadata = { title: 'التقرير المالي للمشروع' };
export const dynamic = 'force-dynamic';

export default async function ProjectReportPickerPage() {
  const supabase = await createClient();
  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, code, node_type')
    .order('sort_order')
    .order('name');

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4 bg-card p-6 rounded-lg border shadow-sm">
        <div className="p-3 bg-blue-100 text-blue-600 rounded-full">
          <Building2 className="w-8 h-8" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">التقرير المالي للمشروع</h1>
          <p className="text-muted-foreground mt-1">اختر مشروعاً لعرض ملخصه المالي وتفاصيله الكاملة</p>
        </div>
      </div>

      <div className="bg-card p-6 rounded-lg border shadow-sm space-y-3">
        <ProjectPicker projects={projects || []} />
        <p className="text-xs text-muted-foreground">
          يمكنك أيضاً فتح تقرير مشروع مباشرة من تبويب &quot;التقرير المالي&quot; داخل صفحة المشروع.
        </p>
      </div>

      <Link href="/reports" className="text-sm text-primary hover:underline">
        ← العودة لمركز التقارير
      </Link>
    </div>
  );
}
