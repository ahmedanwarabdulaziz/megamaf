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
  | 'vendor_payment_request'

type AttachmentRule = {
  bucket: AttachmentBucket
  writePage: string
  readPages: string[]
  parentTable: 'expenses' | 'invoices' | 'claims' | 'ledger_entries' | 'vendor_payment_requests'
}

export type AttachmentProfile = {
  id: string
  is_active?: boolean | null
  is_super_admin?: boolean | null
  has_custody_access?: boolean | null
  has_expense_funding_access?: boolean | null
  can_approve?: boolean | null
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
  // Receipts attached to a pending vendor payment request. They are copied to
  // a 'vendor_payment' row on the resulting ledger entry at approval time.
  // Approvers read them from /expenses/approvals (see canReadAttachment).
  vendor_payment_request: {
    bucket: 'treasury',
    writePage: 'treasury',
    readPages: ['treasury', 'vendors'],
    parentTable: 'vendor_payment_requests',
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
  if (!rule) return false
  if (!profile || profile.is_active === false) return false

  // Expense receipts: createExpense/updateExpense let ANY employee with
  // has_custody_access or has_expense_funding_access create/edit their OWN
  // expense — the /expenses page itself has no formal page-access gate at
  // all (see app/(app)/expenses/page.tsx). That's a separate, broader
  // self-service permission from the 'expenses' edit page grant this rule
  // otherwise requires (reserved for staff who manage OTHER employees'
  // expenses). Without this, an employee who can freely create and edit
  // their own expenses got rejected the moment they tried to attach a
  // receipt to one, whenever they lacked that separate formal grant.
  if (purpose === 'expense' && (profile.has_custody_access || profile.has_expense_funding_access)) {
    return true
  }

  // Vendor payment receipts: an employee with has_expense_funding_access can
  // submit a payment REQUEST (approved later by an approver) with a view-level
  // treasury grant, so they must be able to attach the transfer receipt too.
  // The uploaded file stays unreadable until an attachments row links it to a
  // record the reader is allowed to see (canReadAttachment).
  if (purpose === 'vendor_payment' && profile.has_expense_funding_access && hasPageAccess(profile, ['treasury'], false)) {
    return true
  }

  return hasPageAccess(profile, [rule.writePage], true)
}

export function canReadAttachment(
  profile: AttachmentProfile | null,
  record: AttachmentRecord,
  bucket: AttachmentBucket,
) {
  const rule = attachmentRule(record.entity_type, bucket)
  if (!rule) return false

  // Approvers review pending vendor payment requests on /expenses/approvals,
  // which is gated on can_approve rather than a page slug.
  if (record.entity_type === 'vendor_payment_request' && profile && profile.is_active !== false && profile.can_approve) {
    return true
  }

  return hasPageAccess(profile, rule.readPages, false)
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
