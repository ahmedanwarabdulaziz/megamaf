'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Download } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import { exportToCsv } from '@/lib/export';

export function ProjectPositionReport({ data }: { data: any[] }) {
  const handleExport = () => {
    const exportData = data.map(row => ({
      'المشروع': row.name,
      'النوع': row.node_type === 'main_company' ? 'الشركة الأم' : row.node_type === 'project' ? 'مشروع' : row.node_type === 'branch' ? 'فرع' : 'مرحلة',
      'الإيرادات المفوترة': row.total_income,
      'المقبوضات': row.total_received,
      'التكاليف': row.total_expenses,
      'المدفوعات': row.total_paid,
      'محتجزات الموردين': row.retention_held,
      'صافي الموقف': row.balance
    }));
    exportToCsv('الموقف_المالي_للمشاريع', exportData);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" onClick={handleExport}>
          <Download className="w-4 h-4 ml-2" /> تصدير CSV
        </Button>
      </div>

      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right whitespace-nowrap">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="p-3 font-medium">المشروع</th>
                <th className="p-3 font-medium">النوع</th>
                <th className="p-3 font-medium">الإيرادات المفوترة</th>
                <th className="p-3 font-medium">المقبوضات</th>
                <th className="p-3 font-medium">التكاليف</th>
                <th className="p-3 font-medium">المدفوعات</th>
                <th className="p-3 font-medium">السيولة النقدية</th>
                <th className="p-3 font-medium">صافي الموقف</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.map((row: any) => (
                <tr key={row.id} className="hover:bg-muted/30">
                  <td className="p-3 font-medium">{row.name}</td>
                  <td className="p-3">
                    {row.node_type === 'main_company' && <span className="bg-primary/10 text-primary px-2 py-1 rounded text-xs">الشركة الأم</span>}
                    {row.node_type === 'project' && <span className="bg-blue-100 text-blue-800 px-2 py-1 rounded text-xs">مشروع</span>}
                    {row.node_type === 'branch' && <span className="bg-slate-100 text-slate-800 px-2 py-1 rounded text-xs">فرع</span>}
                    {row.node_type === 'phase' && <span className="bg-gray-100 text-gray-800 px-2 py-1 rounded text-xs">مرحلة</span>}
                  </td>
                  <td className="p-3">{formatMoney(row.total_owner_billed)}</td>
                  <td className="p-3">{formatMoney(row.total_owner_paid)}</td>
                  <td className="p-3">{formatMoney(row.total_costs)}</td>
                  <td className="p-3">{formatMoney(row.total_costs_paid)}</td>
                  <td className="p-3 font-medium">{formatMoney(row.total_cash)}</td>
                  <td className={`p-3 font-bold ${row.net_position >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {formatMoney(row.net_position)}
                  </td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-muted-foreground">لا توجد بيانات للعرض</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
