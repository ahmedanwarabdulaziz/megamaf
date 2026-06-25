'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/button';
import { approveInvoice, rejectInvoice } from '@/lib/actions/invoices';

export function InvoiceApproveRejectButtons({ invoiceId }: { invoiceId: string }) {
  const [isPending, startTransition] = useTransition();
  const [loading, setLoading] = useState(false);

  function onApprove() {
    startTransition(async () => {
      setLoading(true);
      const result = await approveInvoice(invoiceId);
      if (result?.error) alert(result.error);
      setLoading(false);
    });
  }

  function onReject() {
    if (!confirm('هل أنت متأكد من الرفض؟')) return;
    startTransition(async () => {
      setLoading(true);
      const result = await rejectInvoice(invoiceId);
      if (result?.error) alert(result.error);
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
        onClick={onReject}
        disabled={isPending || loading}
      >
        رفض
      </Button>
    </div>
  );
}
