import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: mocks.createAdminClient,
}))

vi.mock('@/lib/backup/security', () => ({
  cleanText: (value: unknown, maximum: number) =>
    typeof value === 'string' ? value.trim().slice(0, maximum) || null : null,
  createAgentToken: vi.fn(() => 'unused-test-token'),
  hashBackupSecret: vi.fn((value: string) => `hash:${value}`),
  normalizePairingCode: (value: string) =>
    value.toUpperCase().replace(/[^A-Z2-9]/g, ''),
}))

import { POST as pairBackupDevice } from '@/app/api/backup-agent/pair/route'

describe('backup-agent pairing protection', () => {
  beforeEach(() => {
    mocks.createAdminClient.mockReset()
  })

  it('rejects an invalid pairing code before accessing the database', async () => {
    const response = await pairBackupDevice(
      new Request('https://megamaf.test/api/backup-agent/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'WRONG', name: 'Office PC' }),
      }),
    )

    expect(response.status).toBe(400)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON before accessing the database', async () => {
    const response = await pairBackupDevice(
      new Request('https://megamaf.test/api/backup-agent/pair', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not-json',
      }),
    )

    expect(response.status).toBe(400)
    expect(mocks.createAdminClient).not.toHaveBeenCalled()
  })
})
