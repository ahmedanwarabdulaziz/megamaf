"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { Home, Settings, FileText, Landmark, ChevronDown, ChevronUp, Truck, FolderKanban, UserCheck, ClipboardList, Receipt, Banknote, Users, LayoutList } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"

type NavSubItem = { label: string; href: string; icon: React.ReactNode; slug: string }
type NavItem =
  | { label: string; href: string; icon: React.ReactNode; slug: string; subItems?: undefined }
  | { label: string; icon: React.ReactNode; slug: string; href?: undefined; subItems: NavSubItem[] }

const NAV_ITEMS: NavItem[] = [
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
      { label: "الأرصدة الافتتاحية للمشروعات", href: "/settings/project-balances", icon: <FolderKanban className="h-4 w-4" />, slug: "settings" },
    ],
  },
]

function isAllowed(slug: string, allowedPages: string[] | "all"): boolean {
  if (allowedPages === "all") return true
  return allowedPages.includes(slug)
}

export function SidebarNav({ allowedPages = "all" }: { allowedPages?: string[] | "all" }) {
  const pathname = usePathname()
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(
    { "المالية": true, "المصروفات": true }
  )

  const toggleGroup = (label: string) => {
    setOpenGroups(prev => ({ ...prev, [label]: !prev[label] }))
  }

  return (
    <nav className="flex-1 space-y-1 p-2">
      {NAV_ITEMS.map((item) => {
        if (item.subItems) {
          const visibleSubItems = item.subItems.filter(sub => isAllowed(sub.slug, allowedPages))
          if (visibleSubItems.length === 0) return null
          const isOpen = openGroups[item.label]
          const isActive = visibleSubItems.some(sub => pathname === sub.href || pathname.startsWith(sub.href + "/"))
          return (
            <div key={item.label} className="space-y-1">
              <button onClick={() => toggleGroup(item.label)}
                className={cn(
                  "w-full flex items-center justify-between gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                  isActive && !isOpen ? "bg-accent text-accent-foreground" : "text-muted-foreground"
                )}>
                <div className="flex items-center gap-3">{item.icon}{item.label}</div>
                {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </button>
              {isOpen && (
                <div className="pr-6 space-y-1 mt-1 border-r-2 border-border mr-4">
                  {visibleSubItems.map(sub => {
                    const isSubActive = pathname === sub.href || pathname.startsWith(sub.href + "/")
                    return (
                      <Link key={sub.href} href={sub.href}
                        className={cn(
                          "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
                          isSubActive ? "bg-primary/10 text-primary" : "text-muted-foreground"
                        )}>
                        {sub.icon}{sub.label}
                      </Link>
                    )
                  })}
                </div>
              )}
            </div>
          )
        }
        if (!isAllowed(item.slug, allowedPages)) return null
        const isActive = pathname === item.href
        return (
          <Link key={item.href} href={item.href!}
            className={cn(
              "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground",
              isActive ? "bg-primary/10 text-primary" : "text-muted-foreground"
            )}>
            {item.icon}{item.label}
          </Link>
        )
      })}
    </nav>
  )
}
