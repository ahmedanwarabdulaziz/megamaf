"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Home, Settings, FileText, Landmark, X, Truck,
  FolderKanban, UserCheck, ClipboardList, Banknote,
  Receipt, ChevronDown, ChevronUp, LayoutList, Users, LogOut
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useState } from "react"
import { logout } from "@/app/(auth)/login/actions"

type NavSubItem = { label: string; href: string; icon: React.ReactNode; slug: string }
type MobileNavItem =
  | { label: string; href: string; icon: React.ReactNode; slug: string; subItems?: undefined }
  | { label: string; icon: React.ReactNode; slug: string; href?: undefined; subItems: NavSubItem[] }

const MOBILE_NAV_ITEMS: MobileNavItem[] = [
  { label: "الرئيسية", href: "/", icon: <Home className="h-5 w-5" />, slug: "home" },
  {
    label: "المالية",
    icon: <FileText className="h-5 w-5" />,
    slug: "finance-group",
    subItems: [
      { label: "الحسابات البنكية", href: "/accounts", icon: <Landmark className="h-4 w-4" />, slug: "accounts" },
      { label: "الشهادات والودائع", href: "/finance/certificates", icon: <FileText className="h-4 w-4" />, slug: "finance" },
    ],
  },
  { label: "المطالبات", href: "/vendor-pos", icon: <Receipt className="h-5 w-5" />, slug: "vendor-pos" },
  { label: "المشروعات", href: "/projects", icon: <FolderKanban className="h-5 w-5" />, slug: "projects" },
  { label: "العهد", href: "/custodies", icon: <ClipboardList className="h-5 w-5" />, slug: "custodies" },
  {
    label: "المصروفات",
    icon: <Banknote className="h-5 w-5" />,
    slug: "payments-group",
    subItems: [
      { label: "نظرة عامة", href: "/payments", icon: <LayoutList className="h-4 w-4" />, slug: "payments" },
      { label: "مدفوعات الموظفين", href: "/payments/employees", icon: <Users className="h-4 w-4" />, slug: "payments" },
      { label: "مدفوعات الموردين", href: "/payments/vendors", icon: <Truck className="h-4 w-4" />, slug: "payments" },
    ],
  },
  {
    label: "الإعدادات",
    icon: <Settings className="h-5 w-5" />,
    slug: "settings-group",
    subItems: [
      { label: "الموظفون", href: "/employees", icon: <UserCheck className="h-4 w-4" />, slug: "employees" },
      { label: "الموردون والمقاولون", href: "/vendors", icon: <Truck className="h-4 w-4" />, slug: "vendors" },
    ],
  },
]

function isAllowed(slug: string, allowedPages: string[] | "all"): boolean {
  if (allowedPages === "all") return true
  if (slug === "home") return true
  return allowedPages.includes(slug)
}

export function MobileNav({ allowedPages = "all" }: { allowedPages?: string[] | "all" }) {
  const pathname = usePathname()
  const [openCategory, setOpenCategory] = useState<string | null>(null)

  const visibleItems = MOBILE_NAV_ITEMS.filter(item => {
    if (item.subItems) return item.subItems.some(sub => isAllowed(sub.slug, allowedPages))
    return isAllowed(item.slug, allowedPages)
  })

  const activeCategoryObject = visibleItems.find(item => item.label === openCategory)

  return (
    <>
      {openCategory && activeCategoryObject?.subItems && (
        <div className="md:hidden fixed inset-0 z-40 flex items-end">
          <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={() => setOpenCategory(null)} />
          <div className="relative w-full bg-card rounded-t-2xl shadow-2xl pb-24 pt-6 px-6 animate-in slide-in-from-bottom-full border-t-4 border-primary">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-2 text-primary">
                {activeCategoryObject.icon}
                <h3 className="text-xl font-bold">{activeCategoryObject.label}</h3>
              </div>
              <button onClick={() => setOpenCategory(null)} className="p-2 bg-muted rounded-full hover:bg-muted/80 text-muted-foreground">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {activeCategoryObject.subItems
                .filter(sub => isAllowed(sub.slug, allowedPages))
                .map(sub => {
                  const isSubActive = pathname === sub.href || pathname.startsWith(sub.href + "/")
                  return (
                    // Use <Link> here so Next.js prefetches the route on visibility.
                    // This means tapping a sub-item navigates instantly instead of
                    // waiting for a fresh fetch to start at click time.
                    <Link key={sub.href} href={sub.href} onClick={() => setOpenCategory(null)}
                      className={cn(
                        "flex flex-col items-center justify-center gap-3 p-4 rounded-xl border transition-colors text-center",
                        isSubActive ? "bg-primary/10 border-primary text-primary" : "bg-muted/30 border-transparent hover:bg-muted text-card-foreground"
                      )}>
                      <div className={cn("p-3 rounded-full", isSubActive ? "bg-primary/20" : "bg-background")}>
                        {sub.icon}
                      </div>
                      <span className="text-sm font-medium">{sub.label}</span>
                    </Link>
                  )
                })}
            </div>
          </div>
        </div>
      )}

      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/90 backdrop-blur-lg flex items-center overflow-x-auto h-16 px-2 pb-safe gap-2 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {visibleItems.map(item => {
          const hasSubItems = !!item.subItems
          const isActive = hasSubItems
            ? item.subItems!.some(sub => pathname === sub.href || pathname.startsWith(sub.href + "/"))
            : pathname === item.href || (item.href ? pathname.startsWith(item.href + "/") : false)

          // For items WITH sub-items: keep as button (opens category sheet)
          // For simple navigation items: use <Link> so Next.js prefetches on render.
          // This eliminates the "tap and wait" feeling — the page is already loaded
          // in the background by the time the user taps the nav button.
          if (hasSubItems) {
            return (
              <button key={item.label}
                onClick={() => setOpenCategory(openCategory === item.label ? null : item.label)}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 min-w-[4.5rem] px-2 h-full transition-colors relative flex-shrink-0",
                  isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
                )}>
                {item.icon}
                <span className="text-[10px] font-medium text-center leading-tight">{item.label}</span>
                <ChevronUp className={cn("h-2.5 w-2.5 absolute top-1 right-1 transition-transform", openCategory === item.label ? "" : "rotate-180")} />
              </button>
            )
          }

          return (
            <Link key={item.label} href={item.href!}
              className={cn(
                "flex flex-col items-center justify-center gap-1 min-w-[4.5rem] px-2 h-full transition-colors relative flex-shrink-0",
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}>
              {item.icon}
              <span className="text-[10px] font-medium text-center leading-tight">{item.label}</span>
            </Link>
          )
        })}

        {/* Logout Button */}
        <div className="w-px h-8 bg-border flex-shrink-0 mx-1" />
        <form action={logout} className="flex-shrink-0 h-full">
          <button className="flex flex-col items-center justify-center gap-1 min-w-[4.5rem] px-2 h-full transition-colors text-destructive hover:text-destructive/80">
            <LogOut className="h-5 w-5" />
            <span className="text-[10px] font-medium text-center leading-tight">خروج</span>
          </button>
        </form>
      </nav>
    </>
  )
}
