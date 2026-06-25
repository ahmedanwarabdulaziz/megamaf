'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';

export function AdvanceReceiveButton({ owners }: { owners: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const router = useRouter();

  const handleGo = () => {
    if (!selected) return;
    router.push(`/treasury/receive/${selected}`);
  };

  return (
    <div className="relative flex items-center gap-2">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 transition-colors shadow-sm"
        >
          <Plus className="h-4 w-4" />
          تحصيل دفعة مقدمة
        </button>
      ) : (
        <div className="flex items-center gap-2 bg-card border rounded-lg p-2 shadow-md animate-in fade-in slide-in-from-top-1">
          <select
            autoFocus
            value={selected}
            onChange={e => setSelected(e.target.value)}
            className="p-2 rounded border bg-background text-sm min-w-[200px]"
          >
            <option value="">اختر المالك...</option>
            {owners.map(o => (
              <option key={o.id} value={o.id}>{o.name}</option>
            ))}
          </select>
          <button
            onClick={handleGo}
            disabled={!selected}
            className="px-3 py-2 rounded bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-40 transition-colors"
          >
            تحصيل
          </button>
          <button
            onClick={() => { setOpen(false); setSelected(''); }}
            className="px-3 py-2 rounded border text-sm text-muted-foreground hover:bg-muted transition-colors"
          >
            إلغاء
          </button>
        </div>
      )}
    </div>
  );
}
