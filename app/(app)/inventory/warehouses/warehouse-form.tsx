'use client';

import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Loader2, Plus } from 'lucide-react';
import { createWarehouse } from '@/lib/actions/inventory';

export function WarehouseForm({ projects }: { projects: any[] }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submittingRef.current) return;
    submittingRef.current = true;
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    try {
      const result = await createWarehouse(formData);
      if (result.error) {
        alert(result.error);
      } else {
        (e.target as HTMLFormElement).reset();
        setOpen(false);
      }
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="w-4 h-4 ml-2" /> إضافة مستودع
      </Button>

      <Dialog open={open} onClose={() => setOpen(false)} title="إضافة مستودع جديد">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">اسم المستودع</label>
            <input required name="name" className="w-full p-2 rounded border bg-background" placeholder="مثال: مستودع العارض" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">المشروع التابع له</label>
            <select name="project_id" className="w-full p-2 rounded border bg-background">
              <option value="">-- مستودع رئيسي للشركة (غير مرتبط بمشروع) --</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground mt-1">المستودعات الرئيسية يمكن التحويل منها لجميع المشاريع.</p>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>إلغاء</Button>
            <Button type="submit" disabled={loading}>
              {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              حفظ المستودع
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
