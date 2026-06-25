'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Plus, Paperclip, X, FileText, Image } from 'lucide-react';
import { createOwnerExpense } from '@/lib/actions/expenses';
import { createClient } from '@/lib/supabase/client';

interface Owner    { id: string; name: string; }
interface Category { id: string; name: string; }
interface Project  { id: string; name: string; }

export function CreateOwnerExpenseModal({
  owners,
  categories,
  projects,
}: {
  owners:     Owner[];
  categories: Category[];
  projects:   Project[];
}) {
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState(false);
  const [files, setFiles]     = useState<File[]>([]);
  const [error, setError]     = useState('');
  const today = new Date().toISOString().split('T')[0];

  const close = () => { setOpen(false); setFiles([]); setError(''); };

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const supabase = createClient();
      const formData = new FormData(e.currentTarget);

      // Upload attachments
      for (const file of files) {
        const ext = file.name.split('.').pop();
        const fileName = `owner_exp_${Math.random().toString(36).substring(2)}_${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('attachments')
          .upload(fileName, file);
        if (uploadError) throw uploadError;
        formData.append('attachment_url', fileName);
      }

      const result = await createOwnerExpense(formData);
      if (result.error) {
        setError(result.error);
      } else {
        close();
      }
    } catch (e: any) {
      setError(e.message || 'حدث خطأ غير متوقع');
    } finally {
      setLoading(false);
    }
  }

  const handleFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const allowed = Array.from(incoming).filter(f =>
      f.type.startsWith('image/') || f.type === 'application/pdf'
    );
    setFiles(prev => [...prev, ...allowed]);
  };

  return (
    <>
      <Button onClick={() => setOpen(true)} className="gap-2">
        <Plus className="w-4 h-4" />
        مصروف مالك جديد
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-card w-full max-w-md rounded-xl border shadow-xl p-6 max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">تسجيل مصروف مالك</h2>

            {error && (
              <div className="mb-4 p-3 bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-lg">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Owner */}
              <div>
                <label className="block text-sm font-medium mb-1">المالك</label>
                <select name="owner_id" required className="w-full p-2 rounded-md border bg-background">
                  <option value="">-- اختر المالك --</option>
                  {owners.map(o => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </div>

              {/* Category */}
              <div>
                <label className="block text-sm font-medium mb-1">التصنيف</label>
                <select name="category_id" required className="w-full p-2 rounded-md border bg-background">
                  <option value="">-- اختر التصنيف --</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {/* Project (optional) */}
              <div>
                <label className="block text-sm font-medium mb-1">المشروع (اختياري)</label>
                <select name="project_id" className="w-full p-2 rounded-md border bg-background">
                  <option value="">-- بدون مشروع محدد --</option>
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">المبلغ (ج.م)</label>
                  <input
                    name="amount"
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    className="w-full p-2 rounded-md border bg-background font-bold text-primary"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">التاريخ</label>
                  <input
                    name="expense_date"
                    type="date"
                    required
                    defaultValue={today}
                    className="w-full p-2 rounded-md border bg-background"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">ملاحظات</label>
                <textarea
                  name="notes"
                  rows={2}
                  className="w-full p-2 rounded-md border bg-background"
                  placeholder="وصف المصروف..."
                />
              </div>

              {/* File upload */}
              <div>
                <label className="block text-sm font-medium mb-2">مرفقات (صور / PDF)</label>
                <label
                  htmlFor="owner-exp-files"
                  className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg p-4 cursor-pointer hover:border-primary/60 hover:bg-primary/5 transition-colors"
                >
                  <Paperclip className="w-5 h-5 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">انقر لاختيار ملفات</span>
                  <input
                    id="owner-exp-files"
                    type="file"
                    multiple
                    accept="image/*,.pdf"
                    className="hidden"
                    onChange={e => handleFiles(e.target.files)}
                  />
                </label>
                {files.length > 0 && (
                  <ul className="mt-2 space-y-1">
                    {files.map((f, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm bg-muted/40 rounded px-2 py-1">
                        {f.type === 'application/pdf'
                          ? <FileText className="w-4 h-4 text-red-500 shrink-0" />
                          : <Image className="w-4 h-4 text-blue-500 shrink-0" />}
                        <span className="flex-1 truncate">{f.name}</span>
                        <button type="button" onClick={() => setFiles(p => p.filter((_, j) => j !== i))}>
                          <X className="w-3.5 h-3.5 text-muted-foreground hover:text-destructive" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t">
                <Button type="button" variant="outline" onClick={close} disabled={loading}>إلغاء</Button>
                <Button type="submit" disabled={loading}>
                  {loading ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : null}
                  تسجيل المصروف
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
