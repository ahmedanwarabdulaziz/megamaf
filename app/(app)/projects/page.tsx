import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import Link from 'next/link'
import { ProjectCards } from './_components/project-cards'
import { ProjectModal } from './_components/project-modal'
import { requirePageAccess } from '@/lib/require-page-access'

export const dynamic = 'force-dynamic'

export default async function ProjectsPage() {
  await requirePageAccess('projects')
  const supabase = await createClient()

  // All 4 independent queries run in parallel — was 4 sequential awaits before
  const [
    { data: projectsData },
    { data: finData },
    { data: expenses },
    { data: owners },
  ] = await Promise.all([
    supabase
      .from('projects')
      .select('*, project_owners(name)')
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase
      .from('v_project_financial_position')
      .select('*'),
    supabase
      .from('expenses')
      .select('project_id, settled_amount')
      .eq('status', 'approved')
      .not('project_id', 'is', null),
    supabase
      .from('project_owners')
      .select('id, name'),
  ])

  const paidExpensesByProject = new Map<string, number>()
  for (const exp of expenses || []) {
    paidExpensesByProject.set(exp.project_id, (paidExpensesByProject.get(exp.project_id) || 0) + Number(exp.settled_amount || 0))
  }

  const projects = (projectsData || []).map(p => ({
    ...p,
    v_project_financial_position: (finData || []).filter(f => f.project_id === p.id).map(f => ({
      ...f,
      employee_expenses_paid: paidExpensesByProject.get(p.id) || 0,
    })),
  }))

  return (
    <div className="space-y-6 p-4 md:p-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h1 className="text-3xl font-bold text-foreground">هيكل المشاريع</h1>
        <Link href="?modal=add-project" scroll={false}>
          <Button size="lg" className="shadow-lg shadow-primary/20"><Plus className="ml-2 h-5 w-5" /> إضافة عقد / مشروع</Button>
        </Link>
      </div>

      <ProjectCards data={projects} />
      
      <ProjectModal owners={owners || []} projects={projectsData || []} />
    </div>
  )
}
