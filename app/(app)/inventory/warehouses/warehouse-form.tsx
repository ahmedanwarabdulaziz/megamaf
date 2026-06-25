'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { createWarehouse } from '@/lib/actions/inventory';

export function WarehouseForm({ projects }: { projects: any[] }) {
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    const result = await createWarehouse(formData);
    
    if (result.error) {
      alert(result.error);
    } else {
      (e.target as HTMLFormElement).reset();
    }
    setLoading(false);
  }

  return (
    <form onSubmit={handleSubmit} className="bg-card p-4 rounded-lg border shadow-sm space-y-4">
      <h2 className="font-bold border-b pb-2">إضافة مستودع جديد</h2>
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
      <Button type="submit" className="w-full" disabled={loading}>
        {loading ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
        حفظ المستودع
      </Button>
    </form>
  );
}
