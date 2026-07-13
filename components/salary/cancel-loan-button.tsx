'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { cancelLoan } from '@/lib/actions/loans';

export function CancelLoanButton({ loanId, employeeId }: { loanId: string; employeeId: string }) {
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  function onCancel() {
    if (!confirm('هل أنت متأكد من إلغاء هذه السلفة؟')) return;
    startTransition(async () => {
      setLoading(true);
      const formData = new FormData();
      formData.set('loan_id', loanId);
      formData.set('employee_id', employeeId);
      const result = await cancelLoan(formData);
      if (result?.error) {
        alert(result.error);
      } else {
        router.refresh();
      }
      setLoading(false);
    });
  }

  return (
    <Button size="sm" variant="destructive" onClick={onCancel} disabled={isPending || loading}>
      إلغاء السلفة
    </Button>
  );
}
