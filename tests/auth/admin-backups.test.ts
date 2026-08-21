import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getSuperAdminContext: vi.fn(),
  isSameOrigin: vi.fn(),
  createR2Client: vi.fn(),
}))

vi.mock('@/lib/backup/security', () => ({
  getSuperAdminContext: mocks.getSuperAdminContext,
  isSameOrigin: mocks.isSameOrigin,
}))

vi.mock('@/lib/r2', () => ({
  createR2Client: mocks.createR2Client,
  R2_BUCKET: 'test-general-bucket',
  R2_BUCKET_TREASURY: 'test-treasury-bucket',
}))

import { GET as cloudBackups } from '@/app/api/admin/cloud-backups/route'
import { GET as attachmentBackups } from '@/app/api/admin/attachment-backup/route'
import { GET as backupDevices } from '@/app/api/admin/backup-devices/route'

describe('backup administration authorization', () => {
  beforeEach(() => {
    mocks.getSuperAdminContext.mockReset()
    mocks.isSameOrigin.mockReset()
    mocks.createR2Client.mockReset()
    mocks.getSuperAdminContext.mockResolvedValue(null)
    mocks.isSameOrigin.mockReturnValue(true)
  })

  it('rejects a non-super-admin cloud-backup request', async () => {
    const response = await cloudBackups()

    expect(response.status).toBe(401)
    expect(mocks.createR2Client).not.toHaveBeenCalled()
  })

  it('rejects a non-super-admin attachment-backup request', async () => {
    const response = await attachmentBackups(
      new Request(
        'https://megamaf.test/api/admin/attachment-backup?bucket=general',
        { headers: { Origin: 'https://megamaf.test' } },
      ),
    )

    expect(response.status).toBe(401)
    expect(mocks.createR2Client).not.toHaveBeenCalled()
  })

  it('rejects a non-super-admin backup-device request', async () => {
    const response = await backupDevices()

    expect(response.status).toBe(401)
  })
})
