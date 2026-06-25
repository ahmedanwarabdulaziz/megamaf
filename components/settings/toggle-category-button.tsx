'use client';

import { useState, useTransition } from 'react';
import { toggleExpenseCategory } from '@/lib/actions/categories';

export function ToggleCategoryButton({ id, isActive }: { id: string, isActive: boolean }) {
  const [isPending, startTransition] = useTransition();
  const [optimisticState, setOptimisticState] = useState(isActive);

  function toggle() {
    const newState = !optimisticState;
    setOptimisticState(newState);
    startTransition(async () => {
      try {
        await toggleExpenseCategory(id, newState);
      } catch (e: any) {
        setOptimisticState(!newState); // revert
        alert(e.message);
      }
    });
  }

  return (
    <button 
      onClick={toggle}
      disabled={isPending}
      className={`text-xs px-2 py-1 rounded-full border transition-colors ${
        optimisticState 
          ? 'bg-green-500/10 text-green-500 border-green-500/20' 
          : 'bg-red-500/10 text-red-500 border-red-500/20'
      }`}
    >
      {optimisticState ? 'نشط' : 'معطل'}
    </button>
  );
}
