'use client';
import React from 'react';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { createClaim } from '@/lib/actions/claims';
import { Plus, Trash2, Loader2 } from 'lucide-react';
import { formatMoney } from '@/lib/money';
import { SearchableSelect } from '@/components/ui/searchable-select';

export function CreateClaimForm({
  vendors,
  projects,
  claimType = 'vendor',
  fixedProjectId,
  fixedPartyId,
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
  fixedPartyId?: string;
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
  const [taxRate, setTaxRate] = useState(0.14);
  const [items, setItems] = useState<any[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [priorCumulativePayable, setPriorCumulativePayable] = useState(0);
  // Check for existing pending claim (client-side early warning)
  useEffect(() => {
    async function checkPending() {
      if (!partyId || !projectId) { setPendingWarning(null); return; }
      const supabase = createClient();
      const { data } = await supabase
        .from('claims').select('claim_number')
        .eq('party_id', partyId).eq('project_id', projectId)
        .eq('claim_type', claimType).eq('status', 'pending')
        .limit(1).maybeSingle();
      setPendingWarning(data
        ? `⚠️ يوجد مستخلص رقم ${data.claim_number} قيد المراجعة لهذا المقاول والمشروع — لا يمكن إنشاء مستخلص جديد حتى يُعتمد أو يُرفض.`
        : null);
    }
    checkPending();
  }, [partyId, projectId]);

  useEffect(() => {
    async function fetchPreviousClaim() {
      if (!partyId || !projectId) {
        setItems([]);
        setPriorCumulativePayable(0);
        return;
      }
      setFetchingPrevious(true);
      const supabase = createClient();

      const [allClaimsResult, lastClaimResult, priorClaimResult] = await Promise.all([
        supabase.from('claims').select('id')
          .eq('party_id', partyId).eq('project_id', projectId)
          .eq('claim_type', claimType).eq('status', 'approved'),
        supabase.from('claims').select('id, claim_number')
          .eq('party_id', partyId).eq('project_id', projectId)
          .eq('claim_type', claimType).eq('status', 'approved')
          .order('claim_number', { ascending: false }).limit(1).single(),
        // Claim #0 offset: certified amount recorded before the system
        claimType === 'vendor'
          ? supabase.from('vendor_prior_claims')
              .select('prior_certified_amount')
              .eq('vendor_id', partyId)
              .eq('project_id', projectId)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      const allClaimIds = (allClaimsResult.data ?? []).map((c: any) => c.id);
      let totalActuallyPaid = 0;
      if (allClaimIds.length > 0) {
        const { data: paidRows } = await supabase
          .from('v_claim_paid').select('paid_amount').in('claim_id', allClaimIds);
        totalActuallyPaid = (paidRows ?? []).reduce((s: number, r: any) => s + Number(r.paid_amount), 0);
      }

      // Add Claim #0 prior_certified_amount as an additional base offset
      const priorCertifiedAmount = Number((priorClaimResult as any).data?.prior_certified_amount || 0);
      setPriorCumulativePayable(totalActuallyPaid + priorCertifiedAmount);

      const lastClaim = lastClaimResult.data;
      if (lastClaim) {
        const { data: prevItems } = await supabase.from('claim_items').select('*').eq('claim_id', lastClaim.id);
        if (prevItems && prevItems.length > 0) {
          setItems(prevItems.map(pi => ({
            id: crypto.randomUUID(),
            item_ref: pi.item_ref,
            description: pi.description,
            previous_qty: Number(pi.previous_qty) + Number(pi.current_qty),
            current_qty: 0,
            unit_price: Number(pi.unit_price),
            disbursement_pct: Number(pi.disbursement_pct),
            is_stock_issue: pi.is_stock_issue || false,
            warehouse_id: pi.warehouse_id || '',
            item_id: pi.item_id || '',
          })));
        } else {
          setItems([]);
        }
      } else {
        setItems([{ id: crypto.randomUUID(), item_ref: '', description: '', previous_qty: 0, current_qty: 0, unit_price: 0, disbursement_pct: 1.0, is_stock_issue: false, warehouse_id: '', item_id: '' }]);
      }
      setFetchingPrevious(false);
    }
    fetchPreviousClaim();
  }, [partyId, projectId]);


  // ── Totals ──────────────────────────────────────────────────
  const currentCumulativePayable = items.reduce((sum, item) => {
    const cumQty = (item.previous_qty || 0) + (item.current_qty || 0);
    return sum + cumQty * (item.unit_price || 0) * (item.disbursement_pct || 1.0);
  }, 0);

  const currentCumulativeRetained = items.reduce((sum, item) => {
    const cumQty = (item.previous_qty || 0) + (item.current_qty || 0);
    return sum + cumQty * (item.unit_price || 0) * (1 - (item.disbursement_pct || 1.0));
  }, 0);

  const netPayableBeforeTax = currentCumulativePayable - priorCumulativePayable;
  const taxAmount = taxEnabled ? netPayableBeforeTax * taxRate : 0;
  const totalDueThisClaim = netPayableBeforeTax + taxAmount;

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
      const result = await createClaim(formData, items, attachmentUrls);
      if (result?.error) { alert(result.error); return; }
      router.push('/claims');
    } catch (e: any) {
      alert(e.message || 'حدث خطأ');
    } finally {
      setLoading(false);
    }
  }

  const updateItem = (id: string, field: string, value: any) =>
    setItems(items.map(item => item.id === id ? { ...item, [field]: value } : item));

  const addItem = () => {
    const lastPct = items.length > 0 ? items[items.length - 1].disbursement_pct : 1.0;
    setItems([...items, { id: crypto.randomUUID(), item_ref: '', description: '', previous_qty: 0, current_qty: 0, unit_price: 0, disbursement_pct: lastPct, is_stock_issue: false, warehouse_id: '', item_id: '' }]);
  };

  // ── Render ───────────────────────────────────────────────────
  return (
    <form action={handleSubmit} className="space-y-6 bg-card p-6 rounded-lg border shadow-sm">

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
        {fixedPartyId && <input type="hidden" name="party_id" value={fixedPartyId} />}

        {!fixedProjectId && (
          <div>
            <label className="block text-sm font-medium mb-1">المشروع</label>
            <select required name="project_id" value={projectId} onChange={e => setProjectId(e.target.value)} className="w-full p-2 rounded border bg-background">
              <option value="">اختر المشروع...</option>
              {projects.filter(p => p.node_type === 'project').map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}
        {fixedProjectId && <input type="hidden" name="project_id" value={fixedProjectId} />}

        <div>
          <label className="block text-sm font-medium mb-1">تاريخ المستخلص</label>
          <input required type="date" name="claim_date" defaultValue={new Date().toISOString().split('T')[0]} className="w-full p-2 rounded border bg-background" />
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
                <th className="pb-2 px-2 font-medium text-right w-28">نسبة الصرف</th>
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
                    {/* Main data row — each td aligns with its th */}
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
                        <input required type="number" step="any" value={item.current_qty}
                          onChange={e => updateItem(item.id, 'current_qty', parseFloat(e.target.value) || 0)}
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

                    {/* Warehouse sub-row — sibling tr, not nested */}
                    {warehouses.length > 0 && (
                      <tr key={`${item.id}-wh`} className="border-b border-muted/20 bg-muted/5">
                        <td colSpan={8} className="px-2 py-1.5">
                          <div className="flex flex-wrap gap-3 items-center">
                            <div className="flex items-center gap-2">
                              <input type="checkbox" id={`stock_${item.id}`}
                                checked={item.is_stock_issue}
                                onChange={e => updateItem(item.id, 'is_stock_issue', e.target.checked)}
                                disabled={isReadOnlyItem} className="w-4 h-4" />
                              <label htmlFor={`stock_${item.id}`} className="text-xs font-medium text-muted-foreground">
                                خصم كمية البند من مستودع
                              </label>
                            </div>
                            {item.is_stock_issue && (
                              <>
                                <SearchableSelect options={warehouseOptions} value={item.warehouse_id}
                                  onChange={v => updateItem(item.id, 'warehouse_id', v)}
                                  placeholder="اختر المستودع..." required disabled={isReadOnlyItem} className="w-44" />
                                <SearchableSelect options={itemOptions} value={item.item_id}
                                  onChange={v => updateItem(item.id, 'item_id', v)}
                                  placeholder="اختر الصنف..." required disabled={isReadOnlyItem} className="w-52" />
                              </>
                            )}
                          </div>
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
                <input type="number" step="0.01" min="0" max="100" value={taxRate * 100}
                  onChange={e => setTaxRate((parseFloat(e.target.value) || 0) / 100)}
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

          <div className="border-t border-muted-foreground/20 my-2"></div>

          <div className="flex justify-between text-sm text-muted-foreground">
            <span>يُخصم: المدفوع فعلياً (من السجل المالي):</span>
            <span>- {formatMoney(priorCumulativePayable)}</span>
          </div>
          <div className="flex justify-between text-sm font-bold text-primary">
            <span>الصافي الحالي:</span>
            <span>{formatMoney(netPayableBeforeTax)}</span>
          </div>

          {taxEnabled && (
            <div className="flex justify-between text-sm">
              <span>الضريبة ({(taxRate * 100).toFixed(1)}%):</span>
              <span>+ {formatMoney(taxAmount)}</span>
            </div>
          )}

          <div className="border-t border-primary/20 pt-3 flex justify-between font-bold text-xl">
            <span>إجمالي المستحق (شهادة الدفع):</span>
            <span>{formatMoney(totalDueThisClaim)}</span>
          </div>

          <div className="border-t border-muted-foreground/20 my-2"></div>

          <div className="flex justify-between text-sm text-green-600 font-medium">
            <span>المدفوع فعلياً (من السجل المالي):</span>
            <span>{formatMoney(priorCumulativePayable)}</span>
          </div>
          <div className="flex justify-between text-sm text-destructive font-bold">
            <span>المتبقي بعد الدفعات:</span>
            <span>{formatMoney(totalDueThisClaim)}</span>
          </div>
        </div>
      </div>

      <div className="flex justify-end border-t pt-6">
        <Button type="submit" disabled={loading || items.length === 0 || !!pendingWarning} className="w-full md:w-auto">
          {loading ? 'جاري الحفظ...' : 'حفظ المستخلص'}
        </Button>
      </div>
    </form>
  );
}
