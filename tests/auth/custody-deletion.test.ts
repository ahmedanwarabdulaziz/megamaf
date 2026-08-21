import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  createAdminClient: vi.fn(),
  logAudit: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/supabase/get-profile', () => ({
  getProfile: mocks.getProfile,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}))

vi.mock('@/lib/audit', () => ({
  logAudit: mocks.logAudit,
}))

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePath,
}))

vi.mock('@/lib/notifications', () => ({
  sendPushNotification: vi.fn(),
}))

import { deleteCustodyDisbursement } from '@/lib/actions/expenses'

const entryId = '11111111-1111-4111-8111-111111111111'

function profile(accessLevel = 'edit') {
  return {
    id: 'employee-1',
    is_active: true,
    is_super_admin: false,
    employee_page_access: [
      { page_slug: 'treasury/custody', access_level: accessLevel },
    ],
  }
}

function entry(overrides: Record<string, unknown> = {}) {
  return {
    id: entryId,
    category: 'custody_disbursement',
    direction: 'in',
    employee_id: '22222222-2222-4222-8222-222222222222',
    counterparty_type: 'bank',
    counterparty_id: '33333333-3333-4333-8333-333333333333',
    amount: 100,
    entry_date: '2026-08-21',
    ...overrides,
  }
}

function adminClient(currentEntry = entry()) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn().mockResolvedValue({ data: currentEntry, error: null }),
        })),
      })),
    })),
  }
}

function signedIn(currentProfile: ReturnType<typeof profile>) {
  const supabase = {
    rpc: vi.fn().mockResolvedValue({ error: null }),
  }
  mocks.getProfile.mockResolvedValue({
    user: { id: 'user-1' },
    profile: currentProfile,
    supabase,
  })
  return supabase
}

describe('custody disbursement deletion', () => {
  beforeEach(() => {
    mocks.getProfile.mockReset()
    mocks.createAdminClient.mockReset()
    mocks.logAudit.mockReset().mockResolvedValue(undefined)
    mocks.revalidatePath.mockReset()
  })

  it('rejects anonymous, inactive, and view-only users before using service role', async () => {
    mocks.getProfile.mockResolvedValue({ user: null, profile: null, supabase: {} })
    await expect(deleteCustodyDisbursement(entryId)).resolves.toEqual({ error: 'Unauthorized' })

    signedIn({ ...profile(), is_active: false })
    await expect(deleteCustodyDisbursement(entryId)).resolves.toEqual({ error: 'Unauthorized' })

    signedIn(profile('view'))
    await expect(deleteCustodyDisbursement(entryId)).resolves.toEqual({ error: 'Unauthorized' })

    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('rejects an invalid id before using service role', async () => {
    signedIn(profile())

    await expect(deleteCustodyDisbursement('not-a-uuid')).resolves.toEqual({
      error: 'Invalid entry ID',
    })
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('rejects a bank-side or unrelated ledger entry without deleting', async () => {
    const supabase = signedIn(profile())
    mocks.createAdminClient.mockReturnValue(adminClient(entry({ direction: 'out' })))

    await expect(deleteCustodyDisbursement(entryId)).resolves.toEqual({
      error: 'Invalid entry type',
    })
    expect(supabase.rpc).not.toHaveBeenCalled()
  })

  it('uses the authenticated atomic RPC for an authorized employee-side entry', async () => {
    const supabase = signedIn(profile())
    mocks.createAdminClient.mockReturnValue(adminClient())

    await expect(deleteCustodyDisbursement(entryId)).resolves.toEqual({ success: true })
    expect(supabase.rpc).toHaveBeenCalledWith('delete_custody_disbursement', {
      p_id: entryId,
    })
    expect(mocks.logAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        employee_id: 'employee-1',
        entity_id: entryId,
      }),
    )
  })

  it('allows an active super admin without a page grant', async () => {
    const supabase = signedIn({
      ...profile('view'),
      is_super_admin: true,
      employee_page_access: [],
    })
    mocks.createAdminClient.mockReturnValue(adminClient())

    await expect(deleteCustodyDisbursement(entryId)).resolves.toEqual({ success: true })
    expect(supabase.rpc).toHaveBeenCalledOnce()
  })
})
