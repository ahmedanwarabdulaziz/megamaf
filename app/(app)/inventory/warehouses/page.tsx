import { createClient } from '@/lib/supabase/server';
import { WarehouseForm } from './warehouse-form';

export const metadata = { title: 'إدارة المستودعات' };

export default async function WarehousesPage() {
  const supabase = await createClient();
  const { data: warehouses } = await supabase.from('warehouses').select('*, projects(name)').order('name');
  const { data: projects } = await supabase.from('projects').select('id, name').order('name');

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">دليل المستودعات</h1>
          <p className="text-muted-foreground mt-1">إضافة وإدارة المستودعات الرئيسية ومستودعات المشاريع</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="md:col-span-1">
          <WarehouseForm projects={projects || []} />
        </div>
        <div className="md:col-span-2 bg-card rounded-lg border shadow-sm overflow-hidden">
          <table className="w-full text-sm text-right">
            <thead className="bg-muted/50 border-b">
              <tr>
                <th className="p-3 font-medium">اسم المستودع</th>
                <th className="p-3 font-medium">النوع / المشروع التابع له</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {warehouses?.map(w => (
                <tr key={w.id} className="hover:bg-muted/30">
                  <td className="p-3 font-bold">{w.name}</td>
                  <td className="p-3">
                    {w.project_id ? (
                      <span className="bg-secondary/50 text-secondary-foreground px-2 py-1 rounded-md text-xs">{w.projects?.name}</span>
                    ) : (
                      <span className="bg-primary/10 text-primary px-2 py-1 rounded-md text-xs font-bold">مستودع رئيسي (الشركة)</span>
                    )}
                  </td>
                </tr>
              ))}
              {(!warehouses || warehouses.length === 0) && (
                <tr>
                  <td colSpan={2} className="p-8 text-center text-muted-foreground">لم يتم إضافة مستودعات بعد.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
