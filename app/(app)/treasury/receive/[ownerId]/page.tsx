import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import { OwnerReceiptCalculator } from './calculator';

export default async function ReceiveOwnerPage({ params }: { params: Promise<{ ownerId: string }> }) {
  const { ownerId } = await params;
  const supabase = await createClient();

  const { data: owner } = await supabase.from('project_owners').select('*').eq('id', ownerId).single();
  if (!owner) notFound();

  const { data: bankAccounts } = await supabase.from('v_bank_account_balances').select('*').order('account_name');

  // ── Fetch approved owner claims directly (avoids v_owner_account dependency) ──
  // Order DESC so that when we dedupe by project, the FIRST one is always the latest.
  const { data: ownerClaims } = await supabase
    .from('claims')
    .select('id, claim_number, claim_date, project_id, projects(name)')
    .eq('party_id', ownerId)
    .eq('claim_type', 'owner')
    .eq('status', 'approved')
    .order('claim_number', { ascending: false }); // latest first

  // ── Cumulative billing: keep ONLY the latest approved claim per project ───
  // Claim #2 cumulative total already INCLUDES Claim #1's work (via previous_qty).
  // Showing both would double-count. Older claims become historical references only.
  const seenProjects = new Set<string>();
  const latestClaims = (ownerClaims || []).filter((claim) => {
    if (seenProjects.has(claim.project_id)) return false;
    seenProjects.add(claim.project_id);
    return true;
  });

  // ── Get full totals from v_claim_totals ─────────────────────────────────
  const claimIds = latestClaims.map((c) => c.id);

  // Fetch opening balances scoped to this owner's projects
  const { data: allOpeningBalances } = await supabase
    .from('project_opening_balances')
    .select('project_id, prior_owner_dues, prior_owner_income, projects!inner(owner_id)')
    .eq('projects.owner_id', ownerId);

  const [claimTotalsResult, claimPaidResult] = await Promise.all([
    claimIds.length > 0
      ? supabase
          .from('v_claim_totals')
          .select('claim_id, claim_cumulative_total, claim_cumulative_payable, claim_cumulative_retained, prior_cumulative_payable, total_due_this_claim')
          .in('claim_id', claimIds)
      : { data: [] as any[] },
    claimIds.length > 0
      ? supabase.from('v_claim_paid').select('claim_id, paid_amount').in('claim_id', claimIds)
      : { data: [] as any[] },
  ]);

  const claimTotals = claimTotalsResult.data || [];
  const claimPaid   = claimPaidResult.data   || [];
  // Build a map projectId → opening balance
  const obByProject = new Map<string, { prior_owner_dues: number; prior_owner_income: number }>();
  for (const ob of (allOpeningBalances || [])) {
    obByProject.set(ob.project_id, ob);
  }

  // ── Build openDocs list: one entry per project (latest claim only) ──────
  const openDocs: any[] = latestClaims
    .map((claim) => {
      const totals  = claimTotals.find((t) => t.claim_id === claim.id);
      const paid    = claimPaid.find((p) => p.claim_id === claim.id);
      const ob      = obByProject.get(claim.project_id);

      // Gross cumulative = in-system gross + Claim #0 prior dues
      const grossInSystem    = Number(totals?.claim_cumulative_total    || 0);
      const retainedInSystem = Number(totals?.claim_cumulative_retained || 0);
      const priorDues        = Number(ob?.prior_owner_dues   || 0);
      const priorIncome      = Number(ob?.prior_owner_income || 0);

      const grossTotal    = grossInSystem + priorDues;
      const retained      = retainedInSystem;
      const netCumulative = grossTotal - retained;

      // Paid = in-system payments + prior income already collected
      const paidInSystem  = Number(paid?.paid_amount || 0);
      const totalPaid     = paidInSystem + priorIncome;
      const remaining     = Math.max(0, netCumulative - totalPaid);

      return {
        document_type:  'claim',
        document_id:    claim.id,
        description:    `مستخلص رقم ${claim.claim_number}`,
        project_id:     claim.project_id,
        project_name:   (claim.projects as any)?.name,
        // Core amount for allocation
        amount_due:     remaining,
        document_date:  claim.claim_date,
        // Extra breakdown fields for display
        gross_total:     grossTotal,
        retained:        retained,
        net_cumulative:  netCumulative,
        total_paid:      totalPaid,
        prior_dues:      priorDues,
        prior_income:    priorIncome,
        claim_number:    claim.claim_number,
      };
    })
    .filter((d) => (d.amount_due ?? 0) > 0);


  // ── Also include owner_payment_schedule rows not yet fully paid ──────────
  const { data: scheduleRows } = await supabase
    .from('owner_payment_schedule')
    .select('*, projects(name)')
    .in('status', ['expected', 'partial'])
    .order('due_date', { ascending: true });

  if (scheduleRows) {
    for (const row of scheduleRows) {
      const { data: paidData } = await supabase
        .from('v_owner_schedule_paid')
        .select('paid_amount')
        .eq('schedule_id', row.id)
        .single();
      const remaining = row.expected_amount - (paidData?.paid_amount || 0);
      if (remaining > 0) {
        openDocs.push({
          document_type: 'owner_schedule',
          document_id: row.id,
          description: `دفعة متوقعة (${row.due_date})`,
          project_id: row.project_id,
          project_name: (row.projects as any)?.name,
          amount_due: remaining,
          document_date: row.due_date,
        });
      }
    }
  }

  // ── Also include project_opening_balances (Owner Claim #0) ──────────
  // Only include when prior_owner_dues > 0 (the total owed before system)
  const { data: openingBalances } = await supabase
    .from('project_opening_balances')
    .select('*, projects!inner(name, owner_id)')
    .eq('projects.owner_id', ownerId)
    .gt('prior_owner_dues', 0);

  if (openingBalances) {
    for (const ob of openingBalances) {
      const { data: paidData } = await supabase
        .from('v_project_opening_balance_paid')
        .select('outstanding_amount')
        .eq('opening_balance_id', ob.id)
        .single();
      
      // outstanding_amount = prior_owner_dues - prior_owner_income - system_payments
      const remaining = paidData?.outstanding_amount ?? (ob.prior_owner_dues - ob.prior_owner_income);
      if (remaining > 0) {
        openDocs.push({
          document_type: 'project_opening_balance',
          document_id: ob.id,
          description: `رصيد افتتاحي للمشروع (مستخلص #0)`,
          project_id: ob.project_id,
          project_name: (ob.projects as any)?.name,
          amount_due: remaining,
          document_date: ob.cutoff_date,
        });
      }
    }
  }


  const { data: projects } = await supabase.from('projects').select('id, name').order('name');

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold">تحصيل دفعة من المالك</h1>
        <p className="text-muted-foreground mt-1">المالك: {owner.name}</p>
      </div>

      <OwnerReceiptCalculator
        ownerId={ownerId}
        openDocs={openDocs}
        bankAccounts={bankAccounts || []}
        projects={projects || []}
      />
    </div>
  );
}
