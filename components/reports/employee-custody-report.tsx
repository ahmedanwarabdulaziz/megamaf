'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Download, Search } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import { exportToCsv } from '@/lib/export';

export function EmployeeCustodyReport({ 
  employees, 
  data, 
  selectedEmployeeId,
  balance
}: { 
  employees: any[], 
  data: any[],
  selectedEmployeeId: string,
  balance: number
}) {
  const router = useRouter();
  const [employee, setEmployee] = useState(selectedEmployeeId);

  const handleSearch = () => {
    if (employee) router.push(`/reports/employee-custody?employee_id=${employee}`);
  };

  const handleExport = () => {
    const selected = employees.find(e => e.id === employee);
    const exportData = data.map(row => ({
      'التاريخ': row.date,
      'النوع': row.type === 'disbursement' ? 'منصرف عهدة (وارد للموظف)' : 'مصروف (صادر من الموظف)',
      'المبلغ': row.amount,
      'الملاحظات': row.notes
    }));
    
    exportToCsv(`كشف_عهدة_${selected?.full_name || 'موظف'}`, exportData);
  };

  return (
    <div className="space-y-6">
      <div className="bg-card p-4 rounded-lg border shadow-sm flex flex-wrap gap-4 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-sm font-medium mb-1">الموظف</label>
          <select 
            value={employee} 
            onChange={e => setEmployee(e.target.value)} 
            className="w-full p-2 rounded border bg-background"
          >
            <option value="">-- اختر الموظف --</option>
            {employees.map(e => (
              <option key={e.id} value={e.id}>{e.full_name}</option>
            ))}
          </select>
        </div>
        <Button onClick={handleSearch} disabled={!employee}>
          <Search className="w-4 h-4 ml-2" /> عرض التقرير
        </Button>
        {data.length > 0 && (
          <Button variant="outline" onClick={handleExport}>
            <Download className="w-4 h-4 ml-2" /> تصدير CSV
          </Button>
        )}
      </div>

      {selectedEmployeeId && (
        <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
          <div className="p-4 border-b bg-muted/30 flex justify-between items-center">
            <h3 className="font-bold">رصيد العهدة الحالي:</h3>
            <div className={`text-xl font-bold ${balance > 0 ? 'text-green-600' : balance < 0 ? 'text-red-600' : ''}`}>
              {formatMoney(balance)}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right whitespace-nowrap">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="p-3 font-medium">التاريخ</th>
                  <th className="p-3 font-medium">النوع</th>
                  <th className="p-3 font-medium">منصرف للموظف (عهدة)</th>
                  <th className="p-3 font-medium">مصروف معتمد (تسوية)</th>
                  <th className="p-3 font-medium w-1/3">البيان</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.map((row: any) => (
                  <tr key={row.id} className="hover:bg-muted/30">
                    <td className="p-3">{new Date(row.date).toLocaleDateString('ar-EG')}</td>
                    <td className="p-3 font-medium">{row.type === 'disbursement' ? 'منصرف عهدة' : 'مصروف معتمد'}</td>
                    <td className="p-3 font-medium text-green-600">{row.type === 'disbursement' ? formatMoney(row.amount) : '-'}</td>
                    <td className="p-3 font-medium text-red-600">{row.type === 'expense' ? formatMoney(row.amount) : '-'}</td>
                    <td className="p-3 whitespace-normal break-words">{row.notes || '-'}</td>
                  </tr>
                ))}
                
                {data.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-muted-foreground">لا توجد حركات عهد لهذا الموظف</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
