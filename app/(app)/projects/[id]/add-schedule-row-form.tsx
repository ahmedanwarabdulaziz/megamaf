'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2, Plus } from 'lucide-react';
import { addPaymentScheduleRow } from '@/lib/actions/owner-payments';

export function AddScheduleRowForm({ projectId }: { projectId: string }) {
  const [loading, setLoading] = useState(false);

  async function handleSubmit(formData: FormData) {
    setLoading(true);
    formData.append('project_id', projectId);
    
    const result = await addPaymentScheduleRow(formData);
    
    if (result?.error) {
      alert(result.error);
    } else {
      // Reset form
      const form = document.getElementById('add-schedule-form') as HTMLFormElement;
      if (form) form.reset();
    }
    setLoading(false);
  }

  return (
    <form id="add-schedule-form" action={handleSubmit} className="flex flex-wrap items-end gap-3">
      <div className="flex-1 min-w-[150px]">
        <label className="block text-xs font-medium mb-1">تاريخ الاستحقاق</label>
        <input required type="date" name="due_date" className="w-full p-2 text-sm rounded border bg-background" />
      </div>
      
      <div className="flex-1 min-w-[150px]">
        <label className="block text-xs font-medium mb-1">المبلغ المتوقع</label>
        <input required type="number" step="0.01" min="0" name="expected_amount" placeholder="0.00" className="w-full p-2 text-sm rounded border bg-background" />
      </div>

      <div className="flex-1 min-w-[150px]">
        <label className="block text-xs font-medium mb-1">طريقة الدفع</label>
        <select name="method" className="w-full p-2 text-sm rounded border bg-background">
          <option value="">غير محدد</option>
          <option value="cash">نقدي</option>
          <option value="bank_transfer">تحويل بنكي</option>
          <option value="cheque">شيك</option>
        </select>
      </div>

      <div className="flex-2 min-w-[200px]">
        <label className="block text-xs font-medium mb-1">ملاحظات</label>
        <input type="text" name="notes" placeholder="ملاحظات اختيارية..." className="w-full p-2 text-sm rounded border bg-background" />
      </div>

      <Button type="submit" disabled={loading} size="sm" className="h-[38px]">
        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
        إضافة
      </Button>
    </form>
  );
}
