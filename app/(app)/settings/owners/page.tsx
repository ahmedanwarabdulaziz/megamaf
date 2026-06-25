import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Plus, Users } from "lucide-react"
import Link from "next/link"
import { OwnerModal } from "@/components/owners/OwnerModal"
import { OwnerCard } from "@/components/owners/OwnerCard"

export default async function OwnersPage() {
  const supabase = await createClient()

  const { data: owners } = await supabase
    .from("project_owners")
    .select(`
      id,
      name,
      phone,
      notes,
      projects (
        id,
        name,
        code,
        node_type,
        status
      )
    `)
    .order("created_at", { ascending: false })

  const { data: unassignedProjects } = await supabase
    .from("projects")
    .select("id, name, code, node_type, status")
    .is("owner_id", null)
    .neq("node_type", "main_company")
    .order("sort_order", { ascending: true })

  const ownersList = owners || []
  const available = unassignedProjects || []

  return (
    <div className="space-y-6 p-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">ملاك المشاريع</h1>
          <p className="text-sm text-muted-foreground mt-1">
            ادارة الملاك واسناد المشاريع اليهم
          </p>
        </div>
        <Link href="?modal=add-owner" scroll={false}>
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            اضافة مالك
          </Button>
        </Link>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">اجمالي الملاك</p>
          <p className="text-2xl font-bold mt-1">{ownersList.length}</p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">مشاريع مسندة</p>
          <p className="text-2xl font-bold mt-1">
            {ownersList.reduce((acc, o) => acc + (o.projects?.length || 0), 0)}
          </p>
        </div>
        <div className="rounded-lg border border-border bg-card p-4 col-span-2 sm:col-span-1">
          <p className="text-xs text-muted-foreground">مشاريع غير مسندة</p>
          <p className="text-2xl font-bold mt-1">{available.length}</p>
        </div>
      </div>

      {ownersList.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground gap-3">
          <Users className="h-12 w-12 opacity-20" />
          <p className="text-base">لا يوجد ملاك مضافين بعد</p>
          <Link href="?modal=add-owner" scroll={false}>
            <Button variant="outline" className="gap-2">
              <Plus className="h-4 w-4" />
              اضافة اول مالك
            </Button>
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {ownersList.map(owner => (
            <OwnerCard
              key={owner.id}
              owner={{
                id: owner.id,
                name: owner.name,
                phone: owner.phone,
                notes: owner.notes,
                projects: owner.projects || [],
              }}
              availableProjects={available}
            />
          ))}
        </div>
      )}

      <OwnerModal />
    </div>
  )
}