'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Loader2, UserRound, Paperclip, X, FileText, Image } from 'lucide-react';
import { disburseOwnerCustody } from '@/lib/actions/expenses';
import { createClient } from '@/lib/supabase/client';
import { formatMoney } from '@/lib/money';

interface Owner { id: string; name: string; }
interface Bank  { id: string; name: string; accounts?: any[]; }

export function DisburseOwnerCustodyModal({
  owners,
  banks,
}: {
  owners: Owner[];
  banks:  Bank[];
}) {
  const router = useRouter();
  const [open, setOpen]     = useState(false);
  const [loading, setLoading] = useState(false);
  const [files, setFiles]   = useState<File[]>([]);
  const today = new Date().toISOString().split('T')[0];

  const close = () => { setOpen(false); setFiles([]); };

  async function action(formData: FormData) {
    try {
      setLoading(true);
      const supabase = createClient();

      // Upload attachments first
      for (const file of files) {
        const ext = file.name.split('.').pop();
        const fileName = `owner_custody_${Math.random().toString(36).substring(2)}_${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from('attachments')
          .upload(fileName, file);
        if (uploadError) throw uploadError;
        formData.append('attachment_url', fileName);
      }

      const result = await disburseOwnerCustody(formData);
      if (result.error) {
        alert(result.error);
      } else {
        close();
        router.refresh();
      }
    } catch (e: any) {
      alert(e.message || 'حدث خطأ');
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
        <UserRound className="w-4 h-4" />
        صرف عهدة لمالك
      </Button>

      {open && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-card w-full max-w-md p-6 rounded-xl border shadow-lg relative max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-bold mb-4">صرف عهدة لمالك</h2>

            <form action={action} className="space-y-4">
              {/* Owner selector */}
              <div>
                <label className="block text-sm font-medium mb-1">المالك المستلم</label>
                <select name="owner_id" required className="w-full p-2 rounded-md border bg-background">
                  <option value="">-- اختر المالك --</option>
                  {owners.map(o => (
                    <option key={o.id} value={o.id}>{o.name}</option>
                  ))}
                </select>
              </div>

              {/* Bank account selector (flat list from getBanks) */}
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

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium mb-1">المبلغ</label>
                  <input name="amount" type="number" step="0.01" min="0.01" required className="w-full p-2 rounded-md border bg-background" />
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">التاريخ</label>
                  <input name="date" type="date" required defaultValue={today} className="w-full p-2 rounded-md border bg-background" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium mb-1">البيان / ملاحظات</label>
                <input name="memo" type="text" required className="w-full p-2 rounded-md border bg-background" placeholder="سبب الصرف..." />
              </div>

              {/* File upload */}
              <div>
                <label className="block text-sm font-medium mb-2">مرفقات (صور / PDF)</label>
                <label
                  htmlFor="owner-custody-files"
                  className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg p-4 cursor-pointer hover:border-primary/60 hover:bg-primary/5 transition-colors"
                >
                  <Paperclip className="w-5 h-5 text-muted-foreground" />
                  <span className="text-sm text-muted-foreground">انقر لاختيار ملفات</span>
                  <input
                    id="owner-custody-files"
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
                  تأكيد الصرف
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
