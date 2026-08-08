'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Trash2 } from 'lucide-react';
import { deletePayrollRun } from '@/lib/actions/salary';

export function DeletePayrollRunButton({ runId, label, redirectTo }: { runId: string; label: string; redirectTo?: string }) {
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  function onDelete() {
    if (!confirm(`هل أنت متأكد من حذف دورة رواتب "${label}"؟ سيتم حذف جميع قسائم الرواتب المرتبطة بها. لا يمكن التراجع عن هذا الإجراء.`)) return;
    startTransition(async () => {
      setLoading(true);
      const formData = new FormData();
      formData.set('run_id', runId);
      const result = await deletePayrollRun(formData);
      if (result?.error) {
        alert(result.error);
      } else if (redirectTo) {
        router.push(redirectTo);
      } else {
        router.refresh();
      }
      setLoading(false);
    });
  }

  return (
    <Button size="icon" variant="ghost" onClick={onDelete} disabled={isPending || loading} title="حذف الدورة">
      <Trash2 className="w-4 h-4 text-destructive" />
    </Button>
  );
}
