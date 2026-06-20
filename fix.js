const { createClient } = require('@supabase/supabase-js');
const supabase = createClient('https://qqpumzvcthfbebaqtaqv.supabase.co', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFxcHVtenZjdGhmYmViYXF0YXF2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQzNjI5NSwiZXhwIjoyMDk3MDEyMjk1fQ.uqjPx7kGrdNvMdIyaCcv4vHzJLrGLG3OxazsdNRiDF4');

async function fix() {
  const { data: expenses } = await supabase.from('project_expenses').select('*').like('description', 'مستهلك مباشر من أمر الشراء رقم %');
  for (const exp of (expenses || [])) {
    const poNumberMatch = exp.description.match(/رقم (.*)/);
    if (!poNumberMatch) continue;
    const poNumber = poNumberMatch[1].trim();
    
    const { data: pos } = await supabase.from('purchase_orders').select('id').eq('po_number', poNumber).single();
    if (!pos) continue;
    
    const { data: items } = await supabase.from('purchase_order_items').select('quantity, total_price, item_catalog(name, unit_of_measure)').eq('po_id', pos.id).eq('item_type', 'consumable');
    
    if (items && items.length > 0) {
      const item = items.find(i => Number(i.total_price) === Number(exp.amount)) || items[0];
      const newDesc = `مستهلك مباشر (${item.quantity} ${item.item_catalog?.unit_of_measure || ''} ${item.item_catalog?.name || ''}) من أمر الشراء رقم ${poNumber}`;
      await supabase.from('project_expenses').update({ description: newDesc }).eq('id', exp.id);
      console.log('Updated', exp.id, 'to', newDesc);
    }
  }
}
fix();
