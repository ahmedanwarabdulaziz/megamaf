'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Trash2 } from 'lucide-react';
import { deleteVendor } from '@/lib/actions/vendors';

/** Removes a vendor added by mistake. The server refuses if it has any
 *  transactions (claims, invoices, payments, opening balance, payment requests)
 *  and says exactly what it found, so the button is safe to show on every row. */
export function DeleteVendorButton({ vendorId, vendorName }: { vendorId: string; vendorName: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function onDelete() {
    if (!confirm(`سيتم حذف "${vendorName}" نهائياً. يُسمح بذلك فقط إذا لم يكن عليه أي معاملات. هل أنت متأكد؟`)) return;
    startTransition(async () => {
      const result = await deleteVendor(vendorId);
      if (result?.error) {
        alert(result.error);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <button
      type="button"
      onClick={onDelete}
      disabled={isPending}
      title="حذف (فقط إذا لم يكن عليه معاملات)"
      className="inline-flex items-center justify-center w-8 h-8 rounded-md text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-50"
    >
      <Trash2 className="w-4 h-4" />
    </button>
  );
}
