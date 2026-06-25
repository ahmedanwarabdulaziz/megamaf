import { createClient } from '@/lib/supabase/server';
import { AuditLogReport } from '@/components/reports/audit-log-report';
import { Activity } from 'lucide-react';

export const metadata = { title: 'سجل حركات النظام' };

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ entity_type?: string, date_from?: string, date_to?: string }>
}) {
  const { entity_type, date_from, date_to } = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from('audit_log')
    .select(`
      *,
      employees(full_name)
    `)
    .order('created_at', { ascending: false })
    .limit(1000); // 1000 latest rows

  if (entity_type) query = query.eq('entity_type', entity_type);
  if (date_from) query = query.gte('created_at', date_from + 'T00:00:00Z');
  if (date_to) query = query.lte('created_at', date_to + 'T23:59:59Z');

  const { data } = await query;

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-4 bg-card p-6 rounded-lg border shadow-sm">
        <div className="p-3 bg-slate-100 text-slate-600 rounded-full">
          <Activity className="w-8 h-8" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">سجل حركات النظام (Audit Log)</h1>
          <p className="text-muted-foreground mt-1">تتبع كافة الإضافات والتعديلات والاعتمادات</p>
        </div>
      </div>

      <AuditLogReport 
        data={data || []} 
        selectedEntityType={entity_type || ''}
        dateFrom={date_from || ''}
        dateTo={date_to || ''}
      />
    </div>
  );
}
