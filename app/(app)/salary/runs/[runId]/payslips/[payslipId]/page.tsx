import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { requirePageAccess } from '@/lib/require-page-access';
import { formatMoney } from '@/lib/money';
import { payslipStatusLabel } from '@/lib/salary-financials';
import { PayslipComponentForm } from '@/components/salary/payslip-component-form';
import { PayslipAllocationForm } from '@/components/salary/payslip-allocation-form';
import { getProjects } from '@/lib/queries/projects';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'قسيمة راتب' };

export default async function PayslipDetailPage({ params }: { params: Promise<{ runId: string; payslipId: string }> }) {
  await requirePageAccess('salary');
  const { runId, payslipId } = await params;
  const supabase = await createClient();

  const [{ data: payslip }, { data: components }, { data: allocations }, projects] = await Promise.all([
    supabase.from('payslips').select('*, employees(full_name)').eq('id', payslipId).single(),
    supabase.from('payslip_components').select('*').eq('payslip_id', payslipId).order('created_at'),
    supabase.from('payslip_project_allocations').select('*, projects(name)').eq('payslip_id', payslipId),
    getProjects(),
  ]);

  if (!payslip) notFound();

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <Link href={`/salary/runs/${runId}`} className="text-sm text-muted-foreground hover:underline">← رجوع لدورة الرواتب</Link>
        <h1 className="text-2xl font-bold mt-1">{payslip.employees?.full_name}</h1>
        <p className="text-sm text-muted-foreground">{payslipStatusLabel(payslip.status)}</p>
      </div>

      <div className="bg-card p-4 rounded-lg border shadow-sm space-y-2 text-sm">
        <div className="flex justify-between"><span className="text-muted-foreground">الراتب الأساسي:</span><span className="font-medium">{formatMoney(payslip.base_amount)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">البدلات:</span><span className="font-medium text-green-600">{formatMoney(payslip.allowances_total)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">المكافآت:</span><span className="font-medium text-green-600">{formatMoney(payslip.bonus_total)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">الخصومات:</span><span className="font-medium text-destructive">{formatMoney(payslip.deductions_total)}</span></div>
        <div className="flex justify-between"><span className="text-muted-foreground">خصم السلف:</span><span className="font-medium text-destructive">{formatMoney(payslip.loan_deduction_total)}</span></div>
        <div className="flex justify-between border-t pt-2"><span className="font-bold">الإجمالي:</span><span className="font-bold">{formatMoney(payslip.gross_amount)}</span></div>
        <div className="flex justify-between"><span className="font-bold">الصافي:</span><span className="font-bold text-primary">{formatMoney(payslip.net_amount)}</span></div>
      </div>

      <div className="bg-card p-4 rounded-lg border shadow-sm">
        <h3 className="font-bold mb-3">توزيع المشاريع</h3>
        {payslip.status === 'draft' ? (
          <PayslipAllocationForm
            payslipId={payslip.id}
            baseAmount={Number(payslip.base_amount)}
            projects={(projects || []).map((p: any) => ({ id: p.id, name: p.name }))}
            initialRows={(allocations || []).map((a: any) => ({
              project_id: a.project_id,
              allocation_type: a.allocation_type,
              allocation_value: Number(a.allocation_value),
            }))}
          />
        ) : (
          <div className="space-y-1">
            {(allocations || []).map((a: any) => (
              <div key={a.id} className="flex justify-between bg-muted/40 rounded px-2 py-1 text-sm">
                <span>{a.projects?.name}</span>
                <span className="font-medium">{formatMoney(a.allocated_amount)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {payslip.status === 'draft' ? (
        <div className="bg-card p-4 rounded-lg border shadow-sm">
          <h3 className="font-bold mb-3">البدلات والخصومات</h3>
          <PayslipComponentForm payslipId={payslip.id} components={components || []} />
        </div>
      ) : (
        (components || []).length > 0 && (
          <div className="bg-card p-4 rounded-lg border shadow-sm">
            <h3 className="font-bold mb-3">البدلات والخصومات</h3>
            <div className="divide-y divide-border border rounded-lg">
              {(components || []).map((c: any) => (
                <div key={c.id} className="flex justify-between p-2 text-sm">
                  <span>{c.label}</span>
                  <span className={c.component_type === 'deduction' ? 'text-destructive' : 'text-green-600'}>
                    {c.component_type === 'deduction' ? '-' : '+'}{formatMoney(c.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )
      )}
    </div>
  );
}
