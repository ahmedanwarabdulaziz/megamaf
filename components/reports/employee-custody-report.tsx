'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Download, Search } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import { exportToCsv } from '@/lib/export';
import { Input } from '@/components/ui/input';

export function EmployeeCustodyReport({ 
  employees, 
  projects,
  data, 
  selectedEmployeeId,
  selectedProjectId,
  startDate,
  endDate,
  balance
}: { 
  employees: any[], 
  projects: any[],
  data: any[],
  selectedEmployeeId: string,
  selectedProjectId: string,
  startDate: string,
  endDate: string,
  balance: number
}) {
  const router = useRouter();
  const [employee, setEmployee] = useState(selectedEmployeeId);
  const [project, setProject] = useState(selectedProjectId);
  const [start, setStart] = useState(startDate);
  const [end, setEnd] = useState(endDate);

  const handleSearch = () => {
    if (employee) {
      const params = new URLSearchParams({
        employee_id: employee,
        start_date: start,
        end_date: end
      });
      if (project) params.set('project_id', project);
      
      router.push(`/reports/employee-custody?${params.toString()}`);
    }
  };

  const handleExport = () => {
    const selected = employees.find(e => e.id === employee);
    const exportData = data.map(row => ({
      'التاريخ': new Date(row.date).toLocaleDateString('en-GB'),
      'المشروع': row.project || '-',
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
            className="w-full p-2 rounded-md border bg-background"
          >
            <option value="">-- اختر الموظف --</option>
            {employees.map(e => (
              <option key={e.id} value={e.id}>{e.full_name}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[150px]">
          <label className="block text-sm font-medium mb-1">المشروع</label>
          <select 
            value={project} 
            onChange={e => setProject(e.target.value)} 
            className="w-full p-2 rounded-md border bg-background"
          >
            <option value="">كل المشاريع</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-[150px]">
          <label className="block text-sm font-medium mb-1">من تاريخ</label>
          <Input type="date" value={start} onChange={e => setStart(e.target.value)} />
        </div>
        <div className="flex-1 min-w-[150px]">
          <label className="block text-sm font-medium mb-1">إلى تاريخ</label>
          <Input type="date" value={end} onChange={e => setEnd(e.target.value)} />
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
            <h3 className="font-bold">رصيد العهدة الإجمالي للموظف:</h3>
            <div className={`text-xl font-bold ${balance > 0 ? 'text-green-600' : balance < 0 ? 'text-red-600' : ''}`}>
              {formatMoney(balance)}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-right whitespace-nowrap">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="p-3 font-medium">التاريخ</th>
                  <th className="p-3 font-medium">المشروع</th>
                  <th className="p-3 font-medium">النوع</th>
                  <th className="p-3 font-medium">منصرف للموظف (عهدة)</th>
                  <th className="p-3 font-medium">مصروف معتمد (تسوية)</th>
                  <th className="p-3 font-medium w-1/3">البيان</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.map((row: any) => (
                  <tr key={row.id} className="hover:bg-muted/30">
                    <td className="p-3 font-sans" dir="ltr">{new Date(row.date).toLocaleDateString('en-GB')}</td>
                    <td className="p-3">{row.project || <span className="text-muted-foreground">-</span>}</td>
                    <td className="p-3 font-medium">{row.type === 'disbursement' ? 'منصرف عهدة' : 'مصروف معتمد'}</td>
                    <td className="p-3 font-medium text-green-600">{row.type === 'disbursement' ? formatMoney(row.amount) : '-'}</td>
                    <td className="p-3 font-medium text-red-600">{row.type === 'expense' ? formatMoney(row.amount) : '-'}</td>
                    <td className="p-3 whitespace-normal break-words">{row.notes || '-'}</td>
                  </tr>
                ))}
                
                {data.length === 0 && (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-muted-foreground">لا توجد حركات عهد لهذا الموظف ضمن هذا النطاق</td>
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
