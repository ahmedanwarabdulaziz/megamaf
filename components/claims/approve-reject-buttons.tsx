'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { approveClaim, rejectClaim, revertClaimToPending } from '@/lib/actions/claims';

export function ClaimApproveRejectButtons({ claimId }: { claimId: string }) {
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  function onApprove() {
    startTransition(async () => {
      setLoading(true);
      const result = await approveClaim(claimId);
      if (result?.error) alert(result.error);
      setLoading(false);
    });
  }

  function onConfirmReject() {
    if (!reason.trim()) {
      setError('يرجى كتابة سبب الرفض');
      return;
    }
    startTransition(async () => {
      setLoading(true);
      const result = await rejectClaim(claimId, reason);
      if (result?.error) {
        setError(result.error);
      } else {
        setShowRejectModal(false);
      }
      setLoading(false);
    });
  }

  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="default"
        className="bg-green-600 hover:bg-green-700"
        onClick={onApprove}
        disabled={isPending || loading}
      >
        اعتماد
      </Button>
      <Button
        size="sm"
        variant="destructive"
        onClick={() => { setShowRejectModal(true); setReason(''); setError(''); }}
        disabled={isPending || loading}
      >
        رفض
      </Button>

      {showRejectModal && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center pb-16 sm:pb-0">
          <div
            className="fixed inset-0 bg-background/80 backdrop-blur-sm"
            onClick={() => !loading && setShowRejectModal(false)}
          />
          <div className="relative z-[60] w-full max-w-md bg-card shadow-2xl rounded-t-2xl sm:rounded-xl border-t-4 sm:border-2 border-destructive p-4 sm:p-6 flex flex-col gap-3">
            <h3 className="text-lg font-semibold">سبب رفض المستخلص</h3>
            <p className="text-sm text-muted-foreground">
              سيبقى المستخلص قيد المراجعة مع إظهار هذا السبب لمن قدّمه حتى يتمكن من تصحيحه وإعادة تقديمه.
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
                disabled={loading}
                onClick={() => setShowRejectModal(false)}
              >
                إلغاء
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={loading}
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

/** Sends an already-approved claim back to 'pending' so it can be corrected and re-approved.
 *  Super-admin only — reopening an approved financial record needs to be deliberate. */
export function RevertClaimToPendingButton({ claimId }: { claimId: string }) {
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);

  function onRevert() {
    if (!confirm('سيتم إرجاع هذا المستخلص إلى "قيد المراجعة" ليصبح قابلاً للتعديل من جديد. هل أنت متأكد؟')) return;
    startTransition(async () => {
      setLoading(true);
      const result = await revertClaimToPending(claimId);
      if (result?.error) alert(result.error);
      setLoading(false);
    });
  }

  return (
    <Button
      size="sm"
      variant="outline"
      className="text-amber-700 border-amber-300 hover:bg-amber-50"
      onClick={onRevert}
      disabled={isPending || loading}
    >
      ↩️ إرجاع لقيد المراجعة
    </Button>
  );
}
