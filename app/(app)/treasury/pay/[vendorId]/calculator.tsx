'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { payVendor } from '@/lib/actions/payments';
import { formatMoney } from '@/lib/money';

type ClaimSummary = {
  project_id: string;
  project_name: string;
  claim_number: number;
  grossTotal: number;
  retained: number;
  netCumulative: number;
  tax: number;
  tax_rate: number;
  tax_enabled: boolean;
  totalPaid: number;
  remaining: number;
};

export function VendorPaymentCalculator({ vendorId, openDocs, bankAccounts, projects, claimSummaries }: { vendorId: string, openDocs: any[], bankAccounts: any[], projects: {id: string, name: string}[], claimSummaries?: ClaimSummary[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [amount, setAmount] = useState<number>(0);
  const [bankId, setBankId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [memo, setMemo] = useState('');
  
  // Array of { target_type, target_id, amount, max: number }
  const [allocations, setAllocations] = useState<any[]>([]);

  useEffect(() => {
    // Auto-allocate top-to-bottom
    // Note: openDocs already arrives clean from the server:
    // - prior_claim rows for projects with in-system claims are excluded
    // - claim rows have amount_due patched to summary.remaining
    let remaining = amount;

    const filteredDocs = projectId
      ? openDocs.filter(d => d.project_id === projectId)
      : openDocs;

    const newAllocations = filteredDocs.map(doc => {
      // For cumulative claims: use summary values so description and
      // المتبقي للدفع match what's shown in ملخص آخر مستخلص معتمد
      const summary = doc.document_type === 'claim'
        ? claimSummaries?.find(s => s.project_id === doc.project_id)
        : undefined;

      const remainingDue = summary
        ? summary.remaining
        : doc.amount_due - doc.amount_paid;

      const description = summary
        ? `مستخلص رقم ${summary.claim_number}`
        : doc.description;

      const allocAmount = Math.min(remaining, remainingDue);
      remaining -= allocAmount;
      return {
        target_type:   doc.document_type,
        target_id:     doc.document_id,
        amount:        allocAmount,
        max:           remainingDue,
        description,
        project_name:  projects.find(p => p.id === doc.project_id)?.name || doc.project_name || 'عام',
        // Breakdown fields from summary (for claim rows)
        grossTotal:    summary?.grossTotal    ?? 0,
        retained:      summary?.retained      ?? 0,
        netCumulative: summary?.netCumulative ?? 0,
        tax:           summary?.tax           ?? 0,
        tax_rate:      summary?.tax_rate      ?? 0,
        totalPaid:     summary?.totalPaid     ?? 0,
      };
    });
    setAllocations(newAllocations);
  }, [amount, openDocs, projectId, projects, claimSummaries]);

  const updateAllocation = (index: number, val: number) => {
    const newAllocations = [...allocations];
    newAllocations[index].amount = Math.min(val, newAllocations[index].max);
    setAllocations(newAllocations);
  };

  const totalAllocated = useMemo(() => allocations.reduce((sum, a) => sum + (a.amount || 0), 0), [allocations]);
  const credit = amount - totalAllocated;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (totalAllocated > amount) {
      alert('Total allocated exceeds payment amount.');
      return;
    }
    setLoading(true);
    const formData = new FormData();
    formData.append('vendor_id', vendorId);
    formData.append('bank_account_id', bankId);
    formData.append('amount', amount.toString());
    formData.append('memo', memo);
    if (projectId) formData.append('project_id', projectId);

    const apiAllocations = allocations.filter(a => a.amount > 0).map(a => ({
      target_type: a.target_type,
      target_id: a.target_id,
      amount: a.amount
    }));

    const result = await payVendor(formData, apiAllocations);
    if (result.error) {
      alert(result.error);
      setLoading(false);
    } else {
      router.push('/treasury');
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">

      {/* ── Claim Totals Summary Card (mirrors /claims page) ── */}
      {claimSummaries && claimSummaries.length > 0 && (
        <div className="bg-card rounded-lg border shadow-sm divide-y">
          <div className="px-4 py-3 bg-muted/30">
            <h3 className="font-bold text-sm">ملخص آخر مستخلص معتمد</h3>
          </div>
          {claimSummaries.map(s => (
            <div key={s.project_id} className="p-4 flex flex-col sm:flex-row justify-between sm:items-start gap-4">
              {/* Project + claim info */}
              <div className="min-w-0">
                <p className="text-sm font-medium">{s.project_name}</p>
                <p className="text-xs text-muted-foreground mt-0.5">مستخلص رقم {s.claim_number}</p>
              </div>

              {/* Financial breakdown (same as /claims page) */}
              <div className="flex flex-col items-end gap-1.5 min-w-[280px]">
                {/* Gross */}
                <div className="flex justify-between w-full gap-4 text-xs text-muted-foreground">
                  <span>إجمالي الأعمال التراكمي:</span>
                  <span className="font-medium">{formatMoney(s.grossTotal)}</span>
                </div>

                {/* Retention */}
                {s.retained > 0 && (
                  <div className="flex justify-between w-full gap-4 text-xs text-amber-600">
                    <span>المحتجز التراكمي (تأمين):</span>
                    <span className="font-medium">- {formatMoney(s.retained)}</span>
                  </div>
                )}

                {/* Net cumulative — THE KEY LINE */}
                <div className="flex justify-between w-full gap-4 text-xs text-muted-foreground border-t border-muted/30 pt-1">
                  <span>الصافي التراكمي (قابل للدفع):</span>
                  <span className="font-medium">{formatMoney(s.netCumulative)}</span>
                </div>

                {/* Tax */}
                {s.tax > 0 && (
                  <div className="flex justify-between w-full gap-4 text-xs text-muted-foreground">
                    <span>الضريبة ({(s.tax_rate * 100).toFixed(1)}%):</span>
                    <span>+ {formatMoney(s.tax)}</span>
                  </div>
                )}

                {/* Paid */}
                {s.totalPaid > 0 && (
                  <div className="flex justify-between w-full gap-4 text-xs text-green-700 dark:text-green-400 font-medium">
                    <span>المدفوع:</span>
                    <span>- {formatMoney(s.totalPaid)}</span>
                  </div>
                )}

                {/* Remaining */}
                <div className="flex justify-between items-center w-full gap-4 border-t border-primary/20 pt-1.5 mt-0.5">
                  <span className="text-sm font-semibold">
                    {s.remaining <= 0 ? '✓ تم السداد بالكامل' : 'المتبقي المستحق:'}
                  </span>
                  <span className={`text-xl font-bold whitespace-nowrap ${
                    s.remaining <= 0 ? 'text-green-600' : 'text-primary'
                  }`}>
                    {formatMoney(s.remaining)}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="bg-card p-6 rounded-lg border shadow-sm grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">الخزينة / الحساب البنكي المسدد منه</label>
          <select required value={bankId} onChange={e => setBankId(e.target.value)} className="w-full p-2 rounded border bg-background">
            <option value="">اختر الحساب...</option>
            {bankAccounts.map(b => (
              <option key={b.bank_account_id} value={b.bank_account_id}>{b.bank_name} - {b.account_name} ({formatMoney(b.current_balance)})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">المبلغ المسدد</label>
          <input required type="number" step="0.01" min="0" value={amount || ''} onChange={e => setAmount(parseFloat(e.target.value) || 0)} className="w-full p-2 rounded border bg-background font-bold text-lg text-primary" placeholder="0.00" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">المشروع المرتبط (للدفعات المقدمة)</label>
          <select value={projectId} onChange={e => setProjectId(e.target.value)} className="w-full p-2 rounded border bg-background">
            <option value="">عام (غير مرتبط بمشروع محدد)</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">البيان (ملاحظات)</label>
          <input type="text" value={memo} onChange={e => setMemo(e.target.value)} className="w-full p-2 rounded border bg-background" placeholder="دفعة مقدمة، سداد مستخلص، إلخ..." />
        </div>
      </div>

      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <div className="p-4 border-b bg-muted/30 flex justify-between items-center">
          <h3 className="font-bold">توزيع الدفعة (التخصيص)</h3>
          <div className="text-sm">
            المبلغ المتبقي كرصيد: <span className={`font-bold ${credit > 0 ? 'text-green-600' : 'text-muted-foreground'}`}>{formatMoney(credit)}</span>
          </div>
        </div>
        <table className="w-full text-sm text-right">
          <thead className="bg-muted/50 border-b">
            <tr>
              <th className="p-3 font-medium">المستند</th>
              <th className="p-3 font-medium">المشروع</th>
              <th className="p-3 font-medium">المتبقي للدفع</th>
              <th className="p-3 font-medium w-48">المبلغ المخصص</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {allocations.map((alloc, idx) => (
              <tr key={alloc.target_id} className={alloc.amount > 0 ? 'bg-primary/5' : ''}>

                {/* Description + breakdown for claim rows */}
                <td className="p-3">
                  <div className="font-semibold mb-1">{alloc.description}</div>
                  {alloc.target_type === 'claim' && alloc.grossTotal > 0 && (
                    <div className="text-xs space-y-0.5 text-muted-foreground mt-1.5 border-t border-muted/30 pt-1.5">
                      <div className="flex justify-between gap-6">
                        <span>إجمالي الأعمال التراكمي:</span>
                        <span className="font-medium text-foreground">{formatMoney(alloc.grossTotal)}</span>
                      </div>
                      {alloc.retained > 0 && (
                        <div className="flex justify-between gap-6 text-amber-600">
                          <span>المحتجز التراكمي (تأمين):</span>
                          <span className="font-medium">- {formatMoney(alloc.retained)}</span>
                        </div>
                      )}
                      <div className="flex justify-between gap-6 border-t border-primary/20 pt-1 mt-0.5 text-foreground font-semibold">
                        <span>المتبقي للدفع:</span>
                        <span className="text-primary">{formatMoney(alloc.netCumulative)}</span>
                      </div>
                      {alloc.tax > 0 && (
                        <div className="flex justify-between gap-6">
                          <span>الضريبة ({(alloc.tax_rate * 100).toFixed(1)}%):</span>
                          <span className="font-medium">+ {formatMoney(alloc.tax)}</span>
                        </div>
                      )}
                      {alloc.totalPaid > 0 && (
                        <div className="flex justify-between gap-6 text-green-600">
                          <span>المدفوع فعلياً:</span>
                          <span className="font-medium">- {formatMoney(alloc.totalPaid)}</span>
                        </div>
                      )}
                    </div>
                  )}
                </td>

                <td className="p-3 text-muted-foreground align-top pt-4">{alloc.project_name}</td>

                {/* Remaining */}
                <td className="p-3 align-top pt-4">
                  <span className={`font-bold text-base ${alloc.max > 0 ? 'text-primary' : 'text-muted-foreground'}`}>
                    {formatMoney(alloc.max)}
                  </span>
                </td>

                {/* Input */}
                <td className="p-3 align-top pt-4">
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    max={alloc.max}
                    value={alloc.amount || ''}
                    onChange={e => updateAllocation(idx, parseFloat(e.target.value) || 0)}
                    className="w-full p-2 rounded border bg-background text-primary font-medium text-left"
                  />
                </td>
              </tr>
            ))}
            {allocations.length === 0 && (
              <tr>
                <td colSpan={4} className="p-8 text-center text-muted-foreground">لا يوجد مستندات مفتوحة لهذا المقاول. أي مبلغ سيتم تسجيله كرصيد دائن.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={loading || !bankId || amount <= 0}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          تسجيل الدفعة
        </Button>
      </div>
    </form>
  );
}
