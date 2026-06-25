// Single source of truth for grantable page-permission slugs.
// Keep these slugs in sync with the sidebar gates in app/(app)/layout.tsx.
export const EMPLOYEE_PAGES: { slug: string; name: string }[] = [
  { slug: 'projects', name: 'المشاريع' },
  { slug: 'banks', name: 'البنوك' },
  { slug: 'deposits', name: 'الودائع والشهادات' },
  { slug: 'treasury/custody', name: 'الخزينة (صرف العهد)' },
  { slug: 'expenses', name: 'المصروفات والعهد' },
  { slug: 'vendors', name: 'الموردون والفواتير' },
  { slug: 'claims', name: 'المستخلصات' },
  { slug: 'inventory', name: 'المخازن' },
  { slug: 'employees', name: 'الموظفون' },
  { slug: 'settings', name: 'الإعدادات' },
]
