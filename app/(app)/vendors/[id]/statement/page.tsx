import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { formatMoney } from '@/lib/money';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export const metadata = { title: 'كشف حساب مقاول' };

export default async function VendorStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: vendor } = await supabase.from('vendors').select('*').eq('id', id).single();
  if (!vendor) notFound();

  const { data: statementRows } = await supabase
    .from('v_vendor_account')
    .select('*')
    .eq('party_id', id)
    .order('document_date', { ascending: true })
    .order('created_at', { ascending: true });

  const { data: balances } = await supabase
    .from('v_vendor_balances')
    .select('*')
    .eq('vendor_id', id)
    .single();

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/treasury?tab=payables" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-6 h-6" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">كشف حساب مقاول</h1>
          <p className="text-muted-foreground mt-1">المقاول: {vendor.name}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-card p-4 rounded-lg border shadow-sm">
          <p className="text-sm text-muted-foreground mb-1">إجمالي المستحقات (له)</p>
          <p className="text-xl font-bold text-amber-600">{formatMoney(balances?.total_due || 0)}</p>
        </div>
        <div className="bg-card p-4 rounded-lg border shadow-sm">
          <p className="text-sm text-muted-foreground mb-1">إجمالي المدفوعات (ما تم صرفه)</p>
          <p className="text-xl font-bold text-green-600">{formatMoney(balances?.total_paid || 0)}</p>
        </div>
        <div className="bg-card p-4 rounded-lg border shadow-sm bg-muted/30">
          <p className="text-sm text-muted-foreground mb-1">الرصيد المتبقي</p>
          <p className="text-2xl font-bold text-primary">{formatMoney(balances?.balance || 0)}</p>
        </div>
      </div>

      <div className="bg-card rounded-lg border shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="p-3 font-medium">التاريخ</th>
                <th className="p-3 font-medium">المشروع</th>
                <th className="p-3 font-medium">البيان</th>
                <th className="p-3 font-medium text-amber-600">دائن (مستحق له)</th>
                <th className="p-3 font-medium text-green-600">مدين (دفعة منصرفة)</th>
                <th className="p-3 font-medium text-primary">الرصيد التراكمي</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {statementRows?.map((row, idx) => (
                <tr key={`${row.document_type}_${row.document_id}_${idx}`} className="hover:bg-muted/30 transition-colors">
                  <td className="p-3">{row.document_date}</td>
                  <td className="p-3 text-muted-foreground">{row.project_name || '-'}</td>
                  <td className="p-3 font-medium">{row.description}</td>
                  <td className="p-3 font-medium text-amber-600">{row.amount_due > 0 ? formatMoney(row.amount_due) : '-'}</td>
                  <td className="p-3 font-medium text-green-600">{row.amount_paid > 0 ? formatMoney(row.amount_paid) : '-'}</td>
                  <td className="p-3 font-bold text-primary" dir="ltr">{formatMoney(row.running_balance)}</td>
                </tr>
              ))}
              {(!statementRows || statementRows.length === 0) && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">لا يوجد حركات مسجلة.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
