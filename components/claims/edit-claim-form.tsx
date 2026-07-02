'use client';
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { updateClaim } from '@/lib/actions/claims';
import { Plus, Trash2, Package, X } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import { SearchableSelect } from '@/components/ui/searchable-select';

// ── Types ────────────────────────────────────────────────────
interface BundleLine {
  id: string;
  item_id: string;
  qty_per_unit: number;
}

interface ClaimItem {
  id: string;
  item_ref: string;
  description: string;
  previous_qty: number;
  current_qty: number;
  unit_price: number;
  disbursement_pct: number;
  is_stock_issue: boolean;
  warehouse_id: string;
  stock_bundle: BundleLine[];
  notes: string;
}

function emptyBundleLine(): BundleLine {
  return { id: crypto.randomUUID(), item_id: '', qty_per_unit: 0 };
}

interface Props {
  claimId: string;
  claimType: 'vendor' | 'owner';
  partyId: string;
  partyName: string;
  projectId: string;
  projectName: string;
  claimDate: string;
  taxEnabled: boolean;
  taxRate: number;
  notes: string;
  existingItems: any[];
  vendors: any[];
  projects: any[];
  warehouses: any[];
  inventoryItems: any[];
  stockLevels: { warehouse_id: string; item_id: string; qty_on_hand: number; item_unit?: string }[];
}

