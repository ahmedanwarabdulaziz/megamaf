import { createClient } from '@/lib/supabase/server';
import { OwnerAccountReport } from '@/components/reports/owner-account-report';
import { FileText } from 'lucide-react';

export const metadata = { title: 'كشوف حسابات الملاك' };

export default async function OwnerAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ owner_id?: string }>
}) {
  const { owner_id } = await searchParams;
  const supabase = await createClient();

  const { data: owners } = await supabase
    .from('project_owners')
    .select('id, name')
    .order('name');

  let statementData = null;

  if (owner_id && owners) {
    const { data } = await supabase
      .from('v_owner_account')
      .select('*')
      .eq('party_id', owner_id)
      .single();
    
    if (data) {
        statementData = data;
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4 bg-card p-6 rounded-lg border shadow-sm">
        <div className="p-3 bg-cyan-100 text-cyan-600 rounded-full">
          <FileText className="w-8 h-8" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">كشوف حسابات الملاك</h1>
          <p className="text-muted-foreground mt-1">الدفعات المستحقة والمقبوضة والرصيد</p>
        </div>
      </div>

      <OwnerAccountReport 
        owners={owners || []} 
        data={statementData} 
        selectedOwnerId={owner_id || ''}
      />
    </div>
  );
}
