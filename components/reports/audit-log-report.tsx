'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Search, Download } from 'lucide-react';
import { exportToCsv } from '@/lib/export';

export function AuditLogReport({ 
  data, 
  selectedEntityType,
  dateFrom,
  dateTo
}: { 
  data: any[],
  selectedEntityType: string,
  dateFrom: string,
  dateTo: string
}) {
  const router = useRouter();
  const [entityType, setEntityType] = useState(selectedEntityType);
  const [from, setFrom] = useState(dateFrom);
  const [to, setTo] = useState(dateTo);

  const handleSearch = () => {
    const params = new URLSearchParams();
    if (entityType) params.set('entity_type', entityType);
    if (from) params.set('date_from', from);
    if (to) params.set('date_to', to);
    router.push(`/reports/audit-log?${params.toString()}`);
  };

  const handleExport = () => {
    const exportData = data.map(row => ({
      'التاريخ': new Date(row.created_at).toLocaleString('ar-EG'),
      'المستخدم': row.employees?.full_name || row.employee_id,
      'الإجراء': row.action,
      'نوع الكيان': row.entity_type,
      'المعرف': row.entity_id,
      'التفاصيل': JSON.stringify(row.after || {})
    }));
    
    exportToCsv(`سجل_الحركات`, exportData);
  };

  return (
    <div className="space-y-6">
      <div className="bg-card p-4 rounded-lg border shadow-sm flex flex-wrap gap-4 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-sm font-medium mb-1">نوع الكيان</label>
          <select 
            value={entityType} 
            onChange={e => setEntityType(e.target.value)} 
            className="w-full p-2 rounded border bg-background"
          >
            <option value="">-- الكل --</option>
            <option value="expense">مصروفات</option>
            <option value="invoice">فواتير موردين</option>
            <option value="claim">مستخلصات</option>
            <option value="deposit">ودائع</option>
            <option value="stock_transfer">تحويلات مخزنية</option>
            <option value="ledger_entry">حركات خزينة</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">من تاريخ</label>
          <input 
            type="date" 
            value={from} 
            onChange={e => setFrom(e.target.value)} 
            className="w-full p-2 rounded border bg-background" 
          />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">إلى تاريخ</label>
          <input 
            type="date" 
            value={to} 
            onChange={e => setTo(e.target.value)} 
            className="w-full p-2 rounded border bg-background" 
          />
        </div>
        <Button onClick={handleSearch}>
          <Search className="w-4 h-4 ml-2" /> بحث
        </Button>
        {data.length > 0 && (
          <Button variant="outline" onClick={handleExport}>
            <Download className="w-4 h-4 ml-2" /> تصدير CSV
          </Button>
        )}
      </div>

      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right whitespace-nowrap">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="p-3 font-medium">التاريخ والوقت</th>
                <th className="p-3 font-medium">المستخدم</th>
                <th className="p-3 font-medium">الإجراء</th>
                <th className="p-3 font-medium">نوع الكيان</th>
                <th className="p-3 font-medium">معرف الكيان</th>
                <th className="p-3 font-medium w-1/3">تفاصيل التعديل (JSON)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((row: any) => (
                <tr key={row.id} className="hover:bg-muted/30">
                  <td className="p-3 font-medium" dir="ltr">{new Date(row.created_at).toLocaleString('ar-EG')}</td>
                  <td className="p-3">{row.employees?.full_name || 'System'}</td>
                  <td className="p-3">
                    {row.action === 'create' && <span className="text-green-600 bg-green-50 px-2 py-1 rounded text-xs">إنشاء</span>}
                    {row.action === 'update' && <span className="text-blue-600 bg-blue-50 px-2 py-1 rounded text-xs">تعديل</span>}
                    {row.action === 'delete' && <span className="text-red-600 bg-red-50 px-2 py-1 rounded text-xs">حذف</span>}
                    {row.action === 'approve' && <span className="text-purple-600 bg-purple-50 px-2 py-1 rounded text-xs">اعتماد</span>}
                    {row.action === 'reject' && <span className="text-orange-600 bg-orange-50 px-2 py-1 rounded text-xs">رفض</span>}
                    {row.action === 'login' && <span className="text-slate-600 bg-slate-50 px-2 py-1 rounded text-xs">تسجيل دخول</span>}
                    {!['create', 'update', 'delete', 'approve', 'reject', 'login'].includes(row.action) && <span className="bg-muted px-2 py-1 rounded text-xs">{row.action}</span>}
                  </td>
                  <td className="p-3 font-mono text-xs">{row.entity_type}</td>
                  <td className="p-3 font-mono text-xs text-muted-foreground">{row.entity_id?.substring(0, 8)}...</td>
                  <td className="p-3">
                    <pre className="text-[10px] bg-muted/50 p-2 rounded overflow-hidden max-w-sm whitespace-pre-wrap break-all border border-border/50 text-left" dir="ltr">
                      {JSON.stringify(row.after || {}, null, 2)}
                    </pre>
                  </td>
                </tr>
              ))}
              
              {data.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">لا توجد حركات مسجلة بهذه المعايير</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
