import { createClient } from '@/lib/supabase/server';
import Link from 'next/link';
import { Wallet, Plus } from 'lucide-react';
import { formatMoney } from '@/lib/money';

export const metadata = { title: 'الودائع والشهادات' };

export default async function DepositsPage() {
  const supabase = await createClient();

  const { data: deposits } = await supabase
    .from('deposits')
    .select(`
      *,
      deposit_payouts ( expected_amount, collected_amount, is_collected )
    `)
    .order('created_at', { ascending: false });

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between bg-card p-6 rounded-lg border shadow-sm">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-primary/10 rounded-full">
            <Wallet className="w-8 h-8 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold">الودائع والشهادات</h1>
            <p className="text-muted-foreground mt-1">إدارة الشهادات البنكية وحساب العوائد</p>
          </div>
        </div>
        <Link href="/deposits/create" className="bg-primary text-primary-foreground hover:bg-primary/90 px-4 py-2 rounded-md font-medium text-sm flex items-center gap-2">
          <Plus className="w-4 h-4" /> إصدار شهادة/وديعة
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {deposits?.map(d => {
          const totalExpected = d.deposit_payouts?.reduce((sum: number, p: any) => sum + Number(p.expected_amount), 0) || 0;
          const totalCollected = d.deposit_payouts?.reduce((sum: number, p: any) => sum + (p.is_collected ? Number(p.collected_amount) : 0), 0) || 0;
          
          return (
            <Link key={d.id} href={`/deposits/${d.id}`} className="block bg-card p-5 rounded-lg border shadow-sm hover:border-primary transition-colors">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="font-bold text-lg">{d.name}</h3>
                  <p className="text-sm text-muted-foreground">{d.bank_name}</p>
                </div>
                <div className="bg-muted px-2 py-1 rounded text-xs font-medium">
                  {d.term_months} شهر
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">أصل المبلغ:</span>
                  <span className="font-semibold">{formatMoney(d.principal_amount)}</span>
                </div>
                
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">العائد المتوقع:</span>
                  <span className="font-semibold text-primary">{formatMoney(totalExpected)}</span>
                </div>
                
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">العائد المحصل:</span>
                  <span className="font-semibold text-green-600">{formatMoney(totalCollected)}</span>
                </div>
              </div>
              
              <div className="mt-4 pt-4 border-t text-xs text-muted-foreground flex justify-between">
                <span>تاريخ الإصدار: {new Date(d.start_date).toLocaleDateString('ar-EG')}</span>
                <span>
                  {d.profit_type === 'annual_rate' ? `عائد سنوي ${d.profit_value}%` : 'عائد ثابت'}
                </span>
              </div>
            </Link>
          );
        })}

        {(!deposits || deposits.length === 0) && (
          <div className="col-span-full bg-card p-12 text-center rounded-lg border shadow-sm">
            <Wallet className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
            <h3 className="text-lg font-medium text-muted-foreground">لا يوجد ودائع أو شهادات حالياً</h3>
            <p className="text-sm text-muted-foreground mt-2">قم بإنشاء وديعة جديدة لإدارة أرباحها.</p>
          </div>
        )}
      </div>
    </div>
  );
}
