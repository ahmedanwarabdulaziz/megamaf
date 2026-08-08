'use client';

import { useState } from 'react';
import { BulkPayContext } from './bulk-pay-context';
import { BulkPayBar } from './bulk-pay-bar';

type EligiblePayslip = { id: string; employeeName: string; remaining: number };
type BankAccount = { bank_account_id: string; bank_name: string; account_name: string; current_balance: number };
type Employee = { id: string; full_name: string };

export function BulkPayProvider({
  runId,
  eligiblePayslips,
  bankAccounts,
  employees,
  children,
}: {
  runId: string;
  eligiblePayslips: EligiblePayslip[];
  bankAccounts: BankAccount[];
  employees: Employee[];
  children: React.ReactNode;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function selectAll(ids: string[]) {
    setSelected(new Set(ids));
  }

  function clear() {
    setSelected(new Set());
  }

  const selectedRows = eligiblePayslips.filter(p => selected.has(p.id));

  return (
    <BulkPayContext.Provider value={{ selected, toggle, selectAll, clear }}>
      <BulkPayBar runId={runId} selectedRows={selectedRows} bankAccounts={bankAccounts} employees={employees} onClear={clear} onDone={clear} />
      {children}
    </BulkPayContext.Provider>
  );
}
