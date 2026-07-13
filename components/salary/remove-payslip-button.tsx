'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { removePayslipFromRun } from '@/lib/actions/salary';

export function RemovePayslipButton({ payslipId, runId, employeeName }: { payslipId: string; runId: string; employeeName: string }) {
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  function onRemove() {
    if (!confirm(`هل أنت متأكد من حذف قسيمة راتب "${employeeName}" من هذه الدورة؟`)) return;
    startTransition(async () => {
      setLoading(true);
      const formData = new FormData();
      formData.set('payslip_id', payslipId);
      formData.set('run_id', runId);
      const result = await removePayslipFromRun(formData);
      if (result?.error) {
        alert(result.error);
      } else {
        router.refresh();
      }
      setLoading(false);
    });
  }

  return (
    <Button size="icon" variant="ghost" onClick={onRemove} disabled={isPending || loading} title="حذف">
      <Trash2 className="w-4 h-4 text-destructive" />
    </Button>
  );
}
