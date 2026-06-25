'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { disburseCustody } from '@/lib/actions/expenses';
import { createClient } from '@/lib/supabase/client';
import { Paperclip, X, FileText, Image } from 'lucide-react';
import { formatMoney } from '@/lib/money';

export function DisburseCustodyModal({ employees, banks }: { employees: any[], banks: any[] }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleClose() {
    setOpen(false);
    setFiles([]);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(e.target.files || []);
    setFiles(prev => {
      const existing = new Set(prev.map(f => f.name + f.size));
      return [...prev, ...selected.filter(f => !existing.has(f.name + f.size))];
    });
    // Reset input so same file can be re-added after removal
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeFile(index: number) {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }

  async function action(formData: FormData) {
    try {
      setLoading(true);
      const supabase = createClient();

      // Upload files to Supabase Storage first
      for (const file of files) {
        const ext = file.name.split('.').pop();
        const fileName = `custody_${Math.random().toString(36).substring(2)}_${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('attachments')
          .upload(fileName, file);
        if (uploadError) throw uploadError;
        formData.append('attachment_url', fileName);
      }

      const result = await disburseCustody(formData);
      if (result && result.error) {
        alert(result.error);
        return;
      }
      handleClose();
    } catch (e: any) {
      alert(e.message || 'حدث خطأ');
    } finally {
      setLoading(false);
    }
  }

  const today = new Date().toISOString().split('T')[0];

  if (!open) return <Button onClick={() => setOpen(true)}>صرف عهدة جديدة</Button>;

  return (
    <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-card w-full max-w-md p-6 rounded-xl border shadow-lg relative max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">صرف عهدة جديدة</h2>
        <form action={action} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">حساب البنك المحول منه</label>
            <select name="bank_account_id" required className="w-full p-2 rounded-md border bg-background">
              <option value="">-- اختر حساب البنك --</option>
              {banks.map(bank => (
                <optgroup key={bank.id} label={bank.name}>
                  {bank.accounts?.map((acc: any) => (
                    <option key={acc.bank_account_id} value={acc.bank_account_id}>
                      {acc.account_name} - {acc.account_number} ({formatMoney(acc.current_balance)})
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">الموظف (المستلم)</label>
            <select name="employee_id" required className="w-full p-2 rounded-md border bg-background">
              <option value="">-- اختر الموظف --</option>
              {employees.map(e => (
                <option key={e.employee_id} value={e.employee_id}>{e.full_name}</option>
              ))}
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
                name="date" 
                type="date" 
                required 
                defaultValue={today}
                className="w-full p-2 rounded-md border bg-background" 
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">البيان / ملاحظات</label>
            <input name="memo" type="text" required className="w-full p-2 rounded-md border bg-background" />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-2">المرفقات (صورة أو PDF)</label>
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-border rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
            >
              <Paperclip className="w-5 h-5 mx-auto mb-1 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">اضغط لاختيار ملفات</p>
              <p className="text-xs text-muted-foreground mt-0.5">صور (JPG، PNG) أو PDF</p>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf"
              onChange={handleFileChange}
              className="hidden"
            />

            {files.length > 0 && (
              <ul className="mt-2 space-y-1">
                {files.map((file, i) => {
                  const isPdf = file.type === 'application/pdf' || file.name.endsWith('.pdf');
                  return (
                    <li key={i} className="flex items-center justify-between gap-2 bg-muted/50 rounded-md px-3 py-1.5 text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        {isPdf
                          ? <FileText className="w-4 h-4 text-red-500 shrink-0" />
                          : <Image className="w-4 h-4 text-blue-500 shrink-0" />
                        }
                        <span className="truncate">{file.name}</span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          ({(file.size / 1024).toFixed(0)} KB)
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
                        className="text-muted-foreground hover:text-destructive shrink-0"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="flex gap-2 pt-4">
            <Button type="button" variant="outline" onClick={handleClose} disabled={loading} className="w-full">
              إلغاء
            </Button>
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? 'جاري الصرف...' : 'صرف العهدة'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
