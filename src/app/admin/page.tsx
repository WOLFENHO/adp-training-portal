import { requireAdmin } from '@/lib/auth'
import { Header } from '@/components/shell'
import { PagedAdminDashboard } from '@/components/paged-admin-dashboard'
import { uploadsEnabled } from '@/lib/upload-gate.mjs'
export const dynamic='force-dynamic'
export default async function Admin(){const member=await requireAdmin();return <main className="shell"><Header member={member}/><section className="page"><div className="eyebrow">Administration</div><h1>Portal management</h1><p className="sub">Manage access, training videos, and member completion records.</p><PagedAdminDashboard uploadsEnabled={uploadsEnabled()}/></section></main>}
