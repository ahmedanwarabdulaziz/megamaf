'use client';

import { useBulkPay } from './bulk-pay-context';

export function SelectPayslipCheckbox({ payslipId, eligible }: { payslipId: string; eligible: boolean }) {
  const { selected, toggle } = useBulkPay();
  if (!eligible) return <span className="inline-block w-4 h-4" />;
  return (
    <input
      type="checkbox"
      checked={selected.has(payslipId)}
      onChange={() => toggle(payslipId)}
      className="w-4 h-4 rounded border-muted-foreground cursor-pointer"
    />
  );
}
