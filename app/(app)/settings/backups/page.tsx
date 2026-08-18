import { requireAdmin } from '@/lib/require-page-access'
import { BackupDevicesClient } from './backup-devices-client'

export const dynamic = 'force-dynamic'

export default async function BackupDevicesPage() {
  await requireAdmin()
  return <BackupDevicesClient />
}
