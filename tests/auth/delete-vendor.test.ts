import { beforeEach, describe, expect, it, vi } from 'vitest'

// Everything external is mocked — no Supabase, no network.
const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/audit', () => ({ logAudit: vi.fn() }))
vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))

import { deleteVendor } from '@/lib/actions/vendors'

const vendorId = '11111111-1111-4111-8111-111111111111'

describe('deleteVendor', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes only through the delete_vendor database function (which checks for transactions)', async () => {
    const rpc = vi.fn(async () => ({ error: null }))
    const from = vi.fn()
    mocks.createClient.mockResolvedValue({ rpc, from })

    expect(await deleteVendor(vendorId)).toEqual({ success: true })
    expect(rpc).toHaveBeenCalledExactlyOnceWith('delete_vendor', { p_vendor_id: vendorId })
    // never a plain table delete that could bypass the transaction check
    expect(from).not.toHaveBeenCalled()
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/vendors')
  })

  it('returns the database refusal (what transactions exist) and refreshes nothing', async () => {
    const message = 'لا يمكن حذف "مقاول" لوجود معاملات مسجلة عليه: مستخلصات (2)، دفعات (3)'
    mocks.createClient.mockResolvedValue({ rpc: vi.fn(async () => ({ error: { message } })) })

    expect(await deleteVendor(vendorId)).toEqual({ error: message })
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })
})
