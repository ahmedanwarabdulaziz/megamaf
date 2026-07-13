'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { approvePayrollRun } from '@/lib/actions/salary';

export function ApproveRunButton({ runId }: { runId: string }) {
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);

  function onApprove() {
    if (!confirm('سيتم اعتماد جميع قسائم الرواتب في هذه الدورة. هل أنت متأكد؟')) return;
    startTransition(async () => {
      setLoading(true);
      const formData = new FormData();
      formData.set('run_id', runId);
      const result = await approvePayrollRun(formData);
      if (result?.error) alert(result.error);
      setLoading(false);
    });
  }

  return (
    <Button className="bg-green-600 hover:bg-green-700" onClick={onApprove} disabled={isPending || loading}>
      اعتماد الدورة
    </Button>
  );
}
