'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { approveExpense, rejectExpense } from '@/lib/actions/expenses';

export function ApproveRejectButtons({ expenseId }: { expenseId: string }) {
  const [isPending, startTransition] = useTransition();

  function onApprove() {
    startTransition(async () => {
      const result = await approveExpense(expenseId);
      if (result?.error) {
        alert(result.error);
      }
    });
  }

  function onReject() {
    if (!confirm('هل أنت متأكد من الرفض؟')) return;
    startTransition(async () => {
      const result = await rejectExpense(expenseId);
      if (result?.error) {
        alert(result.error);
      }
    });
  }

  return (
    <div className="flex gap-2">
      <Button 
        onClick={onApprove} 
        disabled={isPending} 
        variant="default" 
        className="bg-green-600 hover:bg-green-700"
        size="sm"
      >
        اعتماد
      </Button>
      <Button 
        onClick={onReject} 
        disabled={isPending} 
        variant="destructive"
        size="sm"
      >
        رفض
      </Button>
    </div>
  );
}
