'use client';
import React from 'react';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { createZeroClaim } from '@/lib/actions/claims';
import { Plus, Trash2, Loader2, Package, X } from 'lucide-react';
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
  warehouse_id: string;        // one warehouse for the whole bundle
  stock_bundle: BundleLine[];  // list of inventory items + qty-per-unit
}

function emptyItem(lastPct = 1.0): ClaimItem {
  return {
    id: crypto.randomUUID(),
    item_ref: '',
    description: '',
    previous_qty: 0,
    current_qty: 0,
    unit_price: 0,
    disbursement_pct: lastPct,
    is_stock_issue: false,
    warehouse_id: '',
    stock_bundle: [],
  };
}

function emptyBundleLine(): BundleLine {
  return { id: crypto.randomUUID(), item_id: '', qty_per_unit: 0 };
}

export function CreateZeroClaimForm({
  vendors,
  projects,
  claimType = 'vendor',
  fixedProjectId,
  fixedProjectName: _fixedProjectName,
  fixedPartyId,
  fixedPartyName,
  defaultPartyId,
  defaultProjectId,
  warehouses = [],
  inventoryItems = [],
  stockLevels = [],
}: {
  vendors: any[];
  projects: any[];
  claimType?: 'vendor' | 'owner';
  fixedProjectId?: string;
  fixedProjectName?: string;
  fixedPartyId?: string;
  fixedPartyName?: string;
  defaultPartyId?: string;
  defaultProjectId?: string;
  warehouses?: any[];
  inventoryItems?: any[];
  stockLevels?: { warehouse_id: string; item_id: string; qty_on_hand: number; item_unit?: string }[];
}) {
  const [loading, setLoading] = useState(false);
  const [fetchingPrevious, setFetchingPrevious] = useState(false);
  const [pendingWarning, setPendingWarning] = useState<string | null>(null);
  const router = useRouter();

  const [partyId, setPartyId] = useState(fixedPartyId || defaultPartyId || '');
  const [projectId, setProjectId] = useState(fixedProjectId || defaultProjectId || '');
  const [taxEnabled, setTaxEnabled] = useState(false);
  const [taxRateStr, setTaxRateStr] = useState("14");
  const taxRate = (parseFloat(taxRateStr) || 0) / 100;
  const [items, setItems] = useState<ClaimItem[]>([]);
  const [files, setFiles] = useState<File[]>([]);

  const [openingPaidAmount, setOpeningPaidAmount] = useState(0);

  // ── Pending-claim warning ────────────────────────────────────
  useEffect(() => {
    if (!partyId || !projectId) { setPendingWarning(null); return; }
    const supabase = createClient();
    supabase
      .from('claims').select('claim_number')
      .eq('party_id', partyId).eq('project_id', projectId)
      .eq('claim_type', claimType).eq('status', 'pending')
      .limit(1).maybeSingle()
      .then(({ data }) => {
        setPendingWarning(data
          ? `⚠️ يوجد مستخلص رقم ${data.claim_number} قيد المراجعة لهذا المقاول والمشروع — لا يمكن إنشاء مستخلص جديد حتى يُعتمد أو يُرفض.`
          : null);
      });
  }, [partyId, projectId, claimType]);

  // ── Initialize Empty Item ────────────────────────────────────
  useEffect(() => {
    setItems([emptyItem()]);
  }, [partyId, projectId, claimType]);

  // ── Totals ──────────────────────────────────────────────────
  const grossTotal = items.reduce((sum, item) => {
    const cumQty = Number(item.current_qty || 0); // previous is always 0
    return sum + cumQty * Number(item.unit_price || 0);
  }, 0);

  const retained = items.reduce((sum, item) => {
    const cumQty = Number(item.current_qty || 0);
    return sum + cumQty * Number(item.unit_price || 0) * (1 - Number(item.disbursement_pct || 1.0));
  }, 0);

  const netCumulative = items.reduce((sum, item) => {
    const cumQty = Number(item.current_qty || 0);
    return sum + cumQty * Number(item.unit_price || 0) * Number(item.disbursement_pct || 1.0);
  }, 0);

  const taxAmount = taxEnabled ? netCumulative * taxRate : 0;
  const totalDue  = netCumulative + taxAmount;
  const remaining = Math.max(0, totalDue - openingPaidAmount);

  // ── Submit ───────────────────────────────────────────────────
  async function handleSubmit(formData: FormData) {
    try {
      setLoading(true);
      const supabase = createClient();
      const attachmentUrls: string[] = [];
      for (const file of files) {
        const ext = file.name.split('.').pop();
        const fileName = `${Math.random().toString(36).substring(2)}_${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from('attachments').upload(fileName, file);
        if (uploadError) throw uploadError;
        attachmentUrls.push(fileName);
      }
      formData.append('claim_type', claimType);
      formData.append('tax_enabled', taxEnabled.toString());
      formData.append('tax_rate', taxRate.toString());
      formData.append('opening_paid_amount', openingPaidAmount.toString());
      const result = await createZeroClaim(formData, items, attachmentUrls);
      if (result?.error) { alert(result.error); return; }
      router.push(`/projects/${projectId}?tab=opening-balance`);
    } catch (e: any) {
      alert(e.message || 'حدث خطأ');
    } finally {
      setLoading(false);
    }
  }

  // ── Item helpers ─────────────────────────────────────────────
  const updateItem = (id: string, field: string, value: any) =>
    setItems(items.map(item => item.id === id ? { ...item, [field]: value } : item));

  const addItem = () => {
    const lastPct = items.length > 0 ? items[items.length - 1].disbursement_pct : 1.0;
    setItems([...items, emptyItem(lastPct)]);
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

  // ── Render ───────────────────────────────────────────────────
  return (
    <form action={handleSubmit} className="space-y-6 bg-card p-6 rounded-lg border shadow-sm">
      <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-400 p-4 rounded-lg flex items-start gap-3">
        <div className="mt-0.5">⚠️</div>
        <div className="text-sm font-medium leading-relaxed">
          هذا المستخلص يمثل الأعمال المنجزة قبل بدء التتبع في النظام. سيتم اعتماده تلقائياً ولن يتم سحب كمياته من المستودع أو خصم مدفوعاته من حساب البنك.
        </div>
      </div>

      {/* ── Header fields ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {!fixedPartyId && (
          <div>
            <label className="block text-sm font-medium mb-1">{claimType === 'owner' ? 'المالك' : 'المقاول'}</label>
            <select required name="party_id" value={partyId} onChange={e => setPartyId(e.target.value)} className="w-full p-2 rounded border bg-background">
              <option value="">{claimType === 'owner' ? 'اختر المالك...' : 'اختر المقاول...'}</option>
              {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </div>
        )}
        {fixedPartyId && (
          <div>
            <label className="block text-sm font-medium mb-1">
              {claimType === 'owner' ? 'المالك' : 'المقاول'}
            </label>
            <div className="w-full p-2 rounded border bg-muted/40 text-sm font-semibold text-foreground flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-primary inline-block" />
              {fixedPartyName || fixedPartyId}
            </div>
            <input type="hidden" name="party_id" value={fixedPartyId} />
          </div>
        )}

        {!fixedProjectId && (
          <div>
            <label className="block text-sm font-medium mb-1">المشروع</label>
            <select required name="project_id" value={projectId} onChange={e => setProjectId(e.target.value)} className="w-full p-2 rounded border bg-background">
              <option value="">اختر المشروع...</option>
              {(() => {
                // Build a hierarchical ordered list: parent → children → grandchildren
                function flattenTree(
                  nodes: any[],
                  parentId: string | null,
                  depth: number
                ): { project: any; depth: number }[] {
                  return nodes
                    .filter(p => (p.parent_id ?? null) === parentId && p.node_type !== 'main_company')
                    .flatMap(p => [
                      { project: p, depth },
                      ...flattenTree(nodes, p.id, depth + 1),
                    ]);
                }
                // Root of the visible tree = projects whose parent is main_company or null
                const rootParentId = projects.find(p => p.node_type === 'main_company')?.id ?? null;
                const ordered = flattenTree(projects, rootParentId, 0);

                return ordered.map(({ project: p, depth }) => {
                  const indent = depth === 0 ? '' : '\u00a0'.repeat(depth * 3) + '↳ ';
                  return (
                    <option key={p.id} value={p.id}>
                      {indent}{p.name}
                    </option>
                  );
                });
              })()}
            </select>
          </div>
        )}
        {fixedProjectId && <input type="hidden" name="project_id" value={fixedProjectId} />}

        <div>
          <label className="block text-sm font-medium mb-1">تاريخ المستخلص</label>
          <input required type="date" name="claim_date" defaultValue={new Date().toISOString().split('T')[0]} className="w-full p-2 rounded border bg-background" />
        </div>

        <div>
          <label className="block text-sm font-medium mb-1">المدفوع للمقاول قبل النظام (إن وجد)</label>
          <input 
            type="number" 
            step="0.01" 
            value={openingPaidAmount} 
            onChange={e => setOpeningPaidAmount(parseFloat(e.target.value) || 0)} 
            className="w-full p-2 rounded border bg-background text-amber-600 font-semibold focus:border-amber-500 focus:ring-amber-500" 
          />
        </div>
      </div>

      {/* ── Pending claim warning ── */}
      {pendingWarning && (
        <div className="flex items-start gap-3 bg-destructive/10 border border-destructive/30 text-destructive rounded-lg px-4 py-3 text-sm font-medium">
          <span className="text-lg leading-none mt-0.5">🚫</span>
          <span>{pendingWarning}</span>
        </div>
      )}

      {/* ── Items table ── */}
      <div className="space-y-4">
        <div className="flex justify-between items-center border-b pb-2">
          <h3 className="font-bold">بنود الأعمال</h3>
          {fetchingPrevious && (
            <span className="text-sm text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> جاري جلب المستخلص السابق...
            </span>
          )}
          <Button type="button" size="sm" variant="outline" onClick={addItem} disabled={fetchingPrevious || !partyId || !projectId}>
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
                <th className="w-8"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const cumQty = (item.previous_qty || 0) + (item.current_qty || 0);
                const lineTotal = cumQty * (item.unit_price || 0);
                const isReadOnlyItem = !!item.item_ref;

                const warehouseOptions = warehouses.map((w: any) => ({ value: w.id, label: w.name }));

                const itemOptions = inventoryItems.map((i: any) => {
                  const stock = item.warehouse_id
                    ? stockLevels.find((s: any) => s.warehouse_id === item.warehouse_id && s.item_id === i.id)
                    : null;
                  const qty = stock ? Number(stock.qty_on_hand) : null;
                  return {
                    value: i.id,
                    label: i.name,
                    sub: i.code ?? undefined,
                    badge: qty !== null ? `${qty.toLocaleString('en')} ${i.unit}` : undefined,
                    badgeColor: qty !== null
                      ? qty > 0 ? 'bg-green-50 text-green-700 border-green-300' : 'bg-red-50 text-red-700 border-red-300'
                      : undefined,
                  };
                });

                return (
                  <React.Fragment key={item.id}>
                    {/* Main data row */}
                    <tr key={`${item.id}-main`} className="border-b border-muted/40 align-middle">
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
                      <td className="py-2 px-1 w-8">
                        {!isReadOnlyItem && (
                          <Button type="button" variant="ghost" size="icon"
                            onClick={() => setItems(items.filter(i => i.id !== item.id))}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        )}
                      </td>
                    </tr>

                    {/* ── Stock-issue sub-row ── */}
                    {true && (
                      <tr key={`${item.id}-wh`} className="border-b border-muted/20 bg-muted/5">
                        <td colSpan={8} className="px-3 py-2">
                          {/* Toggle */}
                          <div className="flex items-center gap-2 mb-2">
                            <input type="checkbox" id={`stock_${item.id}`}
                              checked={item.is_stock_issue}
                              onChange={e => toggleStockIssue(item.id, e.target.checked)}
                              disabled={isReadOnlyItem}
                              className="w-4 h-4 accent-primary" />
                            <label htmlFor={`stock_${item.id}`} className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                              <Package className="w-3.5 h-3.5" />
                              خصم كمية البند من مستودع
                            </label>
                          </div>

                          {/* Bundle panel */}
                          {item.is_stock_issue && (
                            <div className="border border-dashed border-primary/30 rounded-lg p-3 bg-primary/5 space-y-3">

                              {/* Warehouse picker — one for the whole bundle */}
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-muted-foreground whitespace-nowrap">المستودع:</span>
                                <SearchableSelect
                                  options={warehouseOptions}
                                  value={item.warehouse_id}
                                  onChange={v => updateItem(item.id, 'warehouse_id', v)}
                                  placeholder="اختر المستودع..."
                                  required
                                  disabled={isReadOnlyItem}
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
                                      <th className="pb-1 px-1 text-center font-medium text-muted-foreground w-36">
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
                                      const insufficient = onHand !== null && willDeduct > 0 && willDeduct > onHand;

                                      return (
                                        <tr key={bl.id} className="border-b border-primary/10">
                                          <td className="py-1 px-1">
                                            <SearchableSelect
                                              options={itemOptions}
                                              value={bl.item_id}
                                              onChange={v => updateBundleLine(item.id, bl.id, 'item_id', v)}
                                              placeholder="اختر الصنف..."
                                              required
                                              disabled={isReadOnlyItem}
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
                                              disabled={isReadOnlyItem}
                                              className="w-full p-1 rounded border bg-background text-center"
                                            />
                                          </td>
                                          <td className={`py-1 px-1 w-36 text-center font-medium ${
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
                                            {!isReadOnlyItem && (
                                              <button
                                                type="button"
                                                onClick={() => removeBundleLine(item.id, bl.id)}
                                                className="text-muted-foreground hover:text-destructive transition-colors"
                                              >
                                                <X className="w-3.5 h-3.5" />
                                              </button>
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              )}

                              {/* Add bundle line button */}
                              {!isReadOnlyItem && (
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
                              )}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
              {items.length === 0 && !fetchingPrevious && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-muted-foreground">
                    يرجى اختيار المقاول والمشروع لبدء المستخلص
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Summary + options ── */}
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
                <input type="number" step="0.01" min="0" max="100" value={taxRateStr}
                  onChange={e => setTaxRateStr(e.target.value)}
                  className="w-32 p-2 rounded border bg-background" />
                <span className="text-sm text-muted-foreground">%</span>
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">المرفقات</label>
            <input type="file" multiple accept="image/*,.pdf"
              onChange={e => setFiles(Array.from(e.target.files || []))}
              className="w-full p-2 rounded border bg-background text-sm" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">ملاحظات</label>
            <textarea name="notes" className="w-full p-2 rounded border bg-background" rows={2} />
          </div>
        </div>

        <div className="bg-muted/30 p-4 rounded-lg space-y-2.5">
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>إجمالي الأعمال التراكمي (مستخلص #0):</span>
            <span className="font-medium">{formatMoney(grossTotal)}</span>
          </div>

          {retained > 0 && (
            <div className="flex justify-between text-sm text-amber-600">
              <span>المحتجز التراكمي (تأمين):</span>
              <span className="font-medium">- {formatMoney(retained)}</span>
            </div>
          )}

          <div className="flex justify-between text-sm text-muted-foreground border-t border-muted/30 pt-1">
            <span>الصافي التراكمي:</span>
            <span className="font-medium">{formatMoney(netCumulative)}</span>
          </div>

          {taxEnabled && (
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>الضريبة ({(taxRate * 100).toFixed(1)}%):</span>
              <span>+ {formatMoney(taxAmount)}</span>
            </div>
          )}

          {openingPaidAmount > 0 && (
            <div className="flex justify-between text-sm text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 px-2 py-1.5 rounded mt-2">
              <span>المدفوع قبل النظام (لن يُخصم من البنك):</span>
              <span className="font-medium">- {formatMoney(openingPaidAmount)}</span>
            </div>
          )}

          <div className="border-t border-primary/20 pt-3 flex justify-between items-center font-bold text-xl">
            <span className="text-sm font-semibold">
              المتبقي المستحق:
            </span>
            <span className={remaining <= 0 ? 'text-green-600' : 'text-primary'}>
              {formatMoney(remaining)}
            </span>
          </div>
        </div>
      </div>

      <div className="flex justify-end border-t pt-6">
        <Button type="submit" disabled={loading || items.length === 0 || !!pendingWarning} className="w-full md:w-auto bg-amber-600 hover:bg-amber-700 text-white">
          {loading ? 'جاري الحفظ...' : 'حفظ المستخلص كرصيد افتتاحي (معتمد)'}
        </Button>
      </div>
    </form>
  );
}
