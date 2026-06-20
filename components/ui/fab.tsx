"use client"

import * as React from "react"
import { Plus } from "lucide-react"
import { cn } from "@/lib/utils"

import { useRouter, usePathname, useSearchParams } from "next/navigation"

export interface FABProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode
  modalTrigger?: string
}

const FAB = React.forwardRef<HTMLButtonElement, FABProps>(
  ({ className, icon, modalTrigger, onClick, ...props }, ref) => {
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      if (onClick) onClick(e)
      if (modalTrigger) {
        const params = new URLSearchParams(searchParams.toString())
        params.set("modal", modalTrigger)
        router.push(`${pathname}?${params.toString()}`, { scroll: false })
      }
    }

    return (
      <button
        ref={ref}
        onClick={handleClick}
        className={cn(
          "fixed bottom-20 right-6 md:hidden z-50 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-lg transition-transform hover:scale-105 active:scale-95 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
          className
        )}
        {...props}
      >
        {icon || <Plus className="h-6 w-6" />}
      </button>
    )
  }
)
FAB.displayName = "FAB"

export { FAB }
