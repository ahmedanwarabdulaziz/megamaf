'use client';

import { useEffect, useId, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function usePendingApprovalsCount(enabled: boolean) {
  const [count, setCount] = useState(0);
  const instanceId = useId();

  useEffect(() => {
    if (!enabled) return;
    const supabase = createClient();

    // Pending expenses + pending vendor payment requests both wait for an
    // approver on /expenses/approvals, so both count toward the badge.
    async function fetchCount() {
      const [{ count: pendingExpenses }, { count: pendingPayments }] = await Promise.all([
        supabase.from('expenses').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        supabase.from('vendor_payment_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      ]);
      setCount((pendingExpenses || 0) + (pendingPayments || 0));
    }

    fetchCount();

    // Channel name must be unique per mounted instance — DesktopNav and MobileNav
    // both use this hook at the same time, and Supabase reuses an existing channel
    // object for a repeated topic name, which throws if you .on() it after it's
    // already subscribed.
    const channel = supabase
      .channel(`expenses-pending-approvals-count-${instanceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, fetchCount)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'vendor_payment_requests' }, fetchCount)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, instanceId]);

  return count;
}
