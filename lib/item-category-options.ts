import type { SelectOption } from '@/components/ui/searchable-select';

/**
 * Group pre-built item options under non-selectable category headers.
 * `items` must carry `category_label` (from getInventoryItemsWithCategory).
 * Client-safe — no server imports.
 */
export function groupOptionsByCategory(items: any[], build: (item: any) => SelectOption): SelectOption[] {
  const groups = new Map<string, SelectOption[]>();
  for (const item of items) {
    const label = item.category_label || 'غير مصنف';
    if (!groups.has(label)) groups.set(label, []);
    groups.get(label)!.push(build(item));
  }

  const out: SelectOption[] = [];
  for (const [label, opts] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ar'))) {
    out.push({ value: `__category_${label}`, label, isGroupHeader: true });
    out.push(...opts);
  }
  return out;
}
