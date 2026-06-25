'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, ChevronDown } from 'lucide-react';

export function AdvancePayButton({ contractors }: { contractors: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const router = useRouter();

  const handleGo = () => {
    if (!selected) return;
    router.push(`/treasury/pay/${selected}`);
  };

  return (
    <div className="relative flex items-center gap-2">
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors shadow-sm"
        >
          <Plus className="h-4 w-4" />
          دفعة مسبقة / سلفة
        </button>
      ) : (
        <div className="flex items-center gap-2 bg-card border rounded-lg p-2 shadow-md animate-in fade-in slide-in-from-top-1">
          <select
            autoFocus
            value={selected}
            onChange={e => setSelected(e.target.value)}
            className="p-2 rounded border bg-background text-sm min-w-[200px]"
          >
            <option value="">اختر المقاول...</option>
            {contractors.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <button
            onClick={handleGo}
            disabled={!selected}
            className="px-3 py-2 rounded bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-40 transition-colors"
          >
            دفع
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
