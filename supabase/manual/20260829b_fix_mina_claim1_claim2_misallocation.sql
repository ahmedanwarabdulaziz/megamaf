-- ONE-TIME MANUAL SCRIPT — not part of the migration history, run by hand
-- (Supabase SQL editor, correct project/branch — see the note the last
-- backfill run needed).
--
-- Vendor "مينا -اعمال محارة" (0c2f3608-05c5-45fb-87d6-943b339319a5),
-- project b23eaa0c-8295-4588-990a-82ab4a14b0dd.
--
-- Fixes pre-existing (2026-07-09 .. 2026-07-23, weeks before any of today's
-- changes — confirmed via created_at and the absence of any
-- claim_auto_settlement audit entry) misallocation:
--   - claim #1 (due 7,458.5) has 170,125 allocated to it (95000+25050+50075)
--   - claim #2 (due -6,300, a separate question, left as-is) has 27,741.5
--   - meanwhile claim #3 (due 71,769) has 0 paid, and claim #4
--     (due 132,967.5) is short by exactly 60,209.5
--
-- This does NOT change the vendor's total remaining balance (60,209.5,
-- verified against live data on 2026-08-29) — it only re-points four
-- existing payment_allocations rows, sourced from the exact same ledger
-- entries, to the claims that actually needed them:
--   claim #1 -> filled to its own due (7,458.5)
--   claim #2 -> emptied to 0 (can't sensibly hold a payment against a
--               negative due)
--   claim #3 -> filled to its own due (71,769)
--   claim #4 -> topped up by exactly 60,209.5 to reach its own due
--               (132,967.5)
--   58,429.5 is deliberately left UNALLOCATED (30,688 still free on ledger
--   entry 04fa3bff, 27,741.5 still free on 5bd64c6b) — a real, existing
--   advance for this vendor/project that approve_claim()'s auto-assignment
--   will apply automatically the next time a new claim (#7) is approved.
--
-- All four DELETEs target specific row ids (not a broad WHERE clause) so
-- this can't accidentally touch anything else. Verify the SELECT at the
-- bottom shows the expected numbers before trusting the fix.

BEGIN;

-- Remove the 4 misallocated rows (freeing their ledger entries)
DELETE FROM public.payment_allocations WHERE id IN (
  'ec39eb31-c31b-4f13-aed2-5f40547141ac', -- claim#1, 95000, entry c5294b42
  '2d88ccee-df98-4756-9d06-73e6efee2169', -- claim#1, 25050, entry 20db1c17
  'df85b055-3b66-4fde-a07d-7c4f2d9561cb', -- claim#1, 50075, entry 04fa3bff
  '917e505d-df60-4b6e-9ee1-aa9bb38fe2ed'  -- claim#2, 27741.5, entry 5bd64c6b
);

-- Re-point the same money to the claims that actually needed it
INSERT INTO public.payment_allocations (ledger_entry_id, target_type, target_id, allocated_amount) VALUES
  ('c5294b42-3278-4b56-b4f3-4d4cd89c8dbb', 'claim', 'b6f01b0f-3b9a-4388-bf24-daa0af999164', 7458.5),   -- claim#1, filled to its own due
  ('c5294b42-3278-4b56-b4f3-4d4cd89c8dbb', 'claim', '57da1948-0ce7-490f-b43d-679cd0eda509', 71769),     -- claim#3, filled to its own due
  ('c5294b42-3278-4b56-b4f3-4d4cd89c8dbb', 'claim', '75f3aa5e-684a-4b2b-91f3-93cb28e7e1e4', 15772.5),   -- claim#4, part 1 of 3
  ('20db1c17-63ad-4da4-a5f7-6c420a5af941', 'claim', '75f3aa5e-684a-4b2b-91f3-93cb28e7e1e4', 25050),     -- claim#4, part 2 of 3
  ('04fa3bff-050b-471c-9169-d2d901d5679d', 'claim', '75f3aa5e-684a-4b2b-91f3-93cb28e7e1e4', 19387);     -- claim#4, part 3 of 3 (completes 60,209.5)

-- Audit trail for this manual correction
INSERT INTO public.audit_log (employee_id, action, entity_type, entity_id, before, after) VALUES
  (NULL, 'update', 'claim_manual_correction', 'b6f01b0f-3b9a-4388-bf24-daa0af999164',
   jsonb_build_object('paid_amount', 170125), jsonb_build_object('paid_amount', 7458.5, 'source', 'backfill_20260829b')),
  (NULL, 'update', 'claim_manual_correction', 'f1566d90-80af-413e-9e9f-9a9f3b96d0e4',
   jsonb_build_object('paid_amount', 27741.5), jsonb_build_object('paid_amount', 0, 'source', 'backfill_20260829b')),
  (NULL, 'update', 'claim_manual_correction', '57da1948-0ce7-490f-b43d-679cd0eda509',
   jsonb_build_object('paid_amount', 0), jsonb_build_object('paid_amount', 71769, 'source', 'backfill_20260829b')),
  (NULL, 'update', 'claim_manual_correction', '75f3aa5e-684a-4b2b-91f3-93cb28e7e1e4',
   jsonb_build_object('paid_amount', 72758), jsonb_build_object('paid_amount', 132967.5, 'source', 'backfill_20260829b'));

-- Verify before committing: expect
--   claim#1 due=7458.5   paid=7458.5
--   claim#2 due=-6300    paid=0
--   claim#3 due=71769    paid=71769
--   claim#4 due=132967.5 paid=132967.5
--   claim#5 due=50407    paid=50407   (unchanged)
--   claim#6 due=109318.5 paid=109318.5 (unchanged)
SELECT
  c.claim_number,
  (SELECT total_due_this_claim FROM public.v_claim_totals WHERE claim_id = c.id) AS due,
  (SELECT paid_amount FROM public.v_claim_paid WHERE claim_id = c.id) AS paid
FROM public.claims c
WHERE c.party_id = '0c2f3608-05c5-45fb-87d6-943b339319a5'
  AND c.project_id = 'b23eaa0c-8295-4588-990a-82ab4a14b0dd'
  AND c.claim_type = 'vendor'
  AND c.status = 'approved'
ORDER BY c.claim_number;

-- Only after confirming the SELECT above matches the expected numbers:
COMMIT;
-- If anything looks wrong instead, run ROLLBACK; instead of COMMIT;
