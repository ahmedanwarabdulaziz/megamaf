'use client';

import { useEffect, useId, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

export function usePendingInvoicesCount(enabled: boolean) {
  const [count, setCount] = useState(0);
  const instanceId = useId();

  useEffect(() => {
    if (!enabled) return;
    const supabase = createClient();

    async function fetchCount() {
      const { count: pendingCount } = await supabase
        .from('invoices')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'pending');
      setCount(pendingCount || 0);
    }

    fetchCount();

    // Channel name must be unique per mounted instance — DesktopNav and MobileNav
    // both use this hook at the same time, and Supabase reuses an existing channel
    // object for a repeated topic name, which throws if you .on() it after it's
    // already subscribed.
    const channel = supabase
      .channel(`invoices-pending-count-${instanceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'invoices' }, fetchCount)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, instanceId]);

  return count;
}
