export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; classes: string }> = {
    pending:  { label: 'قيد المراجعة', classes: 'bg-yellow-500/10 text-yellow-600' },
    approved: { label: 'معتمد',        classes: 'bg-green-500/10 text-green-600'  },
    rejected: { label: 'مرفوض',        classes: 'bg-red-500/10 text-red-600'     },
  };
  const config = map[status] || { label: status, classes: 'bg-accent text-foreground' };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${config.classes}`}>
      {config.label}
    </span>
  );
}
