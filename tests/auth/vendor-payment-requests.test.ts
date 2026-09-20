import { beforeEach, describe, expect, it, vi } from 'vitest'

// Everything external is mocked — no Supabase, no notifications, no network.
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
  sendPushNotification: vi.fn(),
  after: vi.fn((cb: () => unknown) => cb()),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next/server', () => ({ after: mocks.after }))
vi.mock('@/lib/notifications', () => ({ sendPushNotification: mocks.sendPushNotification }))

import {
  approveVendorPaymentRequest,
  rejectVendorPaymentRequest,
  requestVendorPayment,
} from '@/lib/actions/payments'
import { canReadAttachment, canUploadAttachment } from '@/lib/attachment-security'

const vendorId = '11111111-1111-4111-8111-111111111111'
const bankAccountId = '22222222-2222-4222-8222-222222222222'
const fundingEmployeeId = '33333333-3333-4333-8333-333333333333'
const requestId = '44444444-4444-4444-8444-444444444444'
const projectId = '55555555-5555-4555-8555-555555555555'

type Calls = { rpc: Array<[string, unknown]>; inserts: Array<[string, unknown]> }

/** Minimal chainable Supabase double. `tables` gives the row a select().single() returns. */
function fakeSupabase(opts: {
  rpcResult?: { data?: unknown; error?: { message: string } | null }
  tables?: Record<string, unknown>
  approvers?: Array<{ id: string }>
} = {}) {
  const calls: Calls = { rpc: [], inserts: [] }
  const client = {
    calls,
    rpc: vi.fn(async (name: string, args: unknown) => {
      calls.rpc.push([name, args])
      return opts.rpcResult ?? { data: null, error: null }
    }),
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'auth-1' } } })) },
    from: vi.fn((table: string) => {
      const row = opts.tables?.[table]
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        or: async () => ({ data: opts.approvers ?? [] }),
        single: async () => ({ data: row ?? null }),
        insert: async (value: unknown) => {
          calls.inserts.push([table, value])
          return { error: null }
        },
      }
      return chain
    }),
  }
  return client
}

function bankForm(overrides: Record<string, string> = {}) {
  const form = new FormData()
  const values: Record<string, string> = {
    vendor_id: vendorId,
    amount: '1500',
    memo: 'دفعة',
    project_id: '',
    funding_type: 'bank',
    funding_bank_account_id: bankAccountId,
    ...overrides,
  }
  for (const [k, v] of Object.entries(values)) form.append(k, v)
  return form
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.after.mockImplementation((cb: () => unknown) => cb())
})

