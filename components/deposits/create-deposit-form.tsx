'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { createDeposit } from '@/lib/actions/deposits';
import { formatMoney } from '@/lib/money';

export function CreateDepositForm({ bankAccounts }: { bankAccounts: any[] }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const [profitType, setProfitType] = useState('annual_rate');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    const result = await createDeposit(formData);
    
    if (result.error) {
      alert(result.error);
      setLoading(false);
    } else {
      router.push(`/deposits/${result.id}`);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-card p-6 rounded-lg border shadow-sm space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">اسم الوديعة / الشهادة</label>
          <input required name="name" className="w-full p-2 rounded border bg-background" placeholder="مثال: شهادة استثمار ثلاثية" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">اسم البنك المصدر</label>
          <input required name="bank_name" className="w-full p-2 rounded border bg-background" placeholder="مثال: البنك الأهلي المصري" />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">أصل المبلغ (رأس المال)</label>
          <input required type="number" step="0.01" min="1" name="principal_amount" className="w-full p-2 rounded border bg-background" placeholder="0.00" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">تاريخ الإصدار</label>
          <input required type="date" name="start_date" defaultValue={new Date().toISOString().split('T')[0]} className="w-full p-2 rounded border bg-background" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">مدة الشهادة (بالأشهر)</label>
          <input required type="number" min="1" name="term_months" className="w-full p-2 rounded border bg-background" placeholder="مثال: 12 أو 36" />
        </div>
      </div>

      <div className="border-t pt-4">
        <h3 className="font-bold mb-4">إعدادات العائد</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">نوع العائد</label>
            <select required name="profit_type" value={profitType} onChange={e => setProfitType(e.target.value)} className="w-full p-2 rounded border bg-background">
              <option value="annual_rate">نسبة مئوية سنوية (%)</option>
              <option value="fixed_total">مبلغ ثابت إجمالي</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">{profitType === 'annual_rate' ? 'نسبة العائد السنوي (%)' : 'إجمالي مبلغ العائد'}</label>
            <input required type="number" step="0.01" min="0" name="profit_value" className="w-full p-2 rounded border bg-background" placeholder="مثال: 12.5" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">دورية صرف العائد</label>
            <select required name="payout_frequency" className="w-full p-2 rounded border bg-background">
              <option value="monthly">شهري</option>
              <option value="quarterly">ربع سنوي</option>
              <option value="semiannual">نصف سنوي</option>
              <option value="annual">سنوي</option>
              <option value="at_maturity">في نهاية المدة</option>
            </select>
          </div>
        </div>
      </div>

      <div className="border-t pt-4 space-y-4">
        <div>
          <label className="block text-sm font-medium mb-1">الحساب البنكي الافتراضي للتحصيل (اختياري)</label>
          <select name="default_bank_account_id" className="w-full p-2 rounded border bg-background">
            <option value="">-- اختر الحساب (يمكن تحديده وقت التحصيل) --</option>
            {bankAccounts.map((b: any) => (
              <option key={b.bank_account_id} value={b.bank_account_id}>
                {b.bank_name} - {b.account_name} ({formatMoney(b.current_balance)})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">وصف إضافي</label>
          <textarea name="description" className="w-full p-2 rounded border bg-background" rows={2} />
        </div>
      </div>

      <div className="flex justify-end border-t pt-4">
        <Button type="submit" disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          إصدار الشهادة وإنشاء جدول العوائد
        </Button>
      </div>
    </form>
  );
}
