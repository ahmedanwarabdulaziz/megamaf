import { createClient } from '@/lib/supabase/server';
import { TransferForm } from './transfer-form';

export const metadata = { title: 'نقل مخزون' };

export default async function TransferPage() {
  const supabase = await createClient();
  
  const { data: warehouses } = await supabase.from('warehouses').select('*, projects(name)').order('name');
  
  // To allow selecting an item, we can fetch all stock and items
  const { data: stock } = await supabase.from('v_stock_on_hand').select('*').gt('qty_on_hand', 0);

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">تحويل مخزني</h1>
        <p className="text-muted-foreground mt-1">نقل كميات من مستودع لآخر</p>
      </div>

      <TransferForm warehouses={warehouses || []} stock={stock || []} />
    </div>
  );
}
