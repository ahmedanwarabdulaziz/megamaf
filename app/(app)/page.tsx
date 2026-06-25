import { createClient } from '@/lib/supabase/server';
import { getProfile } from '@/lib/supabase/get-profile';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { formatMoney } from '@/lib/money';
import Link from 'next/link';
import { Landmark, ArrowRightLeft, Clock, Wallet, AlertCircle } from 'lucide-react';
import { FAB } from '@/components/ui/fab';
import { PWAInstallPrompt } from '@/components/ui/pwa-install-prompt';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'الرئيسية' };


export default async function HomePage() {
  const { profile } = await getProfile();
  const supabase = await createClient();

  // Run all queries in parallel for fast dashboard load
  const [
    { data: banksData },
    { data: mainProjectData },
    { count: pendingExpenses },
    { count: pendingInvoices },
    { count: pendingClaims },
    { data: upcomingDeposits },
    { data: upcomingOwnerSchedules }
  ] = await Promise.all([
    // 1. Total Cash in banks
    supabase.from('v_bank_account_balances').select('current_balance'),
    
    // 2. Main Company net position
    supabase.from('v_project_financial_position')
      .select('*')
      .eq('node_type', 'main_company')
      .single(),

    // 3. Pending Approvals
    supabase.from('expenses').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('invoices').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
    supabase.from('claims').select('*', { count: 'exact', head: true }).eq('status', 'pending'),

    // 4. Upcoming deposit payouts (next 5)
    supabase.from('deposit_payouts')
      .select('*, deposits(name)')
      .eq('is_collected', false)
      .order('due_date', { ascending: true })
      .limit(5),

    // 5. Upcoming owner installments (next 5)
    supabase.from('owner_payment_schedule')
      .select('*, project_owners(name)')
      .neq('status', 'paid')
      .order('due_date', { ascending: true })
      .limit(5)
  ]);

  // Aggregate bank balances
  const totalCash = (banksData ?? []).reduce((s, r) => s + Number(r.current_balance), 0);

  const totalPendingApprovals = (pendingExpenses || 0) + (pendingInvoices || 0) + (pendingClaims || 0);

  return (
    <div className="max-w-6xl mx-auto flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">اللوحة الرئيسية</h1>
        <p className="text-muted-foreground mt-1">
          مرحباً {profile?.full_name}، نظرة عامة على الموقف المالي.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center text-primary">
              <Landmark className="w-4 h-4 ml-2" /> إجمالي النقدية بالبنوك
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold text-primary">{formatMoney(totalCash)}</div>
            <p className="text-xs text-muted-foreground mt-1">مجموع الأرصدة الحالية في جميع الحسابات</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center text-muted-foreground">
              <ArrowRightLeft className="w-4 h-4 ml-2" /> صافي الموقف المالي للشركة
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className={`text-3xl font-bold ${(mainProjectData?.net_position || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatMoney(mainProjectData?.net_position || 0)}
            </div>
            <p className="text-xs text-muted-foreground mt-1">الإيرادات المفوترة ناقص التكاليف المعتمدة</p>
          </CardContent>
        </Card>

        <Card className={totalPendingApprovals > 0 ? "border-amber-200 bg-amber-50 dark:bg-amber-950/20" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center text-muted-foreground">
              <AlertCircle className="w-4 h-4 ml-2" /> الموافقات المعلقة
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{totalPendingApprovals}</div>
            <p className="text-xs text-muted-foreground mt-1">
              مستخلصات ({pendingClaims || 0}) • فواتير ({pendingInvoices || 0}) • مصروفات ({pendingExpenses || 0})
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center">
              <Wallet className="w-5 h-5 ml-2 text-primary" /> استحقاقات الودائع القادمة
            </CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingDeposits && upcomingDeposits.length > 0 ? (
              <div className="space-y-4">
                {upcomingDeposits.map(p => (
                  <div key={p.id} className="flex justify-between items-center border-b pb-2 last:border-0 last:pb-0">
                    <div>
                      <p className="font-semibold text-sm">{p.deposits?.name}</p>
                      <p className="text-xs text-muted-foreground">استحقاق #{p.seq} في {new Date(p.due_date).toLocaleDateString('ar-EG')}</p>
                    </div>
                    <div className="font-bold text-green-600 bg-green-50 dark:bg-green-900/20 px-2 py-1 rounded">
                      {formatMoney(p.expected_amount)}
                    </div>
                  </div>
                ))}
                <Link href="/deposits" className="block text-center text-sm text-primary mt-2">عرض كل الودائع</Link>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">لا توجد استحقاقات قادمة</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center">
              <Clock className="w-5 h-5 ml-2 text-blue-600" /> دفعات الملاك المستحقة
            </CardTitle>
          </CardHeader>
          <CardContent>
            {upcomingOwnerSchedules && upcomingOwnerSchedules.length > 0 ? (
              <div className="space-y-4">
                {upcomingOwnerSchedules.map(s => (
                  <div key={s.id} className="flex justify-between items-center border-b pb-2 last:border-0 last:pb-0">
                    <div>
                      <p className="font-semibold text-sm">{s.project_owners?.name}</p>
                      <p className="text-xs text-muted-foreground">تاريخ الاستحقاق: {new Date(s.due_date).toLocaleDateString('ar-EG')}</p>
                    </div>
                    <div className="font-bold text-blue-600 bg-blue-50 dark:bg-blue-900/20 px-2 py-1 rounded">
                      {formatMoney(s.expected_amount)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">لا توجد دفعات مستحقة</p>
            )}
          </CardContent>
        </Card>
      </div>

      <FAB modalTrigger="profile-modal" />
      <PWAInstallPrompt />
    </div>
  );
}
