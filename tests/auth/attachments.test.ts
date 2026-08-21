import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  r2Send: vi.fn(),
  createR2Client: vi.fn(),
  getBatchSignedUrls: vi.fn(),
  getBatchSignedUrlsTreasury: vi.fn(),
}))

vi.mock('@/lib/supabase/get-profile', () => ({
  getProfile: mocks.getProfile,
}))

vi.mock('@/lib/r2', () => ({
  R2_BUCKET: 'general-bucket',
  R2_BUCKET_TREASURY: 'treasury-bucket',
  createR2Client: mocks.createR2Client,
  getBatchSignedUrls: mocks.getBatchSignedUrls,
  getBatchSignedUrlsTreasury: mocks.getBatchSignedUrlsTreasury,
}))

import { POST as uploadGeneral } from '@/app/api/upload/route'
import { POST as uploadTreasury } from '@/app/api/upload-treasury/route'
import { getDownloadUrls } from '@/lib/actions/storage'
import {
  MAX_ATTACHMENT_KEYS_PER_REQUEST,
  canAccessAttachmentProject,
  canReadAttachment,
  canUploadAttachment,
  normalizeAttachmentKeys,
} from '@/lib/attachment-security'

function profile(page = 'expenses', accessLevel = 'edit') {
  return {
    id: 'employee-1',
    is_active: true,
    is_super_admin: false,
    employee_page_access: [{ page_slug: page, access_level: accessLevel }],
  }
}

function uploadRequest(file: File, purpose: string, attemptedKey?: string) {
  const form = new FormData()
  form.append('file', file)
  form.append('purpose', purpose)
  if (attemptedKey) form.append('key', attemptedKey)
  return { formData: async () => form } as never
}

function signedIn(currentProfile: ReturnType<typeof profile>) {
  mocks.getProfile.mockResolvedValue({
    user: { id: 'user-1' },
    profile: currentProfile,
    supabase: {},
  })
}

