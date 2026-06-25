"use client"
import * as React from "react"
import { cn } from "@/lib/utils"

export const DropdownMenu = ({ children }: { children: React.ReactNode }) => {
  return <div className="relative inline-block text-right dropdown-container group">{children}</div>
}

export const DropdownMenuTrigger = ({ children, asChild }: { children: React.ReactNode, asChild?: boolean }) => {
  return <div className="cursor-pointer">{children}</div>
}

export const DropdownMenuContent = ({ children, align = "end", className }: { children: React.ReactNode, align?: "start" | "end" | "center", className?: string }) => {
  const alignmentClass = align === "end" ? "right-0" : align === "center" ? "left-1/2 -translate-x-1/2" : "left-0"
  
  return (
    <div className={cn(
      "absolute mt-2 min-w-[8rem] rounded-md border bg-popover text-popover-foreground shadow-md z-50",
      "opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200",
      alignmentClass,
      className
    )}>
      {children}
    </div>
  )
}

export const DropdownMenuItem = ({ children, className, onClick }: { children: React.ReactNode, className?: string, onClick?: () => void }) => {
  return (
    <div 
      onClick={onClick}
      className={cn("relative flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground", className)}
    >
      {children}
    </div>
  )
}

export const DropdownMenuLabel = ({ children, className }: { children: React.ReactNode, className?: string }) => {
  return <div className={cn("px-2 py-1.5 text-sm font-semibold", className)}>{children}</div>
}

export const DropdownMenuSeparator = () => {
  return <div className="-mx-1 my-1 h-px bg-muted" />
}