describe('requestVendorPayment', () => {
  it.each([
    ['a non-positive amount', { amount: '0' }],
    ['no funding type', { funding_type: '' }],
    ['a bank source without an account', { funding_bank_account_id: '' }],
    ['a custody source without an employee', { funding_type: 'employee_custody', funding_bank_account_id: '' }],
  ])('rejects %s before touching the database', async (_label, overrides) => {
    const supabase = fakeSupabase()
    mocks.createClient.mockResolvedValue(supabase)

    const result = await requestVendorPayment(bankForm(overrides), [])

    expect(result).toHaveProperty('error')
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('creates a pending request through the RPC, never a direct payment, and notifies approvers', async () => {
    const supabase = fakeSupabase({ rpcResult: { data: requestId, error: null }, approvers: [{ id: 'admin-1' }] })
    mocks.createClient.mockResolvedValue(supabase)
    const allocations = [{ target_type: 'claim', target_id: 'claim-1', amount: 1500 }]

    const result = await requestVendorPayment(bankForm(), allocations)

    expect(result).toEqual({ success: true, id: requestId })
    const names = supabase.calls.rpc.map(([name]) => name)
    expect(names).toEqual(['request_vendor_payment'])
    expect(names).not.toContain('record_vendor_payment')
    expect(supabase.calls.rpc[0][1]).toMatchObject({
      p_vendor_id: vendorId,
      p_amount: 1500,
      p_allocations: allocations,
      p_funding_type: 'bank',
      p_funding_bank_account_id: bankAccountId,
      p_funding_employee_id: null,
    })
    expect(mocks.sendPushNotification).toHaveBeenCalledWith(
      ['admin-1'], expect.any(String), expect.any(String), '/expenses/approvals', 'payment_request_submitted',
    )
  })

  it('sends only the chosen source: a custody request drops any stray bank account', async () => {
    const supabase = fakeSupabase({ rpcResult: { data: requestId, error: null } })
    mocks.createClient.mockResolvedValue(supabase)

    await requestVendorPayment(
      bankForm({ funding_type: 'employee_custody', funding_employee_id: fundingEmployeeId }),
      [],
    )

    expect(supabase.calls.rpc[0][1]).toMatchObject({
      p_funding_type: 'employee_custody',
      p_funding_bank_account_id: null,
      p_funding_employee_id: fundingEmployeeId,
    })
  })

  it('stores receipts against the request (not a ledger entry) and surfaces RPC errors', async () => {
    const ok = fakeSupabase({ rpcResult: { data: requestId, error: null }, tables: { employees: { id: 'emp-1' } } })
    mocks.createClient.mockResolvedValue(ok)
    await requestVendorPayment(bankForm(), [], ['receipt.pdf'])
    expect(ok.calls.inserts).toEqual([[
      'attachments',
      [expect.objectContaining({ entity_type: 'vendor_payment_request', entity_id: requestId, r2_key: 'receipt.pdf' })],
    ]])

    const failing = fakeSupabase({ rpcResult: { data: null, error: { message: 'Not authorized to request vendor payments' } } })
    mocks.createClient.mockResolvedValue(failing)
    expect(await requestVendorPayment(bankForm(), [])).toEqual({ error: 'Not authorized to request vendor payments' })
    expect(failing.calls.inserts).toEqual([])
  })
})

describe('approve / reject vendor payment request', () => {
  it('approve goes through the approval RPC and notifies the requester', async () => {
    const supabase = fakeSupabase({
      rpcResult: { data: 'ledger-1', error: null },
      tables: { vendor_payment_requests: { requested_by: 'emp-9', vendor_id: vendorId, amount: 1500 } },
    })
    mocks.createClient.mockResolvedValue(supabase)

    expect(await approveVendorPaymentRequest(requestId)).toEqual({ success: true })
    expect(supabase.calls.rpc).toEqual([['approve_vendor_payment_request', { p_request_id: requestId }]])
    expect(mocks.sendPushNotification).toHaveBeenCalledWith(
      ['emp-9'], expect.any(String), expect.any(String), '/treasury?tab=payables', 'payment_request_approved',
    )
  })

  it('approve returns the database error and notifies nobody', async () => {
    const supabase = fakeSupabase({
      rpcResult: { data: null, error: { message: 'You cannot approve your own payment request' } },
      tables: { vendor_payment_requests: { requested_by: 'emp-9', vendor_id: vendorId, amount: 1500 } },
    })
    mocks.createClient.mockResolvedValue(supabase)

    expect(await approveVendorPaymentRequest(requestId)).toEqual({ error: 'You cannot approve your own payment request' })
    expect(mocks.sendPushNotification).not.toHaveBeenCalled()
  })

  it('reject requires a reason and never calls the RPC without one', async () => {
    const supabase = fakeSupabase()
    mocks.createClient.mockResolvedValue(supabase)

    expect(await rejectVendorPaymentRequest(requestId, '   ')).toEqual({ error: 'يرجى كتابة سبب الرفض' })
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('reject passes the trimmed reason through and notifies the requester', async () => {
    const supabase = fakeSupabase({ tables: { vendor_payment_requests: { requested_by: 'emp-9', amount: 1500 } } })
    mocks.createClient.mockResolvedValue(supabase)

    expect(await rejectVendorPaymentRequest(requestId, '  المبلغ خاطئ  ')).toEqual({ success: true })
    expect(supabase.calls.rpc).toEqual([['reject_vendor_payment_request', { p_request_id: requestId, p_reason: 'المبلغ خاطئ' }]])
    expect(mocks.sendPushNotification).toHaveBeenCalledWith(
      ['emp-9'], expect.any(String), expect.stringContaining('المبلغ خاطئ'), '/treasury?tab=payables', 'payment_request_rejected',
    )
  })
})

describe('vendor payment request attachment policy', () => {
  const record = { r2_key: 'r.pdf', entity_type: 'vendor_payment_request', entity_id: requestId }

  function profile(extra: Record<string, unknown> = {}, pages: Array<[string, string]> = []) {
    return {
      id: 'employee-1',
      is_active: true,
      is_super_admin: false,
      employee_page_access: pages.map(([page_slug, access_level]) => ({ page_slug, access_level })),
      ...extra,
    }
  }

  it('lets an approver read receipts without a treasury page grant, but not a plain employee', () => {
    expect(canReadAttachment(profile({ can_approve: true }), record, 'treasury')).toBe(true)
    expect(canReadAttachment(profile(), record, 'treasury')).toBe(false)
    expect(canReadAttachment(profile({}, [['treasury', 'view']]), record, 'treasury')).toBe(true)
  })

  it('the approver shortcut does not leak to other attachment types or inactive approvers', () => {
    const ledgerRecord = { ...record, entity_type: 'vendor_payment' }
    expect(canReadAttachment(profile({ can_approve: true }), ledgerRecord, 'treasury')).toBe(false)
    expect(canReadAttachment(profile({ can_approve: true, is_active: false }), record, 'treasury')).toBe(false)
  })

  it('lets a funding-access employee with treasury view upload a payment receipt, but no one else at view level', () => {
    const viewOnly = [['treasury', 'view']] as Array<[string, string]>
    expect(canUploadAttachment(profile({ has_expense_funding_access: true }, viewOnly), 'vendor_payment', 'treasury')).toBe(true)
    expect(canUploadAttachment(profile({}, viewOnly), 'vendor_payment', 'treasury')).toBe(false)
    expect(canUploadAttachment(profile({ has_expense_funding_access: true }), 'vendor_payment', 'treasury')).toBe(false)
  })
})
