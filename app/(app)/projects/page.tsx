import { createClient } from '@/lib/supabase/server'
import { Button } from '@/components/ui/button'
import { Plus } from 'lucide-react'
import Link from 'next/link'
import { ProjectTreeTable } from './_components/project-tree-table'
import { ProjectModal } from './_components/project-modal'

export default async function ProjectsPage() {
  const supabase = await createClient()
  
  // Fetch all projects. RLS automatically scopes this to what the user can see.
  const { data: projects } = await supabase
    .from('projects')
    .select(`
      *,
      project_owners(name)
    `)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
    
  const { data: owners } = await supabase.from('project_owners').select('id, name')

  return (
    <div className="space-y-4 p-4">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">هيكل المشاريع</h1>
        <Link href="?modal=add-project" scroll={false}>
          <Button><Plus className="ml-2 h-4 w-4" /> إضافة عقد / مشروع</Button>
        </Link>
      </div>

      <ProjectTreeTable data={projects || []} />
      
      <ProjectModal owners={owners || []} projects={projects || []} />
    </div>
  )
}
