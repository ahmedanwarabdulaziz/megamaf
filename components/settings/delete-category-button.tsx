'use client';

import { useState, useTransition } from 'react';
import { Trash2, Check, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { deleteExpenseCategory } from '@/lib/actions/categories';

export function DeleteCategoryButton({ id }: { id: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleDelete = () => {
    setError(null);
    startTransition(async () => {
      const result = await deleteExpenseCategory(id);
      if ('error' in result) {
        setError(result.error);
        setConfirming(false);
      } else {
        router.refresh();
      }
    });
  };

  if (error) {
    return (
      <span className="text-xs text-destructive font-medium flex items-center gap-1">
        {error}
        <button onClick={() => setError(null)} className="underline text-muted-foreground hover:text-foreground ml-1">
          حسناً
        </button>
      </span>
    );
  }

  if (confirming) {
    return (
      <span className="flex items-center gap-1">
        <button
          onClick={handleDelete}
          disabled={isPending}
          className="p-1 rounded text-destructive hover:bg-destructive/10 transition-colors"
          title="تأكيد الحذف"
        >
          <Check className="w-4 h-4" />
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={isPending}
          className="p-1 rounded text-muted-foreground hover:bg-muted transition-colors"
          title="إلغاء"
        >
          <X className="w-4 h-4" />
        </button>
      </span>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
      title="حذف"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  );
}
