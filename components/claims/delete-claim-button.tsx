'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { deleteClaim } from '@/lib/actions/claims';
import { Trash2 } from 'lucide-react';

export function DeleteClaimButton({ claimId, redirectTo }: { claimId: string; redirectTo?: string }) {
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  async function handleDelete() {
    try {
      setLoading(true);
      setError('');
      const result = await deleteClaim(claimId);
      if (result?.error) {
        setError(result.error);
        setConfirming(false);
        return;
      }
      if (redirectTo) router.push(redirectTo);
    } catch (e: any) {
      setError(e.message || 'حدث خطأ');
      setConfirming(false);
    } finally {
      setLoading(false);
    }
  }

  if (error) return (
    <span className="text-xs text-destructive">{error}</span>
  );

  if (confirming) return (
    <div className="flex items-center gap-1">
      <span className="text-xs text-muted-foreground whitespace-nowrap">تأكيد الحذف؟</span>
      <Button
        variant="ghost"
        size="icon"
        onClick={handleDelete}
        disabled={loading}
        className="h-7 w-7 text-destructive hover:bg-destructive/10"
        title="نعم، احذف"
      >
        {loading ? (
          <span className="w-3 h-3 border-2 border-destructive border-t-transparent rounded-full animate-spin" />
        ) : (
          <Trash2 className="w-3.5 h-3.5" />
        )}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setConfirming(false)}
        disabled={loading}
        className="h-7 w-7"
        title="إلغاء"
      >
        <span className="text-xs font-bold">✕</span>
      </Button>
    </div>
  );

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={() => setConfirming(true)}
      title="حذف"
    >
      <Trash2 className="w-4 h-4 text-destructive" />
    </Button>
  );
}
