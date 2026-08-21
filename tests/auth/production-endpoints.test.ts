import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: mocks.createClient,
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}))

vi.mock('@/lib/auth/pin', () => ({
  hashPin: vi.fn(),
}))

import { GET as seedAdmin } from '@/app/api/seed-admin/route'
import { GET as diagnosticAccount } from '@/app/(app)/api/test/route'
import { GET as diagnosticClaims } from '@/app/(app)/api/test-claims/route'
import { GET as backupHealth } from '@/app/api/backup-health/route'

describe('production endpoint protections', () => {
  beforeEach(() => {
    mocks.createClient.mockReset()
    mocks.createAdminClient.mockReset()
    vi.stubEnv('NODE_ENV', 'production')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('keeps the admin bootstrap endpoint unavailable in production', async () => {
    const response = await seedAdmin()

    expect(response.status).toBe(404)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('keeps the account diagnostic endpoint unavailable in production', async () => {
    const response = await diagnosticAccount(
      new Request('https://megamaf.test/api/test'),
    )

    expect(response.status).toBe(404)
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('keeps the claims diagnostic endpoint unavailable in production', async () => {
    const response = await diagnosticClaims(
      new Request('https://megamaf.test/api/test-claims'),
    )

    expect(response.status).toBe(404)
    expect(mocks.createClient).not.toHaveBeenCalled()
  })

  it('rejects anonymous backup-health requests', async () => {
    mocks.createClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
    })

    const response = await backupHealth()

    expect(response.status).toBe(401)
  })
})
