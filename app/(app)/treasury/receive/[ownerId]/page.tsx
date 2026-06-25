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

  // ── Get outstanding amounts from v_claim_totals ───────────────────────────
  // total_due_this_claim = cumulative_payable − total_actually_paid_for_party_project
  const claimIds = latestClaims.map((c) => c.id);
  const { data: claimTotals } = claimIds.length > 0
    ? await supabase.from('v_claim_totals').select('claim_id, total_due_this_claim').in('claim_id', claimIds)
    : { data: [] };

  // ── Build openDocs list: one entry per project (latest claim only) ──────
  const openDocs: any[] = latestClaims
    .map((claim) => {
      const totals = claimTotals?.find((t) => t.claim_id === claim.id);
      return {
        document_type: 'claim',
        document_id: claim.id,
        description: `مستخلص رقم ${claim.claim_number}`,
        project_id: claim.project_id,
        project_name: (claim.projects as any)?.name,
        amount_due: totals?.total_due_this_claim ?? 0,
        document_date: claim.claim_date,
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
