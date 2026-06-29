'use client';
import React from 'react';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import { createClaim } from '@/lib/actions/claims';
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

export function CreateClaimForm({
  vendors,
  projects,
  claimType = 'vendor',
  fixedProjectId,
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
  const [taxRate, setTaxRate] = useState(0.14);
  const [items, setItems] = useState<ClaimItem[]>([]);
  const [files, setFiles] = useState<File[]>([]);

  // Prior amount split state (vendor claims: claim #0)
  const [priorCertifiedAmount, setPriorCertifiedAmount]     = useState(0);
  const [priorPaidAmount, setPriorPaidAmount]               = useState(0);
  const [priorRetentionHeld, setPriorRetentionHeld]         = useState(0);
  const [inSystemPriorCertified, setInSystemPriorCertified] = useState(0);

  // Owner Claim #0 state (project_opening_balances)
  const [ownerPriorDues, setOwnerPriorDues]   = useState(0); // total certified before system
  const [ownerPriorIncome, setOwnerPriorIncome] = useState(0); // already collected before system

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

  // ── Fetch previous claim ─────────────────────────────────────
  useEffect(() => {
    const controller = new AbortController();

    async function fetchPreviousClaim() {
      if (!partyId || !projectId) {
        setItems([emptyItem()]);
        setPriorCertifiedAmount(0);
        setPriorPaidAmount(0);
        setPriorRetentionHeld(0);
        setInSystemPriorCertified(0);
        return;
      }
      setFetchingPrevious(true);
      const supabase = createClient();

      const [lastClaimResult, priorClaimResult, allApprovedResult, ownerObResult] = await Promise.all([
        supabase.from('claims').select('id, claim_number')
          .eq('party_id', partyId).eq('project_id', projectId)
          .eq('claim_type', claimType).eq('status', 'approved')
          .order('claim_number', { ascending: false }).limit(1)
          .maybeSingle(),
        claimType === 'vendor'
          ? supabase.from('vendor_prior_claims')
              .select('prior_certified_amount, prior_paid_amount, prior_retention_held')
              .eq('vendor_id', partyId)
              .eq('project_id', projectId)
              .maybeSingle()
          : Promise.resolve({ data: null }),
        supabase.from('claims').select('id')
          .eq('party_id', partyId).eq('project_id', projectId)
          .eq('claim_type', claimType).eq('status', 'approved')
          .then(r => r),
        // For owner claims: fetch project_opening_balances to get Claim #0 data
        claimType === 'owner'
          ? supabase.from('project_opening_balances')
              .select('prior_owner_dues, prior_owner_income')
              .eq('project_id', projectId)
              .maybeSingle()
          : Promise.resolve({ data: null }),
      ]);

      if (controller.signal.aborted) return;

      // ── Owner Claim #0 (project_opening_balances) ──────────────────────────
      if (claimType === 'owner') {
        const ob = (ownerObResult as any).data;
        setOwnerPriorDues(Number(ob?.prior_owner_dues || 0));
        setOwnerPriorIncome(Number(ob?.prior_owner_income || 0));
      } else {
        setOwnerPriorDues(0);
        setOwnerPriorIncome(0);
      }

      // ── Vendor Claim #0 offset (vendor_prior_claims) ───────────────────────
      const vpc     = Number((priorClaimResult as any).data?.prior_certified_amount || 0);
      let vpcPaid = Number((priorClaimResult as any).data?.prior_paid_amount      || 0);
      const vpcRet  = Number((priorClaimResult as any).data?.prior_retention_held   || 0);

      // In-system paid amounts for all approved claims
      if (allApprovedResult.data && allApprovedResult.data.length > 0) {
        const claimIds = allApprovedResult.data.map((c: any) => c.id);
        const { data: paidData } = await supabase
          .from('v_claim_paid')
          .select('paid_amount')
          .in('claim_id', claimIds);
        const inSystemPaid = (paidData || []).reduce((sum: number, row: any) => sum + Number(row.paid_amount), 0);
        vpcPaid += inSystemPaid;
      }

      setPriorCertifiedAmount(vpc);
      setPriorPaidAmount(vpcPaid);
      setPriorRetentionHeld(vpcRet);

      const lastClaim = lastClaimResult.data;
      if (lastClaim) {
        // Use v_claim_totals for exact prior base
        const { data: lastTotals } = await supabase
          .from('v_claim_totals')
          .select('prior_cumulative_payable, claim_cumulative_payable')
          .eq('claim_id', lastClaim.id)
          .maybeSingle();
        const priorOfLast = Number(lastTotals?.prior_cumulative_payable || 0);
        const cumOfLast   = Number(lastTotals?.claim_cumulative_payable  || 0);
        setInSystemPriorCertified(Math.max(0, priorOfLast + cumOfLast - vpc));

        const { data: prevItems } = await supabase
          .from('claim_items').select('*').eq('claim_id', lastClaim.id);

        if (controller.signal.aborted) return;

        // Load bundle rows for stock items
        let bundleMap = new Map<string, any[]>();
        if (prevItems && prevItems.length > 0) {
          try {
            const { data: bundles } = await supabase
              .from('claim_item_stock_bundles').select('*')
              .in('claim_item_id', prevItems.map((p: any) => p.id));
            (bundles || []).forEach((b: any) => {
              if (!bundleMap.has(b.claim_item_id)) bundleMap.set(b.claim_item_id, []);
              bundleMap.get(b.claim_item_id)!.push(b);
            });
          } catch (_) { /* bundle table may not exist in older DB */ }
        }

        if (controller.signal.aborted) return;

        if (prevItems && prevItems.length > 0) {
          setItems(prevItems.map((pi: any) => {
            const bundles = bundleMap.get(pi.id) || [];
            return {
              id: crypto.randomUUID(),
              item_ref: pi.item_ref,
              description: pi.description,
              previous_qty: Number(pi.previous_qty) + Number(pi.current_qty),
              current_qty: 0,
              unit_price: Number(pi.unit_price),
              disbursement_pct: Number(pi.disbursement_pct),
              is_stock_issue: pi.is_stock_issue || false,
              warehouse_id: bundles[0]?.warehouse_id || pi.warehouse_id || '',
              stock_bundle: bundles.length > 0
                ? bundles.map((b: any) => ({ id: crypto.randomUUID(), item_id: b.item_id, qty_per_unit: Number(b.qty_per_unit) }))
                : (pi.item_id ? [{ id: crypto.randomUUID(), item_id: pi.item_id, qty_per_unit: Number(pi.current_qty) }] : []),
            };
          }));
        } else {
          setItems([emptyItem()]);
          setInSystemPriorCertified(0);
        }
      } else {
        setItems([emptyItem()]);
        setInSystemPriorCertified(0);
      }
      setFetchingPrevious(false);
    }

    fetchPreviousClaim();
    return () => controller.abort();
  }, [partyId, projectId, claimType]);

  // ── Totals ──────────────────────────────────────────────────
  const inSystemPayable = items.reduce((sum, item) => {
    const cumQty = (item.previous_qty || 0) + (item.current_qty || 0);
    return sum + cumQty * (item.unit_price || 0) * (item.disbursement_pct || 1.0);
  }, 0);

  const inSystemRetained = items.reduce((sum, item) => {
    const cumQty = (item.previous_qty || 0) + (item.current_qty || 0);
    return sum + cumQty * (item.unit_price || 0) * (1 - (item.disbursement_pct || 1.0));
  }, 0);

  const priorOutstanding = Math.max(0, priorCertifiedAmount - priorPaidAmount - priorRetentionHeld);

  // ── Owner Claim #0 derived values ─────────────────────────────
  // ownerPriorDues  = total certified by owner before system (Claim #0 gross)
  // ownerPriorIncome = already collected before system (offsets the Claim #0)
  // outstanding from Claim #0 = dues - income (collected via treasury receive)
  const ownerPriorOutstanding = Math.max(0, ownerPriorDues - ownerPriorIncome);

  // ── Merged totals (in-system + claim #0) ─────────────────────
  // For vendor claims: grossTotal includes vendor_prior_claims as claim #0
  // For owner  claims: grossTotal includes project_opening_balances.prior_owner_dues as claim #0
  const claim0Amount = claimType === 'owner' ? ownerPriorDues : priorCertifiedAmount;
  const claim0Paid   = claimType === 'owner' ? ownerPriorIncome : priorPaidAmount;
  const claim0Ret    = claimType === 'owner' ? 0 : priorRetentionHeld;

  const grossTotal    = (inSystemPayable + inSystemRetained) + claim0Amount;
  const retained      = inSystemRetained + claim0Ret;
  const netCumulative = grossTotal - retained;

  const taxAmount = taxEnabled ? netCumulative * taxRate : 0;
  const totalDue  = netCumulative + taxAmount;
  // remaining = total - what was already collected (prior paid + in-system paid via treasury)
  const alreadyPaid = claimType === 'owner' ? claim0Paid : priorPaidAmount;
  const remaining   = Math.max(0, totalDue - alreadyPaid);

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
                    {warehouses.length > 0 && (
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
                                              onChange={e => updateBundleLine(item.id, bl.id, 'qty_per_unit', parseFloat(e.target.value) || 0)}
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

        <div className="bg-muted/30 p-4 rounded-lg space-y-2.5">

          {/* ── Claim #0 opener (owner) ── */}
          {claimType === 'owner' && ownerPriorDues > 0 && (
            <>
              <div className="flex justify-between text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded px-2 py-1.5">
                <span>مستخلص #0 — إجمالي مستحقات المالك (قبل النظام):</span>
                <span className="font-semibold">{formatMoney(ownerPriorDues)}</span>
              </div>
              {ownerPriorIncome > 0 && (
                <div className="flex justify-between text-xs text-green-700 dark:text-green-400 px-2">
                  <span>محصّل من مستخلص #0 (قبل النظام):</span>
                  <span className="font-medium">- {formatMoney(ownerPriorIncome)}</span>
                </div>
              )}
              {ownerPriorOutstanding > 0 && (
                <div className="flex justify-between text-xs text-amber-600 px-2 pb-1 border-b border-muted/40">
                  <span>متبقي مستخلص #0 (لم يُحصَّل بعد):</span>
                  <span className="font-medium">{formatMoney(ownerPriorOutstanding)}</span>
                </div>
              )}
              {ownerPriorOutstanding === 0 && ownerPriorIncome > 0 && (
                <div className="flex justify-between text-xs text-green-600 px-2 pb-1 border-b border-muted/40">
                  <span>✓ مستخلص #0 مسدّد بالكامل</span>
                  <span></span>
                </div>
              )}
            </>
          )}

          {/* ── Claim #0 opener (vendor) ── */}
          {claimType === 'vendor' && priorCertifiedAmount > 0 && (
            <div className="flex justify-between text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded px-2 py-1.5">
              <span>مستخلص #0 (قبل النظام):</span>
              <span className="font-semibold">{formatMoney(priorCertifiedAmount)}</span>
            </div>
          )}

          {/* Gross */}
          <div className="flex justify-between text-sm text-muted-foreground">
            <span>إجمالي الأعمال التراكمي:</span>
            <span className="font-medium">{formatMoney(grossTotal)}</span>
          </div>

          {/* Retention */}
          {retained > 0 && (
            <div className="flex justify-between text-sm text-amber-600">
              <span>المحتجز التراكمي (تأمين):</span>
              <span className="font-medium">- {formatMoney(retained)}</span>
            </div>
          )}

          {/* Net cumulative */}
          <div className="flex justify-between text-sm text-muted-foreground border-t border-muted/30 pt-1">
            <span>الصافي التراكمي (قابل للدفع):</span>
            <span className="font-medium">{formatMoney(netCumulative)}</span>
          </div>

          {/* Tax */}
          {taxEnabled && (
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>الضريبة ({(taxRate * 100).toFixed(1)}%):</span>
              <span>+ {formatMoney(taxAmount)}</span>
            </div>
          )}

          {/* Collected (prior paid) */}
          {alreadyPaid > 0 && (
            <div className="flex justify-between text-sm text-green-700 dark:text-green-400 font-medium">
              <span>المحصّل فعلياً (جميع المستخلصات السابقة):</span>
              <span>- {formatMoney(alreadyPaid)}</span>
            </div>
          )}

          {/* Remaining headline */}
          <div className="border-t border-primary/20 pt-3 flex justify-between items-center font-bold text-xl">
            <span className="text-sm font-semibold">
              {remaining <= 0 ? '✓ تم السداد بالكامل' : 'المتبقي المستحق:'}
            </span>
            <span className={remaining <= 0 ? 'text-green-600' : ''}>
              {formatMoney(remaining)}
            </span>
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
