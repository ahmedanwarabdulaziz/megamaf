'use client';

import { useBulkPay } from './bulk-pay-context';

export function SelectAllCheckbox({ eligibleIds }: { eligibleIds: string[] }) {
  const { selected, selectAll, clear } = useBulkPay();
  if (eligibleIds.length === 0) return null;

  const allSelected = eligibleIds.every(id => selected.has(id));
  const someSelected = !allSelected && eligibleIds.some(id => selected.has(id));

  return (
    <input
      type="checkbox"
      checked={allSelected}
      ref={el => { if (el) el.indeterminate = someSelected; }}
      onChange={() => (allSelected ? clear() : selectAll(eligibleIds))}
      className="w-4 h-4 rounded border-muted-foreground cursor-pointer"
    />
  );
}
