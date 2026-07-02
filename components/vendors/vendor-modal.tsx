'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { saveVendor } from '@/lib/actions/vendors';

export function VendorModal({ vendor, projects }: { vendor?: any, projects: any[] }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [allProjects, setAllProjects] = useState(vendor ? vendor.all_projects : false);
  
  // Initialize with existing project IDs if editing
  const existingProjectIds = vendor?.vendor_project_access?.map((pa: any) => pa.project_id) || [];
  const [selectedProjects, setSelectedProjects] = useState<string[]>(existingProjectIds);

  const router = useRouter();

  if (!open) {
    if (vendor) {
      return <Button variant="outline" size="sm" onClick={() => setOpen(true)}>تعديل</Button>;
    }
    return <Button onClick={() => setOpen(true)}>إضافة جديد</Button>;
  }

  async function action(formData: FormData) {
    try {
      setLoading(true);
      formData.append('all_projects', allProjects.toString());
      if (vendor) formData.append('id', vendor.id);

      const result = await saveVendor(formData, selectedProjects);
      if (result?.error) {
        alert(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    } catch (e: any) {
      alert(e.message || "حدث خطأ");
    } finally {
      setLoading(false);
    }
  }

  const toggleProject = (id: string) => {
    setSelectedProjects(prev => 
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-background rounded-lg shadow-lg w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">{vendor ? 'تعديل بيانات' : 'إضافة مقاول / مورد جديد'}</h2>
        
        <form action={action} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">الاسم</label>
            <input required name="name" defaultValue={vendor?.name} className="w-full p-2 rounded border bg-background" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">النوع</label>
            <select required name="kind" defaultValue={vendor?.kind || ''} className="w-full p-2 rounded border bg-background">
              <option value="" disabled>اختر النوع...</option>
              <option value="vendor">مورد (توريدات)</option>
              <option value="contractor">مقاول (مصنعيات)</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">الهاتف</label>
            <input name="phone" defaultValue={vendor?.phone} className="w-full p-2 rounded border bg-background" />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">صلاحية المشاريع</label>
            <div className="flex items-center gap-2 mb-2 mt-2">
              <input 
                type="checkbox" 
                id="all_projects" 
                checked={allProjects} 
                onChange={(e) => setAllProjects(e.target.checked)} 
                className="w-4 h-4" 
              />
              <label htmlFor="all_projects" className="text-sm">السماح بكل المشاريع (الحالية والمستقبلية)</label>
            </div>
            
            {!allProjects && (
              <div className="mt-2 border rounded p-3 bg-muted/20 max-h-40 overflow-y-auto space-y-2">
                <p className="text-xs text-muted-foreground mb-2">اختر المشاريع المسموح له العمل بها:</p>
                {projects.map(p => (
                  <div key={p.id} className="flex items-center gap-2">
                    <input 
                      type="checkbox" 
                      id={`proj_${p.id}`}
                      checked={selectedProjects.includes(p.id)}
                      onChange={() => toggleProject(p.id)}
                      className="w-4 h-4"
                    />
                    <label htmlFor={`proj_${p.id}`} className="text-sm">{p.name}</label>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">ملاحظات</label>
            <textarea name="notes" defaultValue={vendor?.notes} className="w-full p-2 rounded border bg-background" rows={2} />
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
            <Button type="submit" disabled={loading}>{loading ? 'جاري الحفظ...' : 'حفظ'}</Button>
          </div>
        </form>
      </div>
    </div>
  );
}
