'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Trash2, Loader2 } from 'lucide-react';
import { deletePaymentScheduleRow } from '@/lib/actions/owner-payments';

export function DeleteScheduleRowButton({ id, projectId }: { id: string, projectId: string }) {
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    if (!confirm('هل أنت متأكد من حذف هذه الدفعة؟')) return;
    
    setLoading(true);
    const result = await deletePaymentScheduleRow(id, projectId);
    
    if (result?.error) {
      alert(result.error);
    }
    setLoading(false);
  }

  return (
    <Button variant="ghost" size="icon" onClick={handleDelete} disabled={loading}>
      {loading ? <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /> : <Trash2 className="w-4 h-4 text-destructive" />}
    </Button>
  );
}
