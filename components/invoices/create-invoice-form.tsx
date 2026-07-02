'use client';

import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { createInvoice } from '@/lib/actions/invoices';
import { saveVendor } from '@/lib/actions/vendors';
import { Plus, Trash2, X } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import { QuickAddItemModal } from './quick-add-item-modal';
import { SearchableItemSelect } from './searchable-item-select';

interface InventoryItem { id: string; name: string; unit: string; code?: string | null; }

export function CreateInvoiceForm({
  vendors,
  projects,
  warehouses,
  inventoryItems: initialItems,
}: {
  vendors: any[];
  projects: any[];
  warehouses: any[];
  inventoryItems: InventoryItem[];
}) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const [taxEnabled, setTaxEnabled]     = useState(false);
  const [taxRate, setTaxRate]           = useState(0.14);
  const [discountRate, setDiscountRate] = useState(0);

  const [lineItems, setLineItems] = useState([
    { id: crypto.randomUUID(), description: '', qty: 1, unit_price: 0, warehouse_id: '', item_id: '' },
  ]);
  const [files, setFiles] = useState<File[]>([]);

  // ► Inventory items held in state so newly created items appear instantly
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>(initialItems);

  const [selectedVendorNav, setSelectedVendorNav] = useState('');
  const [isAddingVendor, setIsAddingVendor] = useState(false);
  const [vendorPending, startVendorTransition] = useTransition();
  const [vendorError, setVendorError] = useState('');
  const [allowAllProjects, setAllowAllProjects] = useState(false);
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);

  async function handleAddVendor(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setVendorError('');
    const fd = new FormData(e.currentTarget);
    
    // Invoices are exclusively for vendors
    fd.set('kind', 'vendor');

    startVendorTransition(async () => {
      try {
        fd.set('all_projects', allowAllProjects.toString());
        const res = await saveVendor(fd, selectedProjects);
        if (res?.error) throw new Error(res.error);
        
        if (res?.vendorId) {
          setSelectedVendorNav(res.vendorId);
        }
        
        setIsAddingVendor(false);
        router.refresh();
      } catch (err: any) {
        setVendorError(err.message);
      }
    });
  }

  const subtotal      = lineItems.reduce((sum, item) => sum + item.qty * item.unit_price, 0);
  const discountAmount = subtotal * discountRate;
  const taxAmount     = taxEnabled ? (subtotal - discountAmount) * taxRate : 0;
  const total         = subtotal - discountAmount + taxAmount;

  async function handleSubmit(formData: FormData) {
    try {
      setLoading(true);
      const supabase = createClient();
      const attachmentUrls: string[] = [];

      for (const file of files) {
        const ext      = file.name.split('.').pop();
        const fileName = `${Math.random().toString(36).substring(2)}_${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from('attachments').upload(fileName, file);
        if (uploadError) throw uploadError;
        attachmentUrls.push(fileName);
      }

      formData.append('tax_enabled',    taxEnabled.toString());
      formData.append('tax_rate',       taxRate.toString());
      formData.append('discount_rate',  discountRate.toString());

      const result = await createInvoice(formData, lineItems, attachmentUrls);
      if (result?.error) { alert(result.error); return; }
      router.push('/invoices');
    } catch (e: any) {
      alert(e.message || 'حدث خطأ');
    } finally {
      setLoading(false);
    }
  }

  const updateItem = (id: string, field: string, value: any) =>
    setLineItems(lineItems.map(item => (item.id === id ? { ...item, [field]: value } : item)));

  const removeItem = (id: string) => setLineItems(lineItems.filter(item => item.id !== id));

  const addLine = () =>
    setLineItems([...lineItems, { id: crypto.randomUUID(), description: '', qty: 1, unit_price: 0, warehouse_id: '', item_id: '' }]);

  /** Called by QuickAddItemModal after a successful creation */
  function handleItemCreated(lineId: string, newItem: InventoryItem) {
    // Append to the shared catalogue
    setInventoryItems(prev => [...prev, newItem]);
    // Auto-select for this specific line
    updateItem(lineId, 'item_id', newItem.id);
  }

  return (
    <>
    <form action={handleSubmit} className="space-y-6 bg-card p-6 rounded-lg border shadow-sm">
      {/* ── Header fields ─────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1">المورد (توريدات)</label>
          <div className="flex gap-2 items-center">
            <select 
              required 
              name="vendor_id" 
              value={selectedVendorNav}
              onChange={(e) => setSelectedVendorNav(e.target.value)}
              className="flex-1 p-2 rounded border bg-background"
            >
              <option value="">اختر المورد...</option>
              {vendors.map(v => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
            <button 
              type="button" 
              onClick={() => setIsAddingVendor(true)}
              title="إضافة مورد جديد"
              className="flex-shrink-0 h-[38px] w-[38px] flex items-center justify-center bg-muted border rounded-lg hover:bg-primary hover:text-primary-foreground hover:border-primary transition-colors text-lg font-bold"
            >
              +
            </button>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">المشروع</label>
          <select required name="project_id" className="w-full p-2 rounded border bg-background">
            <option value="">اختر المشروع...</option>
            {(() => {
              // Build a parent→children map for depth-first tree walk
              const childrenOf = new Map<string | null, any[]>();
              for (const p of projects) {
                const key = p.parent_id ?? null;
                if (!childrenOf.has(key)) childrenOf.set(key, []);
                childrenOf.get(key)!.push(p);
              }
              const result: React.ReactElement[] = [];
              function walk(parentId: string | null, depth: number) {
                const children = childrenOf.get(parentId) || [];
                for (const p of children) {
                  const indent = '  '.repeat(depth);
                  const arrow  = depth > 0 ? '↳ ' : '';
                  const label  =
                    p.node_type === 'main_company' ? 'الشركة الرئيسية' :
                    p.node_type === 'branch'        ? 'فرع' :
                    p.node_type === 'phase'         ? 'مرحلة' : 'مشروع';
                  result.push(
                    <option key={p.id} value={p.id}>
                      {indent}{arrow}{p.name} ({label})
                    </option>
                  );
                  walk(p.id, depth + 1);
                }
              }
              walk(null, 0);
              return result;
            })()}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">تاريخ الفاتورة</label>
          <input
            required
            type="date"
            name="invoice_date"
            defaultValue={new Date().toISOString().split('T')[0]}
            className="w-full p-2 rounded border bg-background"
          />
        </div>
      </div>

      {/* ── Line items ────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex justify-between items-center border-b pb-2">
          <h3 className="font-bold">البنود</h3>
          <Button type="button" size="sm" variant="outline" onClick={addLine}>
            <Plus className="w-4 h-4 mr-2" /> إضافة بند
          </Button>
        </div>

        {lineItems.map((item, _index) => (
          <div key={item.id} className="border p-4 rounded-lg bg-muted/10 space-y-3">
            {/* Description / qty / price / total / delete */}
            <div className="flex gap-3 items-start">
              <div className="flex-1">
                <input
                  required
                  placeholder="وصف البند"
                  value={item.description}
                  onChange={e => updateItem(item.id, 'description', e.target.value)}
                  className="w-full p-2 rounded border bg-background text-sm"
                />
              </div>
              <div className="w-24">
                <input
                  required
                  type="number"
                  step="0.0001"
                  placeholder="الكمية"
                  value={item.qty}
                  onChange={e => updateItem(item.id, 'qty', parseFloat(e.target.value) || 0)}
                  className="w-full p-2 rounded border bg-background text-sm"
                />
              </div>
              <div className="w-32">
                <input
                  required
                  type="number"
                  step="0.01"
                  placeholder="سعر الوحدة"
                  value={item.unit_price}
                  onChange={e => updateItem(item.id, 'unit_price', parseFloat(e.target.value) || 0)}
                  className="w-full p-2 rounded border bg-background text-sm"
                />
              </div>
              <div className="w-28 pt-2 text-left font-medium text-sm text-muted-foreground">
                {formatMoney(item.qty * item.unit_price)}
              </div>
              <div className="pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeItem(item.id)}
                  disabled={lineItems.length === 1}
                >
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            </div>

            {/* Warehouse + Inventory item selector */}
            <div className="flex gap-3 items-center">
              <div className="w-1/2">
                <select
                  value={item.warehouse_id}
                  onChange={e => updateItem(item.id, 'warehouse_id', e.target.value)}
                  className="w-full p-2 rounded border bg-background text-sm text-muted-foreground"
                >
                  <option value="">لا يوجد توريد مخزني (بند خدمة)</option>
                  {warehouses.map(w => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>

              {item.warehouse_id && (
                <div className="w-1/2 flex gap-2 items-center">
                  <div className="flex-1">
                    <SearchableItemSelect
                      items={inventoryItems}
                      value={item.item_id}
                      onChange={(id) => updateItem(item.id, 'item_id', id)}
                      required
                    />
                  </div>

                  {/* ► Quick-add button: opens the popup to create a new item */}
                  <QuickAddItemModal
                    onItemCreated={(newItem) => handleItemCreated(item.id, newItem)}
                  />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* ── Totals + attachments ──────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 border-t pt-4">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">الخصم (%)</label>
            <input
              type="number" step="0.01" min="0" max="100"
              value={discountRate * 100}
              onChange={e => setDiscountRate((parseFloat(e.target.value) || 0) / 100)}
              className="w-32 p-2 rounded border bg-background"
            />
          </div>

          <div>
            <div className="flex items-center gap-2 mb-2">
              <input type="checkbox" id="tax_enabled" checked={taxEnabled} onChange={e => setTaxEnabled(e.target.checked)} className="w-4 h-4" />
              <label htmlFor="tax_enabled" className="text-sm font-medium">إضافة ضريبة</label>
            </div>
            {taxEnabled && (
              <input
                type="number" step="0.01" min="0" max="100"
                value={taxRate * 100}
                onChange={e => setTaxRate((parseFloat(e.target.value) || 0) / 100)}
                className="w-32 p-2 rounded border bg-background"
              />
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">المرفقات</label>
            <input
              type="file" multiple accept="image/*,.pdf"
              onChange={e => setFiles(Array.from(e.target.files || []))}
              className="w-full p-2 rounded border bg-background text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">ملاحظات</label>
            <textarea name="notes" className="w-full p-2 rounded border bg-background" rows={2} />
          </div>
        </div>

        <div className="bg-muted/30 p-4 rounded-lg space-y-3 self-start">
          <div className="flex justify-between text-sm">
            <span>الإجمالي الفرعي:</span>
            <span>{formatMoney(subtotal)}</span>
          </div>
          {discountRate > 0 && (
            <div className="flex justify-between text-sm text-destructive">
              <span>الخصم ({(discountRate * 100).toFixed(1)}%):</span>
              <span>- {formatMoney(discountAmount)}</span>
            </div>
          )}
          {taxEnabled && (
            <div className="flex justify-between text-sm">
              <span>الضريبة ({(taxRate * 100).toFixed(1)}%):</span>
              <span>{formatMoney(taxAmount)}</span>
            </div>
          )}
          <div className="border-t pt-3 flex justify-between font-bold text-lg">
            <span>الإجمالي النهائي:</span>
            <span>{formatMoney(total)}</span>
          </div>
        </div>
      </div>

      <div className="flex justify-end border-t pt-6">
        <Button type="submit" disabled={loading} className="w-full md:w-auto">
          {loading ? 'جاري الحفظ...' : 'حفظ الفاتورة'}
        </Button>
      </div>
    </form>

      {/* Add New Vendor Popup */}
      {isAddingVendor && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setIsAddingVendor(false)} />
          <div className="relative z-10 w-full max-w-sm bg-card border rounded-xl shadow-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">إضافة مورد جديد</h3>
              <button type="button" onClick={() => setIsAddingVendor(false)} className="text-muted-foreground hover:text-foreground">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddVendor} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">الاسم <span className="text-destructive">*</span></label>
                <input name="name" required placeholder="اسم الجهة" className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:ring-2 focus:ring-primary focus:outline-none" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">رقم الهاتف</label>
                <input name="phone" placeholder="05XXXXXXXX" dir="ltr" className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:ring-2 focus:ring-primary focus:outline-none text-right" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">ملاحظات</label>
                <input name="notes" placeholder="معلومات إضافية..." className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:ring-2 focus:ring-primary focus:outline-none" />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">صلاحية المشاريع</label>
                <div className="flex items-center gap-2 mb-2 mt-2">
                  <input 
                    type="checkbox" 
                    id="all_projects" 
                    checked={allowAllProjects} 
                    onChange={(e) => setAllowAllProjects(e.target.checked)} 
                    className="w-4 h-4" 
                  />
                  <label htmlFor="all_projects" className="text-sm">السماح بكل المشاريع (الحالية والمستقبلية)</label>
                </div>
                
                {!allowAllProjects && (
                  <div className="mt-2 border rounded-lg p-3 bg-muted/20 max-h-40 overflow-y-auto space-y-2">
                    <p className="text-xs text-muted-foreground mb-2">اختر المشاريع المسموح له العمل بها:</p>
                    {projects.map(p => (
                      <div key={p.id} className="flex items-center gap-2">
                        <input 
                          type="checkbox" 
                          id={`proj_${p.id}`}
                          checked={selectedProjects.includes(p.id)}
                          onChange={() => {
                            if (selectedProjects.includes(p.id)) {
                              setSelectedProjects(selectedProjects.filter(id => id !== p.id));
                            } else {
                              setSelectedProjects([...selectedProjects, p.id]);
                            }
                          }}
                          className="w-4 h-4"
                        />
                        <label htmlFor={`proj_${p.id}`} className="text-sm">{p.name}</label>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {vendorError && <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{vendorError}</p>}

              <div className="pt-2 flex justify-end gap-2">
                <button type="button" onClick={() => setIsAddingVendor(false)} className="border px-4 py-2 rounded-lg text-sm hover:bg-muted/40 transition-colors">
                  إلغاء
                </button>
                <button type="submit" disabled={vendorPending} className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors">
                  {vendorPending ? "جاري الحفظ..." : "إضافة"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
