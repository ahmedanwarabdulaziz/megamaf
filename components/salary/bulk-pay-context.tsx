'use client';

import { createContext, useContext } from 'react';

export type BulkPayCtx = {
  selected: Set<string>;
  toggle: (id: string) => void;
  selectAll: (ids: string[]) => void;
  clear: () => void;
};

export const BulkPayContext = createContext<BulkPayCtx | null>(null);

export function useBulkPay() {
  const ctx = useContext(BulkPayContext);
  if (!ctx) throw new Error('useBulkPay must be used within BulkPayProvider');
  return ctx;
}
