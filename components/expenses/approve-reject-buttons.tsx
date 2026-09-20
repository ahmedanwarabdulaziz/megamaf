'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { approveExpense, rejectExpense } from '@/lib/actions/expenses';

type ActionResult = { error?: string; success?: boolean } | undefined | void;

/** Defaults to approving/rejecting an expense. Other approval kinds (e.g. a
 *  vendor payment request) pass their own actions and dialog wording. */
export function ApproveRejectButtons({
  expenseId,
  onSuccess,
  approveAction = approveExpense,
  rejectAction = rejectExpense,
  rejectTitle = 'سبب رفض المصروف',
  rejectHint = 'سيتم إظهار هذا السبب للموظف حتى يتمكن من تصحيح المصروف وإعادة تقديمه.',
}: {
  expenseId: string;
  onSuccess?: () => void;
  approveAction?: (id: string) => Promise<ActionResult>;
  rejectAction?: (id: string, reason?: string) => Promise<ActionResult>;
  rejectTitle?: string;
  rejectHint?: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  function onApprove() {
    startTransition(async () => {
      const result = await approveAction(expenseId);
      if (result?.error) {
        alert(result.error);
      } else {
        onSuccess?.();
      }
    });
  }

  function onConfirmReject() {
    if (!reason.trim()) {
      setError('يرجى كتابة سبب الرفض');
      return;
    }
    startTransition(async () => {
      const result = await rejectAction(expenseId, reason);
      if (result?.error) {
        setError(result.error);
      } else {
        setShowRejectModal(false);
        onSuccess?.();
      }
    });
  }

  return (
    <div className="flex gap-2 w-full">
      <Button
        onClick={onApprove}
        disabled={isPending}
        variant="default"
        className="bg-green-600 hover:bg-green-700 flex-1"
        size="sm"
      >
        اعتماد
      </Button>
      <Button
        onClick={() => { setShowRejectModal(true); setReason(''); setError(''); }}
        disabled={isPending}
        variant="destructive"
        size="sm"
        className="flex-1"
      >
        رفض
      </Button>

      {showRejectModal && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center pb-16 sm:pb-0">
          <div
            className="fixed inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => !isPending && setShowRejectModal(false)}
          />
          <div className="relative z-[60] w-full max-w-md bg-card shadow-2xl rounded-t-2xl sm:rounded-xl border-t-4 sm:border-2 border-destructive p-4 sm:p-6 flex flex-col gap-3">
            <h3 className="text-lg font-semibold">{rejectTitle}</h3>
            <p className="text-sm text-muted-foreground">
              {rejectHint}
            </p>
            <textarea
              autoFocus
              value={reason}
              onChange={(e) => { setReason(e.target.value); setError(''); }}
              rows={4}
              placeholder="اكتب سبب الرفض هنا..."
              className="w-full p-2 rounded-md border bg-background text-sm resize-none"
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={isPending}
                onClick={() => setShowRejectModal(false)}
              >
                إلغاء
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={isPending}
                onClick={onConfirmReject}
              >
                تأكيد الرفض
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
