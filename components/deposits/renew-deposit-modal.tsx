'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { CreateDepositForm } from '@/components/deposits/create-deposit-form';

export function RenewDepositModal({ deposit, bankAccounts }: { deposit: any; bankAccounts: any[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  const maturityDate = new Date(deposit.start_date + 'T00:00:00Z');
  maturityDate.setUTCMonth(maturityDate.getUTCMonth() + deposit.term_months);

  const dialog = isOpen && mounted
    ? createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
          <div className="bg-background rounded-lg shadow-lg w-full max-w-3xl my-8">
            <div className="flex items-center justify-between p-4 border-b">
              <h2 className="text-lg font-bold">تجديد شهادة: {deposit.name}</h2>
              <button onClick={() => setIsOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4">
              <CreateDepositForm
                bankAccounts={bankAccounts}
                renewFromId={deposit.id}
                initialValues={{
                  name: deposit.name,
                  bank_name: deposit.bank_name,
                  principal_amount: deposit.principal_amount,
                  start_date: maturityDate.toISOString().split('T')[0],
                  term_months: deposit.term_months,
                  profit_type: deposit.profit_type,
                  profit_value: deposit.profit_value,
                  payout_frequency: deposit.payout_frequency,
                  default_bank_account_id: deposit.default_bank_account_id ?? '',
                }}
              />
            </div>
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <>
      <Button size="sm" onClick={() => setIsOpen(true)}>تجديد الشهادة</Button>
      {dialog}
    </>
  );
}
