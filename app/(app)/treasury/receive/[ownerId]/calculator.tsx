'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Loader2, Paperclip, FileText, Image, X } from 'lucide-react';
import { receiveFromOwner } from '@/lib/actions/payments';
import { formatMoney } from '@/lib/money';
import { createClient } from '@/lib/supabase/client';

export function OwnerReceiptCalculator({
  ownerId,
  openDocs,
  bankAccounts,
  projects,
}: {
  ownerId: string;
  openDocs: any[];
  bankAccounts: any[];
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState<number>(0);
  const [bankId, setBankId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [memo, setMemo] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const supabase = createClient();

  const [allocations, setAllocations] = useState<any[]>([]);

  // Filter open docs to only those belonging to the selected project
  const projectDocs = useMemo(
    () => (projectId ? openDocs.filter((d) => d.project_id === projectId) : []),
    [openDocs, projectId]
  );

  // Reset amount + allocations whenever the project changes
  useEffect(() => {
    setAmount(0);
    setAllocations([]);
  }, [projectId]);

  // Auto-allocate top-to-bottom whenever amount or filtered docs change.
  // NOTE: doc.amount_due from v_owner_account already equals the NET remaining
  // (v_claim_totals deducts prior payments), so use it directly as the max.
  useEffect(() => {
    if (!projectId) return;
    let remaining = amount;
    const newAllocations = projectDocs.map((doc) => {
      const remainingDue = doc.amount_due;   // already the net balance
      const allocAmount = Math.min(remaining, remainingDue);
      remaining -= allocAmount;
      return {
        target_type: doc.document_type,
        target_id: doc.document_id,
        amount: allocAmount,
        max: remainingDue,
        description: doc.description,
        project_name: doc.project_name,
      };
    });
    setAllocations(newAllocations);
  }, [amount, projectDocs, projectId]);

  const updateAllocation = (index: number, val: number) => {
    const newAllocations = [...allocations];
    newAllocations[index].amount = Math.min(val, newAllocations[index].max);
    setAllocations(newAllocations);
  };

  const handleFiles = (flist: FileList | null) => {
    if (!flist) return;
    setFiles(prev => [...prev, ...Array.from(flist)]);
  };

  const totalAllocated = useMemo(
    () => allocations.reduce((sum, a) => sum + (a.amount || 0), 0),
    [allocations]
  );
  const advance = amount - totalAllocated;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!projectId) {
      alert('يجب اختيار المشروع أولاً.');
      return;
    }
    if (totalAllocated > amount) {
      alert('إجمالي التخصيص يتجاوز المبلغ المحصل.');
      return;
    }
    setLoading(true);

    try {
      // Upload attachments first
      const uploadedPaths: string[] = [];
      for (const file of files) {
        const fileExt = file.name.split('.').pop();
        const fileName = `${Date.now()}_${Math.random().toString(36).substring(7)}.${fileExt}`;
        const { error: uploadError } = await supabase.storage
          .from('attachments')
          .upload(fileName, file);

        if (uploadError) throw uploadError;
        uploadedPaths.push(fileName);
      }

      const formData = new FormData();
      formData.append('owner_id', ownerId);
      formData.append('bank_account_id', bankId);
      formData.append('amount', amount.toString());
      formData.append('memo', memo);
      formData.append('project_id', projectId);

      const apiAllocations = allocations
        .filter((a) => a.amount > 0)
        .map((a) => ({
          target_type: a.target_type,
          target_id: a.target_id,
          amount: a.amount,
        }));

      const result = await receiveFromOwner(formData, apiAllocations, uploadedPaths);
      if (result.error) {
        alert(result.error);
        setLoading(false);
      } else {
        router.push('/treasury?tab=receivables');
      }
    } catch (err: any) {
      alert(err.message || 'حدث خطأ أثناء رفع الملفات');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* ── Main fields ── */}
      <div className="bg-card p-6 rounded-lg border shadow-sm grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Project — required, always first */}
        <div className="md:col-span-2">
          <label className="block text-sm font-medium mb-1">
            المشروع <span className="text-destructive">*</span>
          </label>
          <select
            required
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full p-2 rounded border bg-background"
          >
            <option value="">— اختر المشروع المرتبط بالدفعة —</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>

        {/* Bank account */}
        <div>
          <label className="block text-sm font-medium mb-1">
            الخزينة / الحساب البنكي <span className="text-destructive">*</span>
          </label>
          <select
            required
            disabled={!projectId}
            value={bankId}
            onChange={(e) => setBankId(e.target.value)}
            className="w-full p-2 rounded border bg-background disabled:opacity-50"
          >
            <option value="">اختر الحساب...</option>
            {bankAccounts.map((b) => (
              <option key={b.bank_account_id} value={b.bank_account_id}>
                {b.bank_name} - {b.account_name} ({formatMoney(b.current_balance)})
              </option>
            ))}
          </select>
        </div>

        {/* Amount */}
        <div>
          <label className="block text-sm font-medium mb-1">
            المبلغ المحصل <span className="text-destructive">*</span>
          </label>
          <input
            required
            disabled={!projectId}
            type="number"
            step="0.01"
            min="0"
            value={amount || ''}
            onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
            className="w-full p-2 rounded border bg-background font-bold text-lg text-primary disabled:opacity-50"
            placeholder="0.00"
          />
        </div>

        {/* Memo */}
        <div className="md:col-span-2">
          <label className="block text-sm font-medium mb-1">البيان (ملاحظات)</label>
          <input
            type="text"
            disabled={!projectId}
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            className="w-full p-2 rounded border bg-background disabled:opacity-50"
            placeholder="دفعة مقدمة، سداد مستخلص، إلخ..."
          />
        </div>

        {/* File upload */}
        <div className="md:col-span-2">
          <label className="block text-sm font-medium mb-2">مرفقات الدفعة (صور التحويل، إيصالات، PDF)</label>
          <label
            htmlFor="receipt-files"
            className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-border rounded-lg p-4 cursor-pointer hover:border-primary/60 hover:bg-primary/5 transition-colors disabled:opacity-50"
          >
            <Paperclip className="w-5 h-5 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">انقر لاختيار ملفات الإيصال</span>
            <input
              id="receipt-files"
              type="file"
              multiple
              disabled={!projectId}
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

      </div>

      {/* ── Allocation table — only shown after project is selected ── */}
      {projectId && (
        <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
          <div className="p-4 border-b bg-muted/30 flex justify-between items-center">
            <h3 className="font-bold">توزيع المحصل على مستخلصات المشروع</h3>
            <div className="text-sm">
              دفعة مقدمة متبقية:{' '}
              <span
                className={`font-bold ${
                  advance > 0 ? 'text-green-600' : 'text-muted-foreground'
                }`}
              >
                {formatMoney(advance)}
              </span>
            </div>
          </div>
          <table className="w-full text-sm text-right">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="p-3 font-medium">المستند / المستخلص</th>
                <th className="p-3 font-medium">المتبقي للتحصيل</th>
                <th className="p-3 font-medium w-48">المبلغ المخصص</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {allocations.map((alloc, idx) => (
                <tr
                  key={alloc.target_id}
                  className={alloc.amount > 0 ? 'bg-primary/5' : ''}
                >
                  <td className="p-3 font-medium">{alloc.description}</td>
                  <td className="p-3">{formatMoney(alloc.max)}</td>
                  <td className="p-3">
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      max={alloc.max}
                      value={alloc.amount || ''}
                      onChange={(e) =>
                        updateAllocation(idx, parseFloat(e.target.value) || 0)
                      }
                      className="w-full p-2 rounded border bg-background text-primary font-medium text-left"
                    />
                  </td>
                </tr>
              ))}
              {allocations.length === 0 && (
                <tr>
                  <td colSpan={3} className="p-8 text-center text-muted-foreground">
                    لا توجد مستخلصات مفتوحة لهذا المالك في المشروع المختار.
                    <br />
                    <span className="text-xs">
                      أي مبلغ سيتم تسجيله كدفعة مقدمة مرتبطة بالمشروع.
                    </span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Totals summary bar */}
          {amount > 0 && (
            <div className="p-4 border-t bg-muted/20 flex justify-end gap-8 text-sm">
              <span>
                إجمالي المحصل:{' '}
                <strong className="text-primary">{formatMoney(amount)}</strong>
              </span>
              <span>
                موزع على مستخلصات:{' '}
                <strong className="text-green-600">{formatMoney(totalAllocated)}</strong>
              </span>
              <span>
                دفعة مقدمة:{' '}
                <strong className={advance > 0 ? 'text-amber-600' : 'text-muted-foreground'}>
                  {formatMoney(advance)}
                </strong>
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Submit ── */}
      <div className="flex justify-end">
        <Button
          type="submit"
          disabled={loading || !bankId || !projectId || amount <= 0}
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          تسجيل التحصيل
        </Button>
      </div>
    </form>
  );
}
