import { requireAdmin } from '@/lib/require-page-access'
import { CloudBackupsClient } from './cloud-backups-client'

export const dynamic = 'force-dynamic'

export default async function CloudBackupsPage() {
  await requireAdmin()
  return <CloudBackupsClient />
}
