'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { SearchableSelect, type SelectOption } from '@/components/ui/searchable-select';
import { Search, Download, ChevronDown, ChevronUp, ChevronRight, ChevronLeft } from 'lucide-react';
import { exportToCsv } from '@/lib/export';
import { formatMoney } from '@/lib/money';

const ENTITY_LABELS: Record<string, string> = {
  employee: 'موظف',
  project_owner: 'مالك مشروع',
  project: 'مشروع',
  bank_account: 'حساب بنكي',
  deposit: 'وديعة',
  deposit_payout: 'عائد وديعة',
  vendor: 'مورد/مقاول',
  claim: 'مستخلص',
  expense_category: 'فئة مصروف',
  expense: 'مصروف',
  direct_expense: 'مصروف مباشر',
  custody_disbursement: 'صرف عهدة',
  owner_custody_disbursement: 'صرف عهدة مالك',
  owner_receipt: 'تحصيل من مالك',
  owner_expense: 'مصروف مالك',
  owner_payment_schedule: 'جدول دفعات مالك',
  invoice: 'فاتورة',
  vendor_payment: 'دفعة لمورد',
  vendor_payment_from_expense: 'دفعة لمورد من مصروف',
  payroll_run: 'دورة رواتب',
  employee_salary: 'راتب موظف',
  payslip: 'قسيمة راتب',
  payslip_component: 'بند راتب',
  payslip_project_allocations: 'تخصيص راتب لمشروع',
  employee_loan: 'سلفة موظف',
  ledger_entry: 'حركة خزينة',
  transfer: 'تحويل مخزني',
};

const ACTION_LABELS: Record<string, { label: string; className: string }> = {
  create: { label: 'إنشاء', className: 'text-green-700 bg-green-50 dark:text-green-400 dark:bg-green-950/40' },
  update: { label: 'تعديل', className: 'text-blue-700 bg-blue-50 dark:text-blue-400 dark:bg-blue-950/40' },
  delete: { label: 'حذف', className: 'text-red-700 bg-red-50 dark:text-red-400 dark:bg-red-950/40' },
  approve: { label: 'اعتماد', className: 'text-purple-700 bg-purple-50 dark:text-purple-400 dark:bg-purple-950/40' },
  reject: { label: 'رفض', className: 'text-orange-700 bg-orange-50 dark:text-orange-400 dark:bg-orange-950/40' },
  login: { label: 'تسجيل دخول', className: 'text-slate-600 bg-slate-100 dark:text-slate-300 dark:bg-slate-800' },
  logout: { label: 'تسجيل خروج', className: 'text-slate-500 bg-slate-100 dark:text-slate-400 dark:bg-slate-800' },
};

/** Best-effort one-line human summary built from whatever the row's JSON happens to contain. */
function buildSummary(row: any, projectNameById: Map<string, string>): string {
  const data = row.after || row.before;
  if (!data || typeof data !== 'object') return '—';

  const parts: string[] = [];
  const name = data.name || data.full_name || data.account_name || data.description;
  if (name) parts.push(String(name));
  if (typeof data.amount === 'number') parts.push(formatMoney(data.amount));
  if (typeof data.principal_amount === 'number') parts.push(formatMoney(data.principal_amount));
  if (data.project_id && projectNameById.get(data.project_id)) parts.push(`مشروع: ${projectNameById.get(data.project_id)}`);
  if (data.status) parts.push(`الحالة: ${data.status}`);
  if (!name && data.notes) parts.push(String(data.notes));

  return parts.length ? parts.join(' — ') : '—';
}

