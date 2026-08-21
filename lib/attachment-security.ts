import { randomUUID } from 'node:crypto'
import { attachmentExtension, isValidAttachmentKey } from '@/lib/upload-validation'

export type AttachmentBucket = 'general' | 'treasury'

export type AttachmentPurpose =
  | 'expense'
  | 'invoice'
  | 'claim'
  | 'custody_disbursement'
  | 'owner_custody_disbursement'
  | 'ledger_entry'
  | 'vendor_payment'

type AttachmentRule = {
  bucket: AttachmentBucket
  writePage: string
  readPages: string[]
  parentTable: 'expenses' | 'invoices' | 'claims' | 'ledger_entries'
}

export type AttachmentProfile = {
  id: string
  is_active?: boolean | null
  is_super_admin?: boolean | null
  employee_page_access?: Array<{
    page_slug?: string | null
    access_level?: string | null
  }> | null
}

export type AttachmentRecord = {
  r2_key: string
  entity_type: string
  entity_id: string
}

export const MAIN_COMPANY_PROJECT_ID = '00000000-0000-0000-0000-000000000001'
export const MAX_ATTACHMENT_KEYS_PER_REQUEST = 50

const ATTACHMENT_RULES: Record<AttachmentPurpose, AttachmentRule> = {
  expense: {
    bucket: 'general',
    writePage: 'expenses',
    readPages: ['expenses', 'settings'],
    parentTable: 'expenses',
  },
  invoice: {
    bucket: 'general',
    writePage: 'vendors',
    readPages: ['vendors'],
    parentTable: 'invoices',
  },
  claim: {
    bucket: 'general',
    writePage: 'claims',
    readPages: ['claims'],
    parentTable: 'claims',
  },
  custody_disbursement: {
    bucket: 'general',
    writePage: 'treasury/custody',
    readPages: ['treasury/custody', 'expenses', 'settings'],
    parentTable: 'ledger_entries',
  },
  owner_custody_disbursement: {
    bucket: 'general',
    writePage: 'treasury/custody',
    readPages: ['treasury/custody', 'settings'],
    parentTable: 'ledger_entries',
  },
  ledger_entry: {
    bucket: 'general',
    writePage: 'treasury',
    readPages: ['treasury', 'banks', 'settings'],
    parentTable: 'ledger_entries',
  },
  vendor_payment: {
    bucket: 'treasury',
    writePage: 'treasury',
    readPages: ['treasury', 'vendors'],
    parentTable: 'ledger_entries',
  },
}

export function attachmentRule(entityType: unknown, bucket: AttachmentBucket) {
  if (typeof entityType !== 'string') return null
  const rule = ATTACHMENT_RULES[entityType as AttachmentPurpose]
  return rule?.bucket === bucket ? rule : null
}

export function canUploadAttachment(
  profile: AttachmentProfile | null,
  purpose: unknown,
  bucket: AttachmentBucket,
) {
  const rule = attachmentRule(purpose, bucket)
  return !!rule && hasPageAccess(profile, [rule.writePage], true)
}

export function canReadAttachment(
  profile: AttachmentProfile | null,
  record: AttachmentRecord,
  bucket: AttachmentBucket,
) {
  const rule = attachmentRule(record.entity_type, bucket)
  return !!rule && hasPageAccess(profile, rule.readPages, false)
}

export function hasPageAccess(
  profile: AttachmentProfile | null,
  pages: string[],
  requireEdit: boolean,
) {
  if (!profile || profile.is_active === false) return false
  if (profile.is_super_admin) return true
  return (profile.employee_page_access ?? []).some((grant) =>
    pages.includes(grant.page_slug ?? '') &&
    (!requireEdit || grant.access_level === 'edit'),
  )
}

export function createAttachmentKey(file: File) {
  const extension = attachmentExtension(file)
  if (!extension) return null
  return `${randomUUID()}.${extension}`
}

export function normalizeAttachmentKeys(input: unknown) {
  if (!Array.isArray(input) || input.length > MAX_ATTACHMENT_KEYS_PER_REQUEST) return []
  return [...new Set(input.filter(isValidAttachmentKey))]
}

export function canAccessAttachmentProject(projectId: string | null, grantedProjects: Set<string>) {
  return !projectId || projectId === MAIN_COMPANY_PROJECT_ID || grantedProjects.has(projectId)
}
