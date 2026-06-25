import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { VendorPaymentCalculator } from './calculator';

export default async function PayVendorPage({ params }: { params: Promise<{ vendorId: string }> }) {
  const { vendorId } = await params;
  const supabase = await createClient();

  const { data: vendor } = await supabase.from('vendors').select('*').eq('id', vendorId).single();
  if (!vendor) notFound();

  const { data: bankAccounts } = await supabase.from('v_bank_account_balances').select('*').order('account_name');

  // Fetch all open vendor docs
  const { data: docs } = await supabase.from('v_vendor_account').select('*').eq('party_id', vendorId).order('document_date', { ascending: true });
  
  if (docs && docs.length > 0) {
    const claimIds = docs.filter(d => d.document_type === 'claim').map(d => d.document_id);
    const invoiceIds = docs.filter(d => d.document_type === 'invoice').map(d => d.document_id);
    const retentionIds = docs.filter(d => d.document_type === 'retention_release').map(d => d.document_id);

    const [
      { data: claimPaid },
      { data: invoicePaid },
      { data: retentionPaid }
    ] = await Promise.all([
      claimIds.length > 0 ? supabase.from('v_claim_paid').select('*').in('claim_id', claimIds) : { data: null },
      invoiceIds.length > 0 ? supabase.from('v_invoice_paid').select('*').in('invoice_id', invoiceIds) : { data: null },
      retentionIds.length > 0 ? supabase.from('v_retention_paid').select('*').in('retention_id', retentionIds) : { data: null },
    ]);

    docs.forEach(d => {
      if (d.document_type === 'claim') {
        d.amount_paid = claimPaid?.find(p => p.claim_id === d.document_id)?.paid_amount || 0;
      } else if (d.document_type === 'invoice') {
        d.amount_paid = invoicePaid?.find(p => p.invoice_id === d.document_id)?.paid_amount || 0;
      } else if (d.document_type === 'retention_release') {
        d.amount_paid = retentionPaid?.find(p => p.retention_id === d.document_id)?.paid_amount || 0;
      }
    });
  }

  // Filter for payables that still have a balance
  const openDocs = docs?.filter(d => d.document_type !== 'payment' && (d.amount_due - d.amount_paid) > 0) || [];

  const { data: projects } = await supabase.from('projects').select('id, name').order('name');

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">تسجيل دفعة لمقاول</h1>
        <p className="text-muted-foreground mt-1">المقاول: {vendor.name}</p>
      </div>

      <VendorPaymentCalculator vendorId={vendorId} openDocs={openDocs} bankAccounts={bankAccounts || []} projects={projects || []} />
    </div>
  );
}
