'use client';

import { useState, useTransition } from 'react';
import { formatMoney } from '@/lib/money';
import {
  saveFinancialBalance,
  saveVendorPriorClaim,
  deleteVendorPriorClaim,
  saveOpeningStockEntry,
  deleteOpeningStockEntry,
} from './opening-balance-actions';
import { Trash2, Pencil, ChevronDown, ChevronUp, PackageOpen, Building2, Scale } from 'lucide-react';

// ─────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────
interface Vendor { id: string; name: string; }
interface Warehouse { id: string; name: string; project_id: string | null; }
interface InventoryItem { id: string; name: string; unit: string; code: string | null; }
interface VendorPriorClaim {
  id: string;
  vendor_id: string;
  vendor_name?: string;
  cutoff_date: string;
  prior_certified_amount: number;
  prior_paid_amount: number;
  prior_retention_held: number;
  notes?: string | null;
}
interface OpeningStockEntry {
  id: string;
  warehouse_id: string;
  warehouse_name?: string;
  item_id: string;
  item_name?: string;
  item_unit?: string;
  qty: number;
  unit_price: number;
  cutoff_date: string;
}
interface FinancialBalance {
  cutoff_date: string;
  prior_expenses: number;
  prior_owner_income: number;
  notes: string | null;
}

interface OpeningBalanceFormProps {
  projectId: string;
  cutoffDate: string;                           // initial / inherited date
  financialBalance: FinancialBalance | null;
  vendorPriorClaims: VendorPriorClaim[];
  openingStockEntries: OpeningStockEntry[];
  vendors: Vendor[];
  warehouses: Warehouse[];
  inventoryItems: InventoryItem[];
}

