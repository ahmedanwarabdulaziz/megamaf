"use server"

import { getBatchSignedUrls, getBatchSignedUrlsTreasury } from "@/lib/r2"
import { getProfile } from "@/lib/supabase/get-profile"
import {
  attachmentRule,
  canAccessAttachmentProject,
  canReadAttachment,
  normalizeAttachmentKeys,
  type AttachmentBucket,
  type AttachmentRecord,
} from "@/lib/attachment-security"

/** Generate signed links only after checking the active employee, page grant, parent record, and project. */
export async function getDownloadUrls(r2Keys: string[]): Promise<Record<string, string>> {
  const keys = await authorizedAttachmentKeys(r2Keys, "general")
  return keys.length > 0 ? getBatchSignedUrls(keys) : {}
}

/** Same authorization checks, against the isolated treasury-payment bucket. */
export async function getTreasuryDownloadUrls(r2Keys: string[]): Promise<Record<string, string>> {
  const keys = await authorizedAttachmentKeys(r2Keys, "treasury")
  return keys.length > 0 ? getBatchSignedUrlsTreasury(keys) : {}
}

async function authorizedAttachmentKeys(input: unknown, bucket: AttachmentBucket) {
  const requestedKeys = normalizeAttachmentKeys(input)
  if (requestedKeys.length === 0) return []

  const { user, profile, supabase } = await getProfile()
  if (!user || !profile || profile.is_active === false) return []

  const { data, error } = await supabase
    .from("attachments")
    .select("r2_key, entity_type, entity_id")
    .in("r2_key", requestedKeys)

  if (error || !data) return []

  const records = (data as AttachmentRecord[]).filter((record) =>
    attachmentRule(record.entity_type, bucket),
  )
  const candidates = records.filter((record) => canReadAttachment(profile, record, bucket))
  if (candidates.length === 0) return []

  const grantedProjects = new Set<string>()
  if (!profile.is_super_admin) {
    const { data: projectAccess } = await supabase
      .from("employee_project_access")
      .select("project_id")
      .eq("employee_id", profile.id)

    for (const row of projectAccess ?? []) grantedProjects.add(row.project_id)
  }

  const parentProjectByRecord = new Map<string, string | null>()
  const parentTables = new Map<string, Set<string>>()

  for (const record of candidates) {
    const rule = attachmentRule(record.entity_type, bucket)
    if (!rule) continue
    const ids = parentTables.get(rule.parentTable) ?? new Set<string>()
    ids.add(record.entity_id)
    parentTables.set(rule.parentTable, ids)
  }

  await Promise.all(
    [...parentTables.entries()].map(async ([table, ids]) => {
      const { data: parents } = await supabase
        .from(table)
        .select("id, project_id")
        .in("id", [...ids])

      for (const parent of parents ?? []) {
        parentProjectByRecord.set(`${table}:${parent.id}`, parent.project_id ?? null)
      }
    }),
  )

  const authorizedRecords = new Set<string>()
  for (const record of candidates) {
    const rule = attachmentRule(record.entity_type, bucket)
    if (!rule) continue
    const parentKey = `${rule.parentTable}:${record.entity_id}`
    if (!parentProjectByRecord.has(parentKey)) continue

    const projectId = parentProjectByRecord.get(parentKey) ?? null
    if (profile.is_super_admin || canAccessAttachmentProject(projectId, grantedProjects)) {
      authorizedRecords.add(recordIdentity(record))
    }
  }

  // A key can be referenced by more than one attachment row. Requiring every
  // same-bucket reference to pass prevents a user from linking a known key to a
  // new record they control and using that duplicate row to bypass permissions.
  return requestedKeys.filter((key) => {
    const references = records.filter((record) => record.r2_key === key)
    return references.length > 0 && references.every((record) =>
      authorizedRecords.has(recordIdentity(record)),
    )
  })
}

function recordIdentity(record: AttachmentRecord) {
  return `${record.r2_key}:${record.entity_type}:${record.entity_id}`
}