describe('attachment authorization policy', () => {
  beforeEach(() => {
    mocks.getProfile.mockReset()
    mocks.r2Send.mockReset().mockResolvedValue({})
    mocks.createR2Client.mockReset().mockReturnValue({ send: mocks.r2Send })
    mocks.getBatchSignedUrls.mockReset()
    mocks.getBatchSignedUrlsTreasury.mockReset()
  })

  it('requires an active edit-level grant for uploads', () => {
    expect(canUploadAttachment(null, 'expense', 'general')).toBe(false)
    expect(canUploadAttachment({ ...profile(), is_active: false }, 'expense', 'general')).toBe(false)
    expect(canUploadAttachment(profile('expenses', 'view'), 'expense', 'general')).toBe(false)
    expect(canUploadAttachment(profile(), 'expense', 'general')).toBe(true)
    expect(canUploadAttachment(profile(), 'expense', 'treasury')).toBe(false)
    expect(canUploadAttachment({ ...profile('banks', 'view'), is_super_admin: true }, 'claim', 'general')).toBe(true)
  })

  it('maps downloads to both the correct page grant and bucket', () => {
    const invoice = { r2_key: 'invoice.pdf', entity_type: 'invoice', entity_id: 'invoice-1' }
    const payment = { r2_key: 'payment.pdf', entity_type: 'vendor_payment', entity_id: 'entry-1' }

    expect(canReadAttachment(profile('vendors', 'view'), invoice, 'general')).toBe(true)
    expect(canReadAttachment(profile('expenses', 'view'), invoice, 'general')).toBe(false)
    expect(canReadAttachment(profile('vendors', 'view'), payment, 'general')).toBe(false)
    expect(canReadAttachment(profile('vendors', 'view'), payment, 'treasury')).toBe(true)
  })

  it('limits and validates requested object keys', () => {
    expect(normalizeAttachmentKeys(['a.pdf', 'a.pdf', '../secret', 'b.jpg'])).toEqual(['a.pdf', 'b.jpg'])
    expect(
      normalizeAttachmentKeys(
        Array.from({ length: MAX_ATTACHMENT_KEYS_PER_REQUEST + 1 }, (_, index) => `${index}.pdf`),
      ),
    ).toEqual([])
  })

  it('allows only null, main-company, or explicitly granted projects', () => {
    const projects = new Set(['project-1'])
    expect(canAccessAttachmentProject(null, projects)).toBe(true)
    expect(canAccessAttachmentProject('00000000-0000-0000-0000-000000000001', projects)).toBe(true)
    expect(canAccessAttachmentProject('project-1', projects)).toBe(true)
    expect(canAccessAttachmentProject('project-2', projects)).toBe(false)
  })

  it('rejects anonymous uploads before reading or sending a file', async () => {
    mocks.getProfile.mockResolvedValue({ user: null, profile: null, supabase: {} })

    const response = await uploadGeneral({ formData: vi.fn() } as never)

    expect(response.status).toBe(401)
    expect(mocks.r2Send).not.toHaveBeenCalled()
  })

  it('rejects inactive employees and view-only grants', async () => {
    const file = new File(['receipt'], 'receipt.pdf', { type: 'application/pdf' })
    signedIn({ ...profile(), is_active: false })
    expect((await uploadGeneral(uploadRequest(file, 'expense'))).status).toBe(403)

    signedIn(profile('expenses', 'view'))
    expect((await uploadGeneral(uploadRequest(file, 'expense'))).status).toBe(403)
    expect(mocks.r2Send).not.toHaveBeenCalled()
  })

  it('ignores a client key and creates a new collision-resistant object key', async () => {
    signedIn(profile())
    const file = new File(['receipt'], 'existing.pdf', { type: 'application/pdf' })

    const response = await uploadGeneral(uploadRequest(file, 'expense', 'existing.pdf'))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.key).toMatch(/^[0-9a-f-]{36}\.pdf$/)
    expect(body.key).not.toBe('existing.pdf')
    expect(mocks.r2Send).toHaveBeenCalledOnce()
    expect(mocks.r2Send.mock.calls[0][0].input).toMatchObject({
      Bucket: 'general-bucket',
      Key: body.key,
      ContentType: 'application/pdf',
    })
  })

  it('keeps treasury and general upload purposes isolated', async () => {
    signedIn(profile('treasury', 'edit'))
    const file = new File(['receipt'], 'receipt.pdf', { type: 'application/pdf' })

    expect((await uploadTreasury(uploadRequest(file, 'expense'))).status).toBe(403)
    expect((await uploadTreasury(uploadRequest(file, 'vendor_payment'))).status).toBe(201)
    expect(mocks.r2Send).toHaveBeenCalledOnce()
  })

  it('does not invoke the signer for anonymous download requests', async () => {
    mocks.getProfile.mockResolvedValue({ user: null, profile: null, supabase: {} })

    await expect(getDownloadUrls(['receipt.pdf'])).resolves.toEqual({})
    expect(mocks.getBatchSignedUrls).not.toHaveBeenCalled()
  })

  it('signs only attachment keys whose parent project is granted', async () => {
    const attachmentRows = [
      { r2_key: 'allowed.pdf', entity_type: 'expense', entity_id: 'expense-1' },
      { r2_key: 'blocked.pdf', entity_type: 'expense', entity_id: 'expense-2' },
    ]
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'attachments') {
          return {
            select: () => ({
              in: async () => ({ data: attachmentRows, error: null }),
            }),
          }
        }
        if (table === 'employee_project_access') {
          return {
            select: () => ({
              eq: async () => ({ data: [{ project_id: 'project-1' }] }),
            }),
          }
        }
        if (table === 'expenses') {
          return {
            select: () => ({
              in: async () => ({
                data: [
                  { id: 'expense-1', project_id: 'project-1' },
                  { id: 'expense-2', project_id: 'project-2' },
                ],
              }),
            }),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }
    mocks.getProfile.mockResolvedValue({
      user: { id: 'user-1' },
      profile: profile('expenses', 'view'),
      supabase,
    })
    mocks.getBatchSignedUrls.mockResolvedValue({ 'allowed.pdf': 'https://signed.test/allowed' })

    await expect(getDownloadUrls(['allowed.pdf', 'blocked.pdf'])).resolves.toEqual({
      'allowed.pdf': 'https://signed.test/allowed',
    })
    expect(mocks.getBatchSignedUrls).toHaveBeenCalledWith(['allowed.pdf'])
  })

  it('denies a key when a duplicate reference belongs to an inaccessible record', async () => {
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'attachments') {
          return {
            select: () => ({
              in: async () => ({
                data: [
                  { r2_key: 'shared.pdf', entity_type: 'expense', entity_id: 'expense-1' },
                  { r2_key: 'shared.pdf', entity_type: 'claim', entity_id: 'claim-1' },
                ],
                error: null,
              }),
            }),
          }
        }
        if (table === 'employee_project_access') {
          return {
            select: () => ({
              eq: async () => ({ data: [{ project_id: 'project-1' }] }),
            }),
          }
        }
        if (table === 'expenses') {
          return {
            select: () => ({
              in: async () => ({ data: [{ id: 'expense-1', project_id: 'project-1' }] }),
            }),
          }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }
    mocks.getProfile.mockResolvedValue({
      user: { id: 'user-1' },
      profile: profile('expenses', 'view'),
      supabase,
    })

    await expect(getDownloadUrls(['shared.pdf'])).resolves.toEqual({})
    expect(mocks.getBatchSignedUrls).not.toHaveBeenCalled()
  })
})
