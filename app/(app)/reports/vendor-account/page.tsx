import { createClient } from '@/lib/supabase/server';
import { VendorAccountReport } from '@/components/reports/vendor-account-report';
import { Briefcase } from 'lucide-react';

export const metadata = { title: 'كشوف حسابات المقاولين والموردين' };

export default async function VendorAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ vendor_id?: string }>
}) {
  const { vendor_id } = await searchParams;
  const supabase = await createClient();

  const { data: vendors } = await supabase
    .from('vendors')
    .select('id, name')
    .order('name');

  let statementData = null;

  if (vendor_id && vendors) {
    const { data } = await supabase
      .from('v_vendor_account')
      .select('*')
      .eq('party_id', vendor_id)
      .single();
    
    if (data) {
        statementData = data;
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4 bg-card p-6 rounded-lg border shadow-sm">
        <div className="p-3 bg-amber-100 text-amber-600 rounded-full">
          <Briefcase className="w-8 h-8" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">كشوف حسابات المقاولين والموردين</h1>
          <p className="text-muted-foreground mt-1">الإجمالي المفوتر والمدفوع والرصيد المتبقي</p>
        </div>
      </div>

      <VendorAccountReport 
        vendors={vendors || []} 
        data={statementData} 
        selectedVendorId={vendor_id || ''}
      />
    </div>
  );
}
