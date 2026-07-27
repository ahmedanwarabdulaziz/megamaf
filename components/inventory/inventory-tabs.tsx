import Link from 'next/link';

const TABS = [
  { href: '/inventory', key: 'balances', label: 'الأرصدة' },
  { href: '/inventory/items', key: 'items', label: 'الأصناف' },
  { href: '/inventory/warehouses', key: 'warehouses', label: 'المستودعات' },
] as const;

export function InventoryTabs({ active }: { active: 'balances' | 'items' | 'warehouses' }) {
  return (
    <div className="flex gap-2 border-b overflow-x-auto pb-1">
      {TABS.map(tab => (
        <Link
          key={tab.key}
          href={tab.href}
          className={`px-4 py-2 font-medium text-sm whitespace-nowrap border-b-2 transition-colors ${
            active === tab.key
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  );
}
