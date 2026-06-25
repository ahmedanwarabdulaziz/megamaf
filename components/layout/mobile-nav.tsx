'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home, LogOut, Landmark, Receipt, CheckSquare, Users, Settings,
  Wallet, FileText, FileSignature, Contact, Warehouse, ArrowLeftRight,
  X, Menu, ChevronLeft, BarChart3, FolderKanban,
} from 'lucide-react';

/* ─── nav structure (mirrors the sidebar) ────────────────────────────────── */
interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  subLabel?: string;
}

interface NavGroup {
  title: string;
  items: NavItem[];
}

interface MobileNavProps {
  employeeName: string;
  employeeRole: string;
  canSeeProjects: boolean;
  canSeeBanks: boolean;
  canSeeDeposits: boolean;
  canSeeTreasury: boolean;
  canSeeExpenses: boolean;
  canApprove: boolean;
  canSeeVendors: boolean;
  canSeeClaims: boolean;
  canSeeInventory: boolean;
  canSeeEmployees: boolean;
  canSeeSettings: boolean;
  canSeeOwners: boolean;
  isSuperAdmin: boolean;
}

export function MobileNav({
  employeeName,
  employeeRole,
  canSeeProjects,
  canSeeBanks,
  canSeeDeposits,
  canSeeTreasury,
  canSeeExpenses,
  canApprove,
  canSeeVendors,
  canSeeClaims,
  canSeeInventory,
  canSeeEmployees,
  canSeeSettings,
  canSeeOwners,
  isSuperAdmin,
}: MobileNavProps) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  // Close on route change
  useEffect(() => { setIsOpen(false); }, [pathname]);

  // Prevent body scroll when drawer open
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  const groups: NavGroup[] = [
    {
      title: 'الرئيسية',
      items: [
        { href: '/', label: 'الرئيسية', icon: <Home className="w-5 h-5" /> },
        ...(canSeeProjects ? [{ href: '/projects', label: 'المشاريع', icon: <FolderKanban className="w-5 h-5" /> }] : []),
      ],
    },
    {
      title: 'المالية',
      items: [
        ...(canSeeBanks ? [{ href: '/banks', label: 'البنوك والحسابات', icon: <Landmark className="w-5 h-5" /> }] : []),
        ...(canSeeDeposits ? [{ href: '/deposits', label: 'الودائع والشهادات', icon: <Wallet className="w-5 h-5" /> }] : []),
        ...(canSeeTreasury ? [
          { href: '/treasury?tab=receivables', label: 'سندات القبض', subLabel: 'تحصيل من الملاك', icon: <FileText className="w-5 h-5" /> },
          { href: '/treasury?tab=payables', label: 'سندات الصرف', subLabel: 'دفع للمقاولين', icon: <FileText className="w-5 h-5" /> },
          { href: '/treasury/custody', label: 'صرف العهد', icon: <ArrowLeftRight className="w-5 h-5" /> },
        ] : []),
      ],
    },
    {
      title: 'العمليات',
      items: [
        ...(canSeeExpenses ? [{ href: '/expenses', label: 'المصروفات والعهد', icon: <Receipt className="w-5 h-5" /> }] : []),
        ...(canApprove ? [{ href: '/expenses/approvals', label: 'اعتمادات المصروفات', icon: <CheckSquare className="w-5 h-5" /> }] : []),
        ...(canSeeVendors ? [
          { href: '/vendors', label: 'المقاولون والموردون', icon: <Users className="w-5 h-5" /> },
          { href: '/invoices', label: 'فواتير الموردين', icon: <FileText className="w-5 h-5" /> },
        ] : []),
        ...(canSeeClaims ? [{ href: '/claims', label: 'المستخلصات', icon: <FileSignature className="w-5 h-5" /> }] : []),
        ...(canSeeInventory ? [{ href: '/inventory', label: 'المخازن', icon: <Warehouse className="w-5 h-5" /> }] : []),
      ],
    },
    {
      title: 'الإدارة',
      items: [
        ...(canSeeEmployees ? [{ href: '/employees', label: 'الموظفون', icon: <Users className="w-5 h-5" /> }] : []),
        ...(canSeeOwners ? [{ href: '/settings/owners', label: 'الملاك', icon: <Contact className="w-5 h-5" /> }] : []),
        ...(canSeeSettings ? [{ href: '/settings', label: 'الإعدادات', icon: <Settings className="w-5 h-5" /> }] : []),
        ...(isSuperAdmin ? [{ href: '/reports', label: 'التقارير', icon: <BarChart3 className="w-5 h-5" /> }] : []),
      ],
    },
  ].filter(g => g.items.length > 0);

  const isActive = (href: string) => {
    const path = href.split('?')[0];
    return pathname === path || (path !== '/' && pathname.startsWith(path));
  };

  /* ── Quick-access bottom tabs (always visible on mobile) ─────────────── */
  const bottomTabs = [
    { href: '/', label: 'الرئيسية', icon: <Home className="w-5 h-5" /> },
    ...(canSeeProjects ? [{ href: '/projects', label: 'المشاريع', icon: <FolderKanban className="w-5 h-5" /> }] : []),
    ...(canSeeTreasury ? [{ href: '/treasury', label: 'الخزينة', icon: <ArrowLeftRight className="w-5 h-5" /> }] : []),
    ...(canSeeExpenses ? [{ href: '/expenses', label: 'المصروفات', icon: <Receipt className="w-5 h-5" /> }] : []),
  ].slice(0, 4); // max 4 tabs

  return (
    <>
      {/* ── Hamburger button (in the header, mobile only) ─────────────────── */}
      <button
        onClick={() => setIsOpen(true)}
        className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg hover:bg-accent transition-colors"
        aria-label="فتح القائمة"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* ── Backdrop ──────────────────────────────────────────────────────── */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden animate-in fade-in duration-200"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* ── Drawer (slides in from right / RTL end) ───────────────────────── */}
      <div
        className={`fixed top-0 right-0 z-50 h-full w-[300px] bg-card border-l border-border shadow-2xl flex flex-col md:hidden
          transition-transform duration-300 ease-out
          ${isOpen ? 'translate-x-0' : 'translate-x-full'}`}
        dir="rtl"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 h-14 border-b border-border bg-primary text-primary-foreground flex-shrink-0">
          <div>
            <p className="font-bold text-base leading-tight">ميجا ماف</p>
            <p className="text-xs text-primary-foreground/70 leading-tight">نظام إدارة المشاريع</p>
          </div>
          <button
            onClick={() => setIsOpen(false)}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-white/10 hover:bg-white/20 transition-colors"
            aria-label="إغلاق القائمة"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* User badge */}
        <div className="px-4 py-3 border-b border-border bg-muted/30 flex items-center gap-3 flex-shrink-0">
          <div className="w-9 h-9 rounded-full bg-primary/15 flex items-center justify-center flex-shrink-0">
            <span className="text-sm font-bold text-primary">
              {employeeName.charAt(0) || '؟'}
            </span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{employeeName}</p>
            <p className="text-xs text-muted-foreground">{employeeRole}</p>
          </div>
        </div>

        {/* Navigation groups */}
        <nav className="flex-1 overflow-y-auto py-2">
          {groups.map((group) => (
            <div key={group.title} className="mb-1">
              <p className="px-4 py-1.5 text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
                {group.title}
              </p>
              {group.items.map((item) => {
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`flex items-center gap-3 mx-2 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150
                      ${active
                        ? 'bg-primary text-primary-foreground shadow-sm'
                        : 'text-foreground/80 hover:bg-accent hover:text-accent-foreground'
                      }`}
                  >
                    <span className={active ? 'text-primary-foreground' : 'text-muted-foreground'}>
                      {item.icon}
                    </span>
                    <div className="min-w-0">
                      <p className="leading-tight truncate">{item.label}</p>
                      {item.subLabel && (
                        <p className={`text-[10px] leading-tight truncate ${active ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                          {item.subLabel}
                        </p>
                      )}
                    </div>
                    {!active && <ChevronLeft className="w-3.5 h-3.5 mr-auto text-muted-foreground/40 flex-shrink-0" />}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {/* Logout */}
        <div className="p-3 border-t border-border flex-shrink-0">
          <form action="/api/auth/logout" method="POST">
            <button
              type="submit"
              onClick={async (e) => {
                e.preventDefault();
                const { logout } = await import('@/app/(auth)/login/actions');
                logout();
              }}
              className="flex w-full items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-destructive hover:bg-destructive/10 transition-colors"
            >
              <LogOut className="w-5 h-5" />
              تسجيل الخروج
            </button>
          </form>
        </div>
      </div>

      {/* ── Bottom tab bar (always visible on mobile, quick access) ──────── */}
      {bottomTabs.length > 0 && (
        <nav
          className="fixed bottom-0 left-0 right-0 z-30 md:hidden bg-card border-t border-border flex safe-area-bottom"
          dir="rtl"
        >
          {bottomTabs.map((tab) => {
            const active = isActive(tab.href);
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`flex-1 flex flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium transition-colors
                  ${active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}`}
              >
                <span className={`transition-transform ${active ? 'scale-110' : ''}`}>
                  {tab.icon}
                </span>
                <span className="leading-tight">{tab.label}</span>
                {active && (
                  <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 bg-primary rounded-full" />
                )}
              </Link>
            );
          })}
          {/* "More" tab that opens the drawer */}
          <button
            onClick={() => setIsOpen(true)}
            className="flex-1 flex flex-col items-center justify-center gap-1 py-2 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <Menu className="w-5 h-5" />
            <span className="leading-tight">المزيد</span>
          </button>
        </nav>
      )}
    </>
  );
}
