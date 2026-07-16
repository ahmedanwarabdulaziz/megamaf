'use client';

import { useState, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { recordTransfer } from '@/lib/actions/inventory';

export function TransferForm({ warehouses, stock }: { warehouses: any[], stock: any[] }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);

  const [fromWh, setFromWh] = useState('');
  const [toWh, setToWh] = useState('');
  const [itemId, setItemId] = useState('');
  const [qty, setQty] = useState('');
  const [notes, setNotes] = useState('');

  // Filter items available in the selected fromWh
  const availableItems = useMemo(() => {
    if (!fromWh) return [];
    return stock.filter(s => s.warehouse_id === fromWh);
  }, [fromWh, stock]);

  // Group by category for the item <optgroup> dropdown
  const itemGroups = useMemo(() => {
    const groups: { label: string; items: any[] }[] = [];
    for (const s of availableItems) {
      const label = s.category_name
        ? (s.parent_category_name ? `${s.parent_category_name} / ${s.category_name}` : s.category_name)
        : 'غير مصنف';
      const group = groups.find(g => g.label === label);
      if (group) group.items.push(s);
      else groups.push({ label, items: [s] });
    }
    return groups.sort((a, b) => a.label.localeCompare(b.label, 'ar'));
  }, [availableItems]);

  const maxQty = useMemo(() => {
    if (!fromWh || !itemId) return 0;
    const s = availableItems.find(i => i.item_id === itemId);
    return s ? Number(s.qty_on_hand) : 0;
  }, [fromWh, itemId, availableItems]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (fromWh === toWh) {
      alert('لا يمكن التحويل لنفس المستودع.');
      return;
    }
    if (Number(qty) > maxQty) {
      alert('الكمية المطلوبة أكبر من الرصيد المتاح.');
      return;
    }
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    const formData = new FormData();
    formData.append('from_warehouse_id', fromWh);
    formData.append('to_warehouse_id', toWh);
    formData.append('item_id', itemId);
    formData.append('qty', qty);
    formData.append('notes', notes);
    try {
      const result = await recordTransfer(formData);
      if (result.error) {
        alert(result.error);
      } else {
        router.push('/inventory');
      }
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-card p-6 rounded-lg border shadow-sm space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">من مستودع (المصدر)</label>
          <select required value={fromWh} onChange={e => { setFromWh(e.target.value); setItemId(''); }} className="w-full p-2 rounded border bg-background">
            <option value="">اختر المستودع...</option>
            {warehouses.map(w => (
              <option key={w.id} value={w.id}>{w.name} {w.project_id ? `(${w.projects?.name})` : '(رئيسي)'}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">إلى مستودع (الوجهة)</label>
          <select required value={toWh} onChange={e => setToWh(e.target.value)} className="w-full p-2 rounded border bg-background">
            <option value="">اختر المستودع...</option>
            {warehouses.map(w => (
              <option key={w.id} value={w.id}>{w.name} {w.project_id ? `(${w.projects?.name})` : '(رئيسي)'}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">الصنف</label>
        <select required value={itemId} onChange={e => setItemId(e.target.value)} disabled={!fromWh} className="w-full p-2 rounded border bg-background disabled:opacity-50">
          <option value="">اختر الصنف المتوفر...</option>
          {itemGroups.map(group => (
            <optgroup key={group.label} label={group.label}>
              {group.items.map(s => (
                <option key={s.item_id} value={s.item_id}>
                  {s.item_code ? `${s.item_code} - ` : ''}{s.item_name} (المتاح: {s.qty_on_hand} {s.item_unit})
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">الكمية المحولة</label>
          <input required type="number" step="0.0001" min="0.0001" max={maxQty} value={qty} onChange={e => setQty(e.target.value)} className="w-full p-2 rounded border bg-background" placeholder="0.00" />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">ملاحظات التحويل</label>
          <input value={notes} onChange={e => setNotes(e.target.value)} className="w-full p-2 rounded border bg-background" placeholder="سبب التحويل..." />
        </div>
      </div>

      <div className="flex justify-end border-t pt-4">
        <Button type="submit" disabled={loading || !fromWh || !toWh || !itemId || !qty}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
          تنفيذ التحويل
        </Button>
      </div>
    </form>
  );
}
