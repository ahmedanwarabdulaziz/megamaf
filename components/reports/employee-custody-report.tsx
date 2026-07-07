'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Download, Search, Trash2, Loader2, Paperclip, X, FileText, ExternalLink } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import { deleteCustodyDisbursement } from '@/lib/actions/expenses';
import { getDownloadUrl } from '@/lib/actions/storage';
import { exportToCsv } from '@/lib/export';
import { Input } from '@/components/ui/input';

// ─── Attachment Viewer Dialog ───────────────────────────────────────────────
function AttachmentDialog({
  attachments,
  onClose,
}: {
  attachments: { r2_key: string; file_name: string }[];
  onClose: () => void;
}) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  const openAttachment = async (r2_key: string) => {
    if (urls[r2_key]) {
      window.open(urls[r2_key], '_blank');
      return;
    }
    setLoading(prev => ({ ...prev, [r2_key]: true }));
    const { url, error } = await getDownloadUrl(r2_key);
    setLoading(prev => ({ ...prev, [r2_key]: false }));
    if (error || !url) {
      alert('فشل تحميل الملف');
      return;
    }
    setUrls(prev => ({ ...prev, [r2_key]: url }));
    window.open(url, '_blank');
  };

  const isPdf = (name: string) => name.toLowerCase().endsWith('.pdf');

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-card w-full max-w-sm p-6 rounded-xl border shadow-lg">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Paperclip className="w-4 h-4 text-blue-500" />
            المرفقات
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-5 h-5" />
          </button>
        </div>

        <ul className="space-y-2">
          {attachments.map((att, i) => (
            <li key={i}>
              <button
                onClick={() => openAttachment(att.r2_key)}
                disabled={loading[att.r2_key]}
                className="w-full flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors text-right"
              >
                {loading[att.r2_key]
                  ? <Loader2 className="w-5 h-5 animate-spin text-muted-foreground shrink-0" />
                  : isPdf(att.file_name)
                    ? <FileText className="w-5 h-5 text-red-500 shrink-0" />
                    : <FileText className="w-5 h-5 text-blue-500 shrink-0" />
                }
                <span className="flex-1 text-sm truncate">{att.file_name}</span>
                <ExternalLink className="w-4 h-4 text-muted-foreground shrink-0" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ─── Main Report Component ──────────────────────────────────────────────────
export function EmployeeCustodyReport({ 
  employees, 
  projects,
  categories,
  data, 
  selectedEmployeeId,
  selectedProjectId,
  selectedCategoryId,
  startDate,
  endDate,
  balance
}: { 
  employees: any[], 
  projects: any[],
  categories: any[],
  data: any[],
  selectedEmployeeId: string,
  selectedProjectId: string,
  selectedCategoryId: string,
  startDate: string,
  endDate: string,
  balance: number
}) {
  const router = useRouter();
  const [employee, setEmployee] = useState(selectedEmployeeId);
  const [project, setProject] = useState(selectedProjectId);
  const [category, setCategory] = useState(selectedCategoryId);
  const [start, setStart] = useState(startDate);
  const [end, setEnd] = useState(endDate);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [viewingAttachments, setViewingAttachments] = useState<{ r2_key: string; file_name: string }[] | null>(null);

  const handleDelete = async (id: string) => {
    if (!confirm('هل أنت متأكد من حذف هذه الدفعة نهائياً؟')) return;
    setDeleting(id);
    const res = await deleteCustodyDisbursement(id);
    setDeleting(null);
    if (res?.error) {
      alert(res.error);
    } else {
      router.refresh();
    }
  };

  const handleSearch = () => {
    if (employee) {
      const params = new URLSearchParams({
        employee_id: employee,
        start_date: start,
        end_date: end
      });
      if (project) params.set('project_id', project);
      if (category) params.set('category_id', category);
      router.push(`/reports/employee-custody?${params.toString()}`);
    }
  };

  const handleExport = () => {
    exportToCsv(
      'employee_custody_report',
      data.map(row => ({
        'التاريخ': row.date,
        'المشروع': row.project || '',
        'التصنيف': row.category || '',
        'النوع': row.type === 'disbursement' ? 'منصرف عهدة' : 'مصروف معتمد',
        'منصرف للموظف': row.type === 'disbursement' ? row.amount : '',
        'مصروف معتمد': row.type === 'expense' ? row.amount : '',
        'البيان': row.notes || '',
      }))
    );
  };

  return (
    <div className="space-y-4">
      {/* Attachment Dialog */}
      {viewingAttachments && (
        <AttachmentDialog
          attachments={viewingAttachments}
          onClose={() => setViewingAttachments(null)}
        />
      )}

      {/* Filters */}
      <div className="bg-card p-4 rounded-lg border shadow-sm">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">الموظف</label>
            <select
              className="w-full p-2 rounded-md border bg-background text-sm"
              value={employee}
              onChange={e => setEmployee(e.target.value)}
            >
              <option value="">-- اختر الموظف --</option>
              {employees.map((emp: any) => (
                <option key={emp.id} value={emp.id}>{emp.full_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">المشروع</label>
            <select
              className="w-full p-2 rounded-md border bg-background text-sm"
              value={project}
              onChange={e => setProject(e.target.value)}
            >
              <option value="">-- كل المشاريع --</option>
              {projects.map((p: any) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">تصنيف المصروف</label>
            <select
              className="w-full p-2 rounded-md border bg-background text-sm"
              value={category}
              onChange={e => setCategory(e.target.value)}
            >
              <option value="">-- كل التصنيفات --</option>
              {categories.map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">من</label>
            <Input type="date" value={start} onChange={e => setStart(e.target.value)} className="text-sm" />
          </div>
          <div>
            <label className="block text-xs font-medium mb-1 text-muted-foreground">إلى</label>
            <Input type="date" value={end} onChange={e => setEnd(e.target.value)} className="text-sm" />
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <Button onClick={handleSearch} size="sm" className="gap-1">
            <Search className="w-4 h-4" /> بحث
          </Button>
          <Button onClick={handleExport} size="sm" variant="outline" className="gap-1" disabled={data.length === 0}>
            <Download className="w-4 h-4" /> تصدير CSV
          </Button>
        </div>
      </div>

      {/* Balance Summary */}
      {selectedEmployeeId && (
        <div className="bg-card p-4 rounded-lg border shadow-sm">
          <div className="flex items-center justify-between">
            <span className="font-medium">إجمالي رصيد العهدة</span>
            <span className={`text-xl font-bold ${balance > 0 ? 'text-green-600' : balance < 0 ? 'text-red-600' : 'text-muted-foreground'}`}>
              {formatMoney(balance)}
            </span>
          </div>
        </div>
      )}

      {/* Table */}
      {selectedEmployeeId && (
        <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 border-b">
                <tr>
                  <th className="p-3 font-medium">التاريخ</th>
                  <th className="p-3 font-medium">المشروع</th>
                  <th className="p-3 font-medium">تصنيف المصروف</th>
                  <th className="p-3 font-medium">النوع</th>
                  <th className="p-3 font-medium">منصرف للموظف (عهدة)</th>
                  <th className="p-3 font-medium">مصروف معتمد (تسوية)</th>
                  <th className="p-3 font-medium w-1/3">البيان</th>
                  <th className="p-3 font-medium text-center">الإجراءات</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.map((row: any) => (
                  <tr key={row.id} className="hover:bg-muted/30">
                    <td className="p-3 font-sans" dir="ltr">{new Date(row.date).toLocaleDateString('en-GB')}</td>
                    <td className="p-3">{row.project || <span className="text-muted-foreground">-</span>}</td>
                    <td className="p-3">{row.category || <span className="text-muted-foreground">-</span>}</td>
                    <td className="p-3 font-medium">{row.type === 'disbursement' ? 'منصرف عهدة' : 'مصروف معتمد'}</td>
                    <td className="p-3 font-medium text-green-600">{row.type === 'disbursement' ? formatMoney(row.amount) : '-'}</td>
                    <td className="p-3 font-medium text-red-600">{row.type === 'expense' ? formatMoney(row.amount) : '-'}</td>
                    <td className="p-3 whitespace-normal break-words">
                      <div className="flex items-center gap-1.5">
                        {row.hasAttachment && (
                          <button
                            onClick={() => setViewingAttachments(row.attachments)}
                            className="text-blue-500 hover:text-blue-700 shrink-0 transition-colors"
                            title="عرض المرفقات"
                          >
                            <Paperclip className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <span>{row.notes || '-'}</span>
                      </div>
                    </td>
                    <td className="p-3 text-center">
                      {row.type === 'disbursement' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-red-500 hover:text-red-700 hover:bg-red-50 h-8 w-8"
                          onClick={() => handleDelete(row.id)}
                          disabled={deleting === row.id}
                        >
                          {deleting === row.id ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                
                {data.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-muted-foreground">لا توجد حركات عهد لهذا الموظف ضمن هذا النطاق</td>
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