function dayLabel(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

export function AuditLogReport({
  data,
  employees,
  projects,
  selectedEntityType,
  selectedAction,
  selectedEmployeeId,
  dateFrom,
  dateTo,
  page,
  totalPages,
  total,
  pageSize,
}: {
  data: any[];
  employees: { id: string; full_name: string }[];
  projects: { id: string; name: string }[];
  selectedEntityType: string;
  selectedAction: string;
  selectedEmployeeId: string;
  dateFrom: string;
  dateTo: string;
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
}) {
  const router = useRouter();
  const [entityType, setEntityType] = useState(selectedEntityType);
  const [action, setAction] = useState(selectedAction);
  const [employeeId, setEmployeeId] = useState(selectedEmployeeId);
  const [from, setFrom] = useState(dateFrom);
  const [to, setTo] = useState(dateTo);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const projectNameById = new Map(projects.map((p) => [p.id, p.name]));

  function goToPage(p: number) {
    const params = new URLSearchParams();
    if (entityType) params.set('entity_type', entityType);
    if (action) params.set('action', action);
    if (employeeId) params.set('employee_id', employeeId);
    if (from) params.set('date_from', from);
    if (to) params.set('date_to', to);
    if (p > 1) params.set('page', String(p));
    router.push(`/reports/audit-log?${params.toString()}`);
  }

  const handleExport = () => {
    const exportData = data.map((row: any) => ({
      'التاريخ': new Date(row.created_at).toLocaleString('ar-EG'),
      'المستخدم': row.employees?.full_name || 'النظام',
      'الإجراء': ACTION_LABELS[row.action]?.label || row.action,
      'نوع الحركة': ENTITY_LABELS[row.entity_type] || row.entity_type,
      'المعرف': row.entity_id,
      'الوصف': buildSummary(row, projectNameById),
    }));
    exportToCsv('سجل_الحركات', exportData);
  };

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // ── Group rows into day buckets for scannability ──
  const groups: { day: string; rows: any[] }[] = [];
  for (const row of data) {
    const day = new Date(row.created_at).toDateString();
    const last = groups[groups.length - 1];
    if (!last || last.day !== day) groups.push({ day, rows: [row] });
    else last.rows.push(row);
  }

  const employeeOptions: SelectOption[] = employees.map((e) => ({ value: e.id, label: e.full_name }));

  const rangeStart = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeEnd = Math.min(page * pageSize, total);

  return (
    <div className="space-y-4">
      <div className="bg-card p-4 rounded-lg border shadow-sm flex flex-wrap gap-4 items-end">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-sm font-medium mb-1">نوع الحركة</label>
          <select
            value={entityType}
            onChange={(e) => setEntityType(e.target.value)}
            className="w-full p-2 rounded border bg-background text-sm"
          >
            <option value="">-- الكل --</option>
            {Object.entries(ENTITY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[150px]">
          <label className="block text-sm font-medium mb-1">الإجراء</label>
          <select
            value={action}
            onChange={(e) => setAction(e.target.value)}
            className="w-full p-2 rounded border bg-background text-sm"
          >
            <option value="">-- الكل --</option>
            {Object.entries(ACTION_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[200px]">
          <label className="block text-sm font-medium mb-1">المستخدم</label>
          <SearchableSelect
            options={employeeOptions}
            value={employeeId}
            onChange={setEmployeeId}
            placeholder="كل المستخدمين"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">من تاريخ</label>
          <input
            type="date"
            autoComplete="off"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="w-full p-2 rounded border bg-background text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">إلى تاريخ</label>
          <input
            type="date"
            autoComplete="off"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="w-full p-2 rounded border bg-background text-sm"
          />
        </div>
        <Button onClick={() => goToPage(1)}>
          <Search className="w-4 h-4 ml-2" /> بحث
        </Button>
        {data.length > 0 && (
          <Button variant="outline" onClick={handleExport}>
            <Download className="w-4 h-4 ml-2" /> تصدير هذه الصفحة CSV
          </Button>
        )}
      </div>

      <div className="text-sm text-muted-foreground">
        {total === 0 ? 'لا توجد حركات' : `عرض ${rangeStart}–${rangeEnd} من إجمالي ${total} حركة`}
      </div>

      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        {groups.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">لا توجد حركات مسجلة بهذه المعايير</div>
        ) : (
          <div className="divide-y divide-border">
            {groups.map((g) => (
              <div key={g.day}>
                <div className="bg-muted/40 px-4 py-2 text-xs font-semibold text-muted-foreground">
                  {dayLabel(g.rows[0].created_at)}
                </div>
                <div className="divide-y divide-border/60">
                  {g.rows.map((row: any) => {
                    const isOpen = expanded.has(row.id);
                    const hasDetail = !!row.before || !!row.after;
                    const actionMeta = ACTION_LABELS[row.action];
                    return (
                      <div key={row.id}>
                        <div
                          className={`flex items-center gap-3 px-4 py-2.5 text-sm ${hasDetail ? 'cursor-pointer hover:bg-muted/20' : ''} transition-colors`}
                          onClick={() => hasDetail && toggle(row.id)}
                        >
                          <span className="text-xs text-muted-foreground w-12 shrink-0" dir="ltr">
                            {new Date(row.created_at).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span className="w-28 shrink-0 font-medium truncate">{row.employees?.full_name || 'النظام'}</span>
                          <span className={`px-2 py-0.5 rounded text-xs font-semibold shrink-0 whitespace-nowrap ${actionMeta?.className || 'bg-muted text-muted-foreground'}`}>
                            {actionMeta?.label || row.action}
                          </span>
                          <span className="px-2 py-0.5 rounded text-xs bg-muted text-muted-foreground shrink-0 whitespace-nowrap">
                            {ENTITY_LABELS[row.entity_type] || row.entity_type}
                          </span>
                          <span className="flex-1 truncate text-muted-foreground min-w-0">{buildSummary(row, projectNameById)}</span>
                          {hasDetail && (
                            <span className="shrink-0 text-muted-foreground">
                              {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </span>
                          )}
                        </div>
                        {isOpen && (
                          <div className="px-4 pb-3 bg-muted/10">
                            <p className="text-xs text-muted-foreground mb-2">معرف الكيان: <span className="font-mono">{row.entity_id || '—'}</span></p>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              {row.before && (
                                <div>
                                  <p className="text-xs font-semibold text-muted-foreground mb-1">قبل</p>
                                  <pre className="text-[10px] bg-muted/50 p-2 rounded overflow-auto max-h-64 border border-border/50" dir="ltr">
                                    {JSON.stringify(row.before, null, 2)}
                                  </pre>
                                </div>
                              )}
                              {row.after && (
                                <div>
                                  <p className="text-xs font-semibold text-muted-foreground mb-1">بعد</p>
                                  <pre className="text-[10px] bg-muted/50 p-2 rounded overflow-auto max-h-64 border border-border/50" dir="ltr">
                                    {JSON.stringify(row.after, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-3">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => goToPage(page - 1)}>
            <ChevronRight className="w-4 h-4 ml-1" /> السابق
          </Button>
          <span className="text-sm text-muted-foreground">صفحة {page} من {totalPages}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => goToPage(page + 1)}>
            التالي <ChevronLeft className="w-4 h-4 mr-1" />
          </Button>
        </div>
      )}
    </div>
  );
}
