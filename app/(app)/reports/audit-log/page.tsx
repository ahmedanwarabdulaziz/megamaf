import { createClient } from '@/lib/supabase/server';
import { AuditLogReport } from '@/components/reports/audit-log-report';
import { Activity } from 'lucide-react';

export const metadata = { title: 'سجل حركات النظام' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{
    entity_type?: string;
    action?: string;
    employee_id?: string;
    date_from?: string;
    date_to?: string;
    page?: string;
  }>;
}) {
  const { entity_type, action, employee_id, date_from, date_to, page: pageParam } = await searchParams;
  const page = Math.max(1, parseInt(pageParam || '1', 10) || 1);
  const from = (page - 1) * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  const supabase = await createClient();

  function applyFilters<T extends { eq: any; gte: any; lte: any }>(q: T): T {
    if (entity_type) q = q.eq('entity_type', entity_type);
    if (action) q = q.eq('action', action);
    if (employee_id) q = q.eq('employee_id', employee_id);
    if (date_from) q = q.gte('created_at', date_from + 'T00:00:00Z');
    if (date_to) q = q.lte('created_at', date_to + 'T23:59:59Z');
    return q;
  }

  const [{ data, count }, { data: employees }, { data: projects }] = await Promise.all([
    applyFilters(
      supabase
        .from('audit_log')
        .select('*, employees(full_name)', { count: 'exact' })
        .order('created_at', { ascending: false }) as any
    ).range(from, to),
    supabase.from('employees').select('id, full_name').order('full_name'),
    supabase.from('projects').select('id, name'),
  ]);

  const total = count || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-4 bg-card p-6 rounded-lg border shadow-sm">
        <div className="p-3 bg-slate-100 text-slate-600 rounded-full">
          <Activity className="w-8 h-8" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">سجل حركات النظام (Audit Log)</h1>
          <p className="text-muted-foreground mt-1">تتبع كافة الإضافات والتعديلات والاعتمادات على النظام</p>
        </div>
      </div>

      <AuditLogReport
        data={data || []}
        employees={employees || []}
        projects={projects || []}
        selectedEntityType={entity_type || ''}
        selectedAction={action || ''}
        selectedEmployeeId={employee_id || ''}
        dateFrom={date_from || ''}
        dateTo={date_to || ''}
        page={page}
        totalPages={totalPages}
        total={total}
        pageSize={PAGE_SIZE}
      />
    </div>
  );
}
