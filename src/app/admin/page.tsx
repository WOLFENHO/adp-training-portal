import { requireAdmin } from '@/lib/auth'
import { Header } from '@/components/shell'
import { AdminDashboard } from '@/components/admin-dashboard'
export const dynamic='force-dynamic'
export default async function Admin(){const member=await requireAdmin();return <main className="shell"><Header member={member}/><section className="page"><div className="eyebrow">Administration</div><h1>Portal management</h1><p className="sub">Manage access, training videos, and member completion records.</p><AdminDashboard/></section></main>}
