'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { createExpense } from '@/lib/actions/expenses';
import { createClient } from '@/lib/supabase/client';

interface Employee { id: string; full_name: string; }

export function CreateExpenseModal({
  categories,
  projects,
  isSuperAdmin,
  employees = [],
}: {
  categories: any[];
  projects: any[];
  isSuperAdmin: boolean;
  employees?: Employee[];
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState('');

  const close = () => { setOpen(false); setFiles([]); setError(''); };

  if (!open) return <Button onClick={() => setOpen(true)}>تسجيل مصروف</Button>;

  const topLevelCategories = categories.filter(c => !c.parent_id);

  async function action(formData: FormData) {
    try {
      setLoading(true);
      setError('');

      const supabase = createClient();

      for (const file of files) {
        const ext = file.name.split('.').pop();
        const fileName = `${Math.random().toString(36).substring(2)}_${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('attachments')
          .upload(fileName, file);
        if (uploadError) throw uploadError;
        formData.append('attachment_url', fileName);
      }

      const result = await createExpense(formData);
      if (result && result.error) {
        setError(result.error);
        return;
      }
      close();
    } catch (e: any) {
      setError(e.message || 'حدث خطأ');
    } finally {
      setLoading(false);
    }
  }

  const today = new Date();
  const minDateStr = new Date(today.getTime() - (15 * 24 * 60 * 60 * 1000)).toISOString().split('T')[0];

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-card w-full max-w-md p-6 rounded-xl border shadow-lg relative max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">تسجيل مصروف جديد</h2>

        {error && (
          <div className="mb-4 p-3 bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-lg">
            {error}
          </div>
        )}

        <form action={action} className="space-y-4">

          {/* Employee selector — only visible to super admins */}
          {isSuperAdmin && employees.length > 0 && (
            <div>
              <label className="block text-sm font-medium mb-1">
                الموظف
                <span className="mr-1 text-[10px] font-normal text-muted-foreground">(اتركه فارغاً لتسجيله باسمك)</span>
              </label>
              <select
                name="target_employee_id"
                className="w-full p-2 rounded-md border bg-background"
              >
                <option value="">-- نفسي (أنا) --</option>
                {employees.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.full_name}</option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium mb-1">المشروع</label>
            <select name="project_id" required className="w-full p-2 rounded-md border bg-background">
              <option value="">-- اختر المشروع --</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">التصنيف</label>
            <select name="category_id" required className="w-full p-2 rounded-md border bg-background">
              <option value="">-- اختر التصنيف --</option>
              {topLevelCategories.map(parent => {
                const children = categories.filter(c => c.parent_id === parent.id);
                return (
                  <optgroup key={parent.id} label={parent.name}>
                    {children.map(child => (
                      <option key={child.id} value={child.id}>{child.name}</option>
                    ))}
                  </optgroup>
                );
              })}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">المبلغ</label>
              <input name="amount" type="number" step="0.01" min="0.01" required className="w-full p-2 rounded-md border bg-background" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">التاريخ</label>
              <input
                name="expense_date"
                type="date"
                required
                defaultValue={today.toISOString().split('T')[0]}
                min={isSuperAdmin ? undefined : minDateStr}
                max={today.toISOString().split('T')[0]}
                className="w-full p-2 rounded-md border bg-background"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">ملاحظات</label>
            <textarea name="notes" rows={2} className="w-full p-2 rounded-md border bg-background"></textarea>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">صورة / إيصال</label>
            <input
              type="file"
              multiple
              accept="image/*,.pdf"
              onChange={e => setFiles(Array.from(e.target.files || []))}
              className="w-full p-2 rounded-md border bg-background text-sm"
            />
          </div>

          <div className="flex gap-2 pt-4">
            <Button type="button" variant="outline" onClick={close} disabled={loading} className="w-full">
              إلغاء
            </Button>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'جاري الحفظ...' : 'حفظ'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