export function EditClaimForm({
  claimId, claimType, partyId, partyName, projectId, projectName,
  claimDate, taxEnabled: initTaxEnabled, taxRate: initTaxRate, notes: initNotes,
  existingItems, warehouses, inventoryItems, stockLevels,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [taxEnabled, setTaxEnabled] = useState(initTaxEnabled);
  const [taxRate, setTaxRate] = useState(initTaxRate || 0.14);
  const [files, setFiles] = useState<File[]>([]);

  // Pre-populate items from DB — map existing bundles or legacy single-item fields
  const [items, setItems] = useState<ClaimItem[]>(
    existingItems.map(i => ({
      id: crypto.randomUUID(),
      item_ref: i.item_ref || '',
      description: i.description || '',
      previous_qty: Number(i.previous_qty),
      current_qty: Number(i.current_qty),
      unit_price: Number(i.unit_price),
      disbursement_pct: Number(i.disbursement_pct),
      is_stock_issue: i.is_stock_issue || false,
      // If the row came with bundle data attached (fetched via select with bundles), use it;
      // otherwise fall back to legacy warehouse_id / item_id (left as-is per Q2).
      warehouse_id: i.claim_item_stock_bundles?.[0]?.warehouse_id || i.warehouse_id || '',
      stock_bundle: i.claim_item_stock_bundles && i.claim_item_stock_bundles.length > 0
        ? i.claim_item_stock_bundles.map((b: any) => ({
            id: crypto.randomUUID(),
            item_id: b.item_id,
            qty_per_unit: Number(b.qty_per_unit),
          }))
        : (i.item_id
            ? [{ id: crypto.randomUUID(), item_id: i.item_id, qty_per_unit: Number(i.current_qty) }]
            : []),
      notes: i.notes || '',
    }))
  );

  // ── Item helpers ─────────────────────────────────────────────
  const updateItem = (id: string, field: string, value: any) =>
    setItems(items.map(item => item.id === id ? { ...item, [field]: value } : item));

  const addItem = () => {
    const lastPct = items.length > 0 ? items[items.length - 1].disbursement_pct : 1.0;
    setItems([...items, {
      id: crypto.randomUUID(), item_ref: '', description: '',
      previous_qty: 0, current_qty: 0, unit_price: 0,
      disbursement_pct: lastPct, is_stock_issue: false, warehouse_id: '', stock_bundle: [],
      notes: '',
    }]);
  };

  const addBundleLine = (itemId: string) =>
    setItems(items.map(item =>
      item.id === itemId
        ? { ...item, stock_bundle: [...item.stock_bundle, emptyBundleLine()] }
        : item
    ));

  const updateBundleLine = (itemId: string, lineId: string, field: string, value: any) =>
    setItems(items.map(item =>
      item.id === itemId
        ? {
            ...item,
            stock_bundle: item.stock_bundle.map(bl =>
              bl.id === lineId ? { ...bl, [field]: value } : bl
            ),
          }
        : item
    ));

  const removeBundleLine = (itemId: string, lineId: string) =>
    setItems(items.map(item =>
      item.id === itemId
        ? { ...item, stock_bundle: item.stock_bundle.filter(bl => bl.id !== lineId) }
        : item
    ));

  const toggleStockIssue = (itemId: string, checked: boolean) =>
    setItems(items.map(item =>
      item.id === itemId
        ? {
            ...item,
            is_stock_issue: checked,
            warehouse_id: checked ? item.warehouse_id : '',
            stock_bundle: checked ? (item.stock_bundle.length > 0 ? item.stock_bundle : [emptyBundleLine()]) : [],
          }
        : item
    ));

  // ── Totals ───────────────────────────────────────────────────
  const currentCumulativePayable = items.reduce((sum, item) => {
    const cumQty = (item.previous_qty || 0) + (item.current_qty || 0);
    return sum + cumQty * (item.unit_price || 0) * (item.disbursement_pct || 1.0);
  }, 0);
  const currentCumulativeRetained = items.reduce((sum, item) => {
    const cumQty = (item.previous_qty || 0) + (item.current_qty || 0);
    return sum + cumQty * (item.unit_price || 0) * (1 - (item.disbursement_pct || 1.0));
  }, 0);
  const netPayable = currentCumulativePayable;
  const taxAmount = taxEnabled ? netPayable * taxRate : 0;
  const totalDue = netPayable + taxAmount;

  // ── Submit ───────────────────────────────────────────────────
  async function handleSubmit(formData: FormData) {
    try {
      setLoading(true);
      const supabase = createClient();
      const attachmentUrls: string[] = [];
      for (const file of files) {
        const ext = file.name.split('.').pop();
        const fileName = `${Math.random().toString(36).substring(2)}_${Date.now()}.${ext}`;
        const { error } = await supabase.storage.from('attachments').upload(fileName, file);
        if (error) throw error;
        attachmentUrls.push(fileName);
      }
      formData.append('tax_enabled', taxEnabled.toString());
      formData.append('tax_rate', taxRate.toString());
      const result = await updateClaim(claimId, formData, items, attachmentUrls);
      if (result?.error) { alert(result.error); return; }
      router.push('/claims');
    } catch (e: any) {
      alert(e.message || 'حدث خطأ');
    } finally {
      setLoading(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────
  return (
    <form action={handleSubmit} className="space-y-6 bg-card p-6 rounded-lg border shadow-sm">

      {/* Locked party + project */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            {claimType === 'owner' ? 'المالك' : 'المقاول'}
          </label>
          <div className="p-2.5 rounded border bg-muted text-sm font-medium">{partyName}</div>
          <input type="hidden" name="party_id" value={partyId} />
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">المشروع</label>
          <div className="p-2.5 rounded border bg-muted text-sm font-medium">{projectName}</div>
          <input type="hidden" name="project_id" value={projectId} />
        </div>
        <div>
          <label className="block text-sm font-medium mb-1">تاريخ المستخلص</label>
          <input required type="date" name="claim_date" defaultValue={claimDate}
            className="w-full p-2 rounded border bg-background" />
        </div>
      </div>

      {/* Items table */}
      <div className="space-y-4">
        <div className="flex justify-between items-center border-b pb-2">
          <h3 className="font-bold">بنود الأعمال</h3>
          <Button type="button" size="sm" variant="outline" onClick={addItem}>
            <Plus className="w-4 h-4 mr-2" /> إضافة بند جديد
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-right border-collapse">
            <thead>
              <tr className="border-b">
                <th className="pb-2 px-2 font-medium text-right">البند</th>
                <th className="pb-2 px-2 font-medium text-right w-20">السابق</th>
                <th className="pb-2 px-2 font-medium text-right w-24">الحالي</th>
                <th className="pb-2 px-2 font-medium text-right w-16">الإجمالي</th>
                <th className="pb-2 px-2 font-medium text-right w-28">الفئة</th>
                <th className="pb-2 px-2 font-medium text-right w-36">
                  <div className="flex items-center gap-2">
                    <span>نسبة الصرف</span>
                    <button
                      type="button"
                      title="تطبيق نسبة موحدة على جميع البنود"
                      onClick={() => {
                        const res = window.prompt('أدخل النسبة المئوية لتطبيقها على جميع البنود (مثال: 100):', '100');
                        if (res !== null) {
                          const val = parseFloat(res);
                          if (!isNaN(val) && val >= 0) {
                            setItems(prev => prev.map(i => ({ ...i, disbursement_pct: val / 100 })));
                          }
                        }
                      }}
                      className="text-[10px] bg-primary/10 text-primary hover:bg-primary/20 px-1.5 py-0.5 rounded font-normal"
                    >
                      تطبيق للكل
                    </button>
                  </div>
                </th>
                <th className="pb-2 px-2 font-medium text-left w-32">الإجمالي (ج.م)</th>
                <th className="pb-2 px-2 font-medium text-right">ملاحظة البند</th>
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const cumQty = (item.previous_qty || 0) + (item.current_qty || 0);
                const lineTotal = cumQty * (item.unit_price || 0);
                const isReadOnlyItem = !!item.item_ref;

                const warehouseOptions = warehouses.map((w: any) => ({ value: w.id, label: w.name }));
                const itemOptions = inventoryItems.map((i: any) => {
                  const stock = item.warehouse_id
                    ? stockLevels.find(s => s.warehouse_id === item.warehouse_id && s.item_id === i.id)
                    : null;
                  const qty = stock ? Number(stock.qty_on_hand) : null;
                  return {
                    value: i.id, label: i.name, sub: i.code ?? undefined,
                    badge: qty !== null ? `${qty.toLocaleString('en')} ${i.unit}` : undefined,
                    badgeColor: qty !== null
                      ? qty > 0 ? 'bg-green-50 text-green-700 border-green-300' : 'bg-red-50 text-red-700 border-red-300'
                      : undefined,
                  };
                });

                return (
                  <React.Fragment key={item.id}>
                    <tr className="border-b border-muted/40 align-middle">
                      <td className="py-2 px-2">
                        <input required placeholder="وصف البند" value={item.description}
                          onChange={e => updateItem(item.id, 'description', e.target.value)}
                          disabled={isReadOnlyItem}
                          className="w-full min-w-[140px] p-2 rounded border bg-background text-sm" />
                      </td>
                      <td className="py-2 px-2 w-20">
                        <input disabled value={item.previous_qty}
                          className="w-full p-2 rounded border bg-muted text-sm text-center" />
                      </td>
                      <td className="py-2 px-2 w-24">
                        <input
                          key={`qty-${item.id}`}
                          required
                          type="number"
                          step="any"
                          defaultValue={item.current_qty}
                          onChange={e => {
                            const raw = e.target.value;
                            if (raw === '') { updateItem(item.id, 'current_qty', 0); return; }
                            const parsed = parseFloat(raw);
                            if (!isNaN(parsed)) updateItem(item.id, 'current_qty', parsed);
                          }}
                          className="w-full p-2 rounded border bg-background text-sm text-center" />
                      </td>
                      <td className="py-2 px-2 w-16 font-medium text-center">{cumQty}</td>
                      <td className="py-2 px-2 w-28">
                        <input required type="number" step="any" value={item.unit_price}
                          onChange={e => updateItem(item.id, 'unit_price', parseFloat(e.target.value) || 0)}
                          disabled={isReadOnlyItem}
                          className="w-full p-2 rounded border bg-background text-sm" />
                      </td>
                      <td className="py-2 px-2 w-28">
                        <div className="flex items-center gap-1">
                          <input required type="number" step="0.01" min="1" max="100"
                            value={item.disbursement_pct * 100}
                            onChange={e => updateItem(item.id, 'disbursement_pct', (parseFloat(e.target.value) || 0) / 100)}
                            className="w-full p-2 rounded border bg-background text-sm" />
                          <span className="text-xs text-muted-foreground">%</span>
                        </div>
                      </td>
                      <td className="py-2 px-2 w-32 font-bold text-left text-primary whitespace-nowrap">
                        {formatMoney(lineTotal * item.disbursement_pct)}
                      </td>
                      <td className="py-2 px-2">
                        <input
                          type="text"
                          placeholder="ملاحظة (اختياري)"
                          value={item.notes}
                          onChange={e => updateItem(item.id, 'notes', e.target.value)}
                          className="w-full min-w-[140px] p-2 rounded border bg-background text-sm"
                        />
                      </td>
                      <td className="py-2 px-1 w-8">
                        <Button type="button" variant="ghost" size="icon"
                          onClick={() => setItems(items.filter(i => i.id !== item.id))}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </td>
                    </tr>

                    {/* ── Stock-issue sub-row ── */}
                    {warehouses.length > 0 && (
                      <tr className="border-b border-muted/20 bg-muted/5">
                        <td colSpan={9} className="px-3 py-2">
                          {/* Toggle */}
                          <div className="flex items-center gap-2 mb-2">
                            <input type="checkbox" id={`stock_${item.id}`}
                              checked={item.is_stock_issue}
                              onChange={e => toggleStockIssue(item.id, e.target.checked)}
                              className="w-4 h-4 accent-primary" />
                            <label htmlFor={`stock_${item.id}`} className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                              <Package className="w-3.5 h-3.5" />
                              خصم كمية البند من مستودع
                            </label>
                          </div>

                          {/* Bundle panel */}
                          {item.is_stock_issue && (
                            <div className="border border-dashed border-primary/30 rounded-lg p-3 bg-primary/5 space-y-3">

                              {/* Warehouse picker */}
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">المستودع:</span>
                                <SearchableSelect
                                  options={warehouseOptions}
                                  value={item.warehouse_id}
                                  onChange={v => updateItem(item.id, 'warehouse_id', v)}
                                  placeholder="اختر المستودع..."
                                  required
                                  className="w-52"
                                />
                              </div>

                              {/* Bundle lines table */}
                              {item.stock_bundle.length > 0 && (
                                <table className="w-full text-xs border-collapse">
                                  <thead>
                                    <tr className="border-b border-primary/20">
                                      <th className="pb-1 px-1 text-right font-medium text-muted-foreground">الصنف</th>
                                      <th className="pb-1 px-1 text-center font-medium text-muted-foreground w-32">
                                        كمية / وحدة
                                      </th>
                                      <th className="pb-1 px-1 text-center font-medium text-muted-foreground w-32">
                                        {item.current_qty < 0 ? `يُرجع (${item.current_qty} وحدة)` : `يُخصم (${item.current_qty} وحدة)`}
                                      </th>
                                      <th className="w-6"></th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {item.stock_bundle.map((bl) => {
                                      const stock = item.warehouse_id
                                        ? stockLevels.find(s => s.warehouse_id === item.warehouse_id && s.item_id === bl.item_id)
                                        : null;
                                      const onHand = stock ? Number(stock.qty_on_hand) : null;
                                      const willDeduct = bl.qty_per_unit * (item.current_qty || 0);
                                      const insufficient = onHand !== null && willDeduct > onHand;

                                      return (
                                        <tr key={bl.id} className="border-b border-primary/10">
                                          <td className="py-1 px-1">
                                            <SearchableSelect
                                              options={itemOptions}
                                              value={bl.item_id}
                                              onChange={v => updateBundleLine(item.id, bl.id, 'item_id', v)}
                                              placeholder="اختر الصنف..."
                                              required
                                              className="w-full min-w-[160px]"
                                            />
                                          </td>
                                          <td className="py-1 px-1 w-32">
                                            <input
                                              type="number"
                                              step="any"
                                              min="0.0001"
                                              value={bl.qty_per_unit || ''}
                                              onChange={e => updateBundleLine(item.id, bl.id, 'qty_per_unit', e.target.value)}
                                              placeholder="0"
                                              required
                                              className="w-full p-1 rounded border bg-background text-center"
                                            />
                                          </td>
                                          <td className={`py-1 px-1 w-32 text-center font-medium ${
                                            willDeduct === 0 ? 'text-muted-foreground'
                                            : willDeduct < 0 ? 'text-blue-600'
                                            : insufficient ? 'text-destructive'
                                            : 'text-green-700'
                                          }`}>
                                            {willDeduct === 0 ? '—'
                                              : willDeduct < 0
                                                ? <span className="flex flex-col items-center gap-0.5">
                                                    <span>+{Math.abs(willDeduct).toLocaleString('en')}</span>
                                                    <span className="text-[10px] bg-blue-100 text-blue-700 rounded px-1">إرجاع للمستودع</span>
                                                  </span>
                                                : willDeduct.toLocaleString('en')
                                            }
                                            {onHand !== null && (
                                              <span className={`block text-[10px] ${
                                                willDeduct < 0 ? 'text-blue-500'
                                                : insufficient ? 'text-destructive'
                                                : 'text-muted-foreground'
                                              }`}>
                                                متاح: {onHand.toLocaleString('en')}
                                              </span>
                                            )}
                                          </td>
                                          <td className="py-1 px-1 w-6">
                                            <button
                                              type="button"
                                              onClick={() => removeBundleLine(item.id, bl.id)}
                                              className="text-muted-foreground hover:text-destructive transition-colors"
                                            >
                                              <X className="w-3.5 h-3.5" />
                                            </button>
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              )}

                              {/* Add line button */}
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => addBundleLine(item.id)}
                                className="h-7 text-xs border-primary/40 text-primary hover:bg-primary/10"
                              >
                                <Plus className="w-3 h-3 mr-1" />
                                إضافة صنف للحزمة
                              </Button>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {items.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-8 text-center text-muted-foreground">لا توجد بنود</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary + options */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-8 border-t pt-4">
        <div className="space-y-4">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <input type="checkbox" id="tax_enabled" checked={taxEnabled}
                onChange={e => setTaxEnabled(e.target.checked)} className="w-4 h-4" />
              <label htmlFor="tax_enabled" className="text-sm font-medium">إضافة ضريبة</label>
            </div>
            {taxEnabled && (
              <div className="flex items-center gap-2">
                <input type="number" step="0.01" min="0" max="100" value={taxRate * 100}
                  onChange={e => setTaxRate((parseFloat(e.target.value) || 0) / 100)}
                  className="w-32 p-2 rounded border bg-background" />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">مرفقات إضافية</label>
            <input type="file" multiple accept="image/*,.pdf"
              onChange={e => setFiles(Array.from(e.target.files || []))}
              className="w-full p-2 rounded border bg-background text-sm" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">ملاحظات</label>
            <textarea name="notes" defaultValue={initNotes}
              className="w-full p-2 rounded border bg-background" rows={2} />
          </div>
        </div>

        <div className="bg-muted/30 p-4 rounded-lg space-y-3">
          <div className="flex justify-between text-sm">
            <span>إجمالي الأعمال التراكمي:</span>
            <span>{formatMoney(currentCumulativePayable + currentCumulativeRetained)}</span>
          </div>
          <div className="flex justify-between text-sm text-amber-600">
            <span>المحتجز التراكمي (تأمين):</span>
            <span>{formatMoney(currentCumulativeRetained)}</span>
          </div>
          <div className="flex justify-between text-sm font-medium">
            <span>الصافي التراكمي (قابل للدفع):</span>
            <span>{formatMoney(currentCumulativePayable)}</span>
          </div>
          <div className="border-t border-muted-foreground/20 my-2" />
          <div className="flex justify-between text-sm font-bold text-primary">
            <span>الصافي الحالي:</span>
            <span>{formatMoney(netPayable)}</span>
          </div>
          {taxEnabled && (
            <div className="flex justify-between text-sm">
              <span>الضريبة ({(taxRate * 100).toFixed(1)}%):</span>
              <span>+ {formatMoney(taxAmount)}</span>
            </div>
          )}
          <div className="border-t border-primary/20 pt-3 flex justify-between font-bold text-xl">
            <span>إجمالي المستحق:</span>
            <span>{formatMoney(totalDue)}</span>
          </div>
        </div>
      </div>

      <div className="flex justify-end gap-3 border-t pt-6">
        <Button type="button" variant="outline" onClick={() => router.push('/claims')}>
          إلغاء
        </Button>
        <Button type="submit" disabled={loading || items.length === 0}>
          {loading ? 'جاري الحفظ...' : 'حفظ التعديلات'}
        </Button>
      </div>
    </form>
  );
}
