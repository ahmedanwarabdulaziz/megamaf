import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import Link from 'next/link'
import { ProjectCards } from './_components/project-cards'
import { ProjectModal } from './_components/project-modal'

export const dynamic = 'force-dynamic'

export default async function ProjectsPage() {
  const supabase = await createClient()
  
  // Fetch projects
  const { data: projectsData } = await supabase
    .from('projects')
    .select(`
      *,
      project_owners(name)
    `)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    
  // Fetch financial position
  const { data: finData } = await supabase
    .from('v_project_financial_position')
    .select('*')
    
  // Merge them
  const projects = (projectsData || []).map(p => ({
    ...p,
    v_project_financial_position: (finData || []).filter(f => f.project_id === p.id)
  }))

  const { data: owners } = await supabase.from('project_owners').select('id, name')

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