// ─────────────────────────────────────────────────
// Collapsible Section Shell
// ─────────────────────────────────────────────────
function Section({ title, icon, children, defaultOpen = true }: {
  title: string; icon: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-3 px-5 py-4 font-semibold text-left hover:bg-muted/30 transition-colors"
      >
        <span className="text-primary">{icon}</span>
        <span className="flex-1">{title}</span>
        {open ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
      </button>
      {open && <div className="px-5 pb-5 pt-2">{children}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────
// Financial Balance Section
// ─────────────────────────────────────────────────
function FinancialSection({ projectId, balance }: { projectId: string; balance: FinancialBalance | null }) {
  const [pending, startTransition] = useTransition();
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(''); setSuccess(false);
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await saveFinancialBalance(fd);
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
      } catch (err: any) { setError(err.message); }
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <input type="hidden" name="project_id" value={projectId} />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1.5">تاريخ بداية التتبع (التاريخ المرجعي) *</label>
          <input
            type="date" name="cutoff_date" required
            defaultValue={balance?.cutoff_date || new Date().toISOString().split('T')[0]}
            className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:ring-2 focus:ring-primary focus:outline-none"
          />
          <p className="text-xs text-muted-foreground mt-1">التاريخ الذي بدأ فيه التتبع في النظام</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium mb-1.5">مصروفات سابقة (قبل التتبع)</label>
          <div className="relative">
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">ر.س</span>
            <input
              type="number" name="prior_expenses" min="0" step="0.01"
              defaultValue={balance?.prior_expenses || 0}
              className="w-full border rounded-lg pl-3 pr-10 py-2 text-sm bg-background focus:ring-2 focus:ring-primary focus:outline-none text-left"
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">إجمالي التكاليف قبل بدء التتبع (لا تشمل المخزون)</p>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">إيرادات سابقة من المالك</label>
          <div className="relative">
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">ر.س</span>
            <input
              type="number" name="prior_owner_income" min="0" step="0.01"
              defaultValue={balance?.prior_owner_income || 0}
              className="w-full border rounded-lg pl-3 pr-10 py-2 text-sm bg-background focus:ring-2 focus:ring-primary focus:outline-none text-left"
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1">إجمالي المستخلصات + الدفعات المقدمة من المالك</p>
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1.5">ملاحظات</label>
        <textarea name="notes" rows={2} defaultValue={balance?.notes || ''}
          className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:ring-2 focus:ring-primary focus:outline-none resize-none"
        />
      </div>

      {error && <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{error}</p>}
      {success && <p className="text-sm text-green-600 bg-green-50 px-3 py-2 rounded-lg">✓ تم الحفظ بنجاح</p>}

      <button type="submit" disabled={pending}
        className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-5 py-2.5 rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
      >
        {pending ? '...' : '💾 حفظ الأرصدة المالية'}
      </button>
    </form>
  );
}

// ─────────────────────────────────────────────────
// Vendor Prior Claims Section
// ─────────────────────────────────────────────────
function VendorClaimsSection({
  projectId, cutoffDate, existingClaims, vendors
}: {
  projectId: string; cutoffDate: string; existingClaims: VendorPriorClaim[]; vendors: Vendor[]
}) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<VendorPriorClaim | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');

  const usedVendorIds = existingClaims.map(c => c.vendor_id);
  const availableVendors = vendors.filter(v => !usedVendorIds.includes(v.id) || editing?.vendor_id === v.id);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await saveVendorPriorClaim(fd);
        setShowForm(false);
        setEditing(null);
      } catch (err: any) { setError(err.message); }
    });
  }

  async function handleDelete(id: string) {
    if (!confirm('حذف السجل السابق لهذا المقاول؟')) return;
    startTransition(async () => {
      try { await deleteVendorPriorClaim(id, projectId); }
      catch (err: any) { setError(err.message); }
    });
  }

  const outstanding = (c: VendorPriorClaim) =>
    c.prior_certified_amount - c.prior_paid_amount - c.prior_retention_held;

  const showingForm = showForm || !!editing;

  return (
    <div className="space-y-4">
      {existingClaims.length > 0 && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm text-right">
            <thead className="bg-muted/40">
              <tr>
                <th className="p-3 font-medium">المقاول</th>
                <th className="p-3 font-medium">المستخلص السابق</th>
                <th className="p-3 font-medium">المدفوع</th>
                <th className="p-3 font-medium">المحتجز</th>
                <th className="p-3 font-medium text-amber-600">المتبقي</th>
                <th className="p-3 w-20"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {existingClaims.map(c => (
                <tr key={c.id} className="hover:bg-muted/20">
                  <td className="p-3 font-medium">{c.vendor_name || c.vendor_id}</td>
                  <td className="p-3">{formatMoney(c.prior_certified_amount)}</td>
                  <td className="p-3 text-green-600">{formatMoney(c.prior_paid_amount)}</td>
                  <td className="p-3 text-amber-600">{formatMoney(c.prior_retention_held)}</td>
                  <td className="p-3 font-semibold text-amber-700">{formatMoney(outstanding(c))}</td>
                  <td className="p-3">
                    <div className="flex gap-1">
                      <button onClick={() => { setEditing(c); setShowForm(false); }}
                        className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDelete(c.id)} disabled={pending}
                        className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!showingForm && availableVendors.length > 0 && (
        <button type="button" onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 border rounded-lg px-4 py-2 text-sm font-medium hover:bg-muted/40 transition-colors">
          + إضافة سجل مقاول
        </button>
      )}

      {showingForm && (
        <form onSubmit={handleSubmit} className="border rounded-xl p-4 bg-muted/20 space-y-4">
          <h4 className="font-semibold text-sm">
            {editing ? `تعديل: ${editing.vendor_name}` : 'إضافة سجل مقاول سابق'}
          </h4>
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="vendor_id" value={editing?.vendor_id || ''} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {!editing && (
              <div>
                <label className="block text-sm font-medium mb-1">المقاول *</label>
                <select name="vendor_id" required
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:ring-2 focus:ring-primary focus:outline-none">
                  <option value="">-- اختر مقاولاً --</option>
                  {availableVendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium mb-1">تاريخ التقطيع *</label>
              <input type="date" name="cutoff_date" required
                defaultValue={editing?.cutoff_date || cutoffDate}
                className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:ring-2 focus:ring-primary focus:outline-none" />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {[
              { name: 'prior_certified_amount', label: 'إجمالي الأعمال المستخلصة (ر.س)', val: editing?.prior_certified_amount },
              { name: 'prior_paid_amount', label: 'المدفوع منها (ر.س)', val: editing?.prior_paid_amount },
              { name: 'prior_retention_held', label: 'المحتجز (ر.س)', val: editing?.prior_retention_held },
            ].map(f => (
              <div key={f.name}>
                <label className="block text-sm font-medium mb-1">{f.label}</label>
                <input type="number" name={f.name} min="0" step="0.01" required
                  defaultValue={f.val ?? 0}
                  className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:ring-2 focus:ring-primary focus:outline-none text-left" />
              </div>
            ))}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">ملاحظات</label>
            <input type="text" name="notes" defaultValue={editing?.notes as string || ''}
              className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:ring-2 focus:ring-primary focus:outline-none" />
          </div>

          {error && <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{error}</p>}

          <div className="flex gap-2">
            <button type="submit" disabled={pending}
              className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {pending ? '...' : 'حفظ'}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setEditing(null); setError(''); }}
              className="border px-4 py-2 rounded-lg text-sm hover:bg-muted/40 transition-colors">
              إلغاء
            </button>
          </div>
        </form>
      )}

      {existingClaims.length === 0 && !showingForm && (
        <p className="text-sm text-muted-foreground text-center py-4">
          لا يوجد سجلات سابقة للمقاولين. اضغط &ldquo;إضافة&rdquo; لإدخال الأعمال السابقة.
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────
// Opening Inventory Section
// ─────────────────────────────────────────────────
function InventorySection({
  projectId, cutoffDate, existingEntries, warehouses, inventoryItems
}: {
  projectId: string; cutoffDate: string;
  existingEntries: OpeningStockEntry[];
  warehouses: Warehouse[]; inventoryItems: InventoryItem[];
}) {
  const [showForm, setShowForm] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');

  const totalValue = existingEntries.reduce((s, e) => s + e.qty * e.unit_price, 0);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      try {
        await saveOpeningStockEntry(fd);
        setShowForm(false);
        (e.target as HTMLFormElement).reset();
      } catch (err: any) { setError(err.message); }
    });
  }

  async function handleDelete(entryId: string) {
    if (!confirm('حذف هذا الصنف من مخزون الافتتاح؟')) return;
    startTransition(async () => {
      try { await deleteOpeningStockEntry(entryId, projectId); }
      catch (err: any) { setError(err.message); }
    });
  }

  const projectWarehouses = warehouses.filter(w => w.project_id === projectId || w.project_id === null);

  return (
    <div className="space-y-4">
      {existingEntries.length > 0 && (
        <>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm text-right">
              <thead className="bg-muted/40">
                <tr>
                  <th className="p-3 font-medium">المستودع</th>
                  <th className="p-3 font-medium">الصنف</th>
                  <th className="p-3 font-medium">الكمية</th>
                  <th className="p-3 font-medium">سعر الوحدة</th>
                  <th className="p-3 font-medium text-primary">القيمة</th>
                  <th className="p-3 w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {existingEntries.map(e => (
                  <tr key={e.id} className="hover:bg-muted/20">
                    <td className="p-3 text-muted-foreground">{e.warehouse_name || e.warehouse_id}</td>
                    <td className="p-3 font-medium">{e.item_name || e.item_id} <span className="text-xs text-muted-foreground">({e.item_unit})</span></td>
                    <td className="p-3">{e.qty}</td>
                    <td className="p-3">{formatMoney(e.unit_price)}</td>
                    <td className="p-3 font-semibold text-primary">{formatMoney(e.qty * e.unit_price)}</td>
                    <td className="p-3">
                      <button onClick={() => handleDelete(e.id)} disabled={pending}
                        className="p-1.5 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted/20 border-t">
                <tr>
                  <td colSpan={4} className="p-3 text-sm font-semibold text-left">إجمالي قيمة المخزون الافتتاحي:</td>
                  <td className="p-3 font-bold text-primary text-base">{formatMoney(totalValue)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {!showForm && (
        <button type="button" onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 border rounded-lg px-4 py-2 text-sm font-medium hover:bg-muted/40 transition-colors">
          + إضافة صنف
        </button>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="border rounded-xl p-4 bg-muted/20 space-y-4">
          <h4 className="font-semibold text-sm">إضافة صنف إلى مخزون الافتتاح</h4>
          <input type="hidden" name="project_id" value={projectId} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium mb-1">المستودع *</label>
              <select name="warehouse_id" required
                className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:ring-2 focus:ring-primary focus:outline-none">
                <option value="">-- اختر مستودعاً --</option>
                {projectWarehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">الصنف *</label>
              <select name="item_id" required
                className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:ring-2 focus:ring-primary focus:outline-none">
                <option value="">-- اختر صنفاً --</option>
                {inventoryItems.map(i => (
                  <option key={i.id} value={i.id}>{i.name} {i.code ? `(${i.code})` : ''} — {i.unit}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">الكمية *</label>
              <input type="number" name="qty" min="0.001" step="0.001" required
                className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:ring-2 focus:ring-primary focus:outline-none text-left" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">سعر الوحدة (ر.س) *</label>
              <input type="number" name="unit_price" min="0" step="0.01" required
                className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:ring-2 focus:ring-primary focus:outline-none text-left" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">تاريخ التقطيع *</label>
              <input type="date" name="cutoff_date" required defaultValue={cutoffDate}
                className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:ring-2 focus:ring-primary focus:outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">ملاحظات</label>
              <input type="text" name="notes"
                className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:ring-2 focus:ring-primary focus:outline-none" />
            </div>
          </div>

          {error && <p className="text-sm text-destructive bg-destructive/10 px-3 py-2 rounded-lg">{error}</p>}

          <div className="flex gap-2">
            <button type="submit" disabled={pending}
              className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors">
              {pending ? '...' : 'إضافة الصنف'}
            </button>
            <button type="button" onClick={() => { setShowForm(false); setError(''); }}
              className="border px-4 py-2 rounded-lg text-sm hover:bg-muted/40 transition-colors">
              إلغاء
            </button>
          </div>
        </form>
      )}

      {existingEntries.length === 0 && !showForm && (
        <p className="text-sm text-muted-foreground text-center py-4">
          لا يوجد مخزون افتتاحي مسجل. اضغط &ldquo;إضافة صنف&rdquo; لتسجيل المواد الموجودة.
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────
// Root Export
// ─────────────────────────────────────────────────
export function OpeningBalanceForm({
  projectId,
  cutoffDate,
  financialBalance,
  vendorPriorClaims,
  openingStockEntries,
  vendors,
  warehouses,
  inventoryItems,
}: OpeningBalanceFormProps) {
  return (
    <div className="space-y-4">
      {/* Status Banner */}
      {financialBalance && (
        <div className="flex items-center gap-3 bg-primary/5 border border-primary/20 rounded-xl px-4 py-3">
          <Scale className="w-5 h-5 text-primary flex-shrink-0" />
          <div className="text-sm">
            <span className="font-semibold text-primary">الرصيد الافتتاحي محدد</span>
            <span className="text-muted-foreground mr-2">
              — تاريخ التقطيع: {financialBalance.cutoff_date}
            </span>
          </div>
        </div>
      )}

      <Section title="الأرصدة المالية السابقة" icon={<Building2 className="w-5 h-5" />}>
        <FinancialSection projectId={projectId} balance={financialBalance} />
      </Section>

      <Section title="الأعمال السابقة للمقاولين (مستخلص رقم 0)" icon={<Scale className="w-5 h-5" />} defaultOpen={true}>
        <VendorClaimsSection
          projectId={projectId}
          cutoffDate={cutoffDate}
          existingClaims={vendorPriorClaims}
          vendors={vendors}
        />
      </Section>

      <Section title="المخزون الافتتاحي" icon={<PackageOpen className="w-5 h-5" />} defaultOpen={true}>
        <InventorySection
          projectId={projectId}
          cutoffDate={cutoffDate}
          existingEntries={openingStockEntries}
          warehouses={warehouses}
          inventoryItems={inventoryItems}
        />
      </Section>
    </div>
  );
}
