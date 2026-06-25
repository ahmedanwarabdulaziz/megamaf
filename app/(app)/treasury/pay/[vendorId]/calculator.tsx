'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { payVendor } from '@/lib/actions/payments';
import { formatMoney } from '@/lib/money';

export function VendorPaymentCalculator({ vendorId, openDocs, bankAccounts, projects }: { vendorId: string, openDocs: any[], bankAccounts: any[], projects: {id: string, name: string}[] }) {
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
    let remaining = amount;
    const newAllocations = openDocs.map(doc => {
      const remainingDue = doc.amount_due - doc.amount_paid;
      const allocAmount = Math.min(remaining, remainingDue);
      remaining -= allocAmount;
      return {
        target_type: doc.document_type,
        target_id: doc.document_id,
        amount: allocAmount,
        max: remainingDue,
        description: doc.description,
        project_name: doc.project_name
      };
    });
    setAllocations(newAllocations);
  }, [amount, openDocs]);

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
                <td className="p-3 font-medium">{alloc.description}</td>
                <td className="p-3 text-muted-foreground">{alloc.project_name}</td>
                <td className="p-3">{formatMoney(alloc.max)}</td>
                <td className="p-3">
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
