"use client"

import * as React from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"

export interface ActionItem {
  id: string
  label: string
  icon?: React.ReactNode
  modalTrigger?: string
  onClick?: () => void
  roles?: string[]
}

interface QuickActionsProps {
  children: React.ReactNode
  actions?: ActionItem[]
  menuContent?: React.ReactNode
  userRole?: string
  className?: string
}

export function QuickActions({ children, actions = [], menuContent, userRole = "member", className }: QuickActionsProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [position, setPosition] = React.useState({ x: 0, y: 0 })
  const menuRef = React.useRef<HTMLDivElement>(null)
  
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const filteredActions = actions.filter(
    action => !action.roles || action.roles.includes(userRole)
  )

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside)
      document.addEventListener("touchstart", handleClickOutside)
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside)
      document.removeEventListener("touchstart", handleClickOutside)
    }
  }, [isOpen])

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsOpen(true)
    setPosition({ x: e.clientX, y: e.clientY })
  }

  const pressTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  
  const handleTouchStart = (e: React.TouchEvent) => {
    e.stopPropagation()
    if (pressTimer.current) clearTimeout(pressTimer.current)
    const clientX = e.touches[0].clientX
    const clientY = e.touches[0].clientY
    
    pressTimer.current = setTimeout(() => {
      setIsOpen(true)
      setPosition({ x: clientX, y: clientY })
    }, 600)
  }
  
  const handleTouchEnd = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
  }

  const handleActionClick = (action: ActionItem) => {
    setIsOpen(false)
    if (action.onClick) action.onClick()
    if (action.modalTrigger) {
      const params = new URLSearchParams(searchParams.toString())
      params.set("modal", action.modalTrigger)
      router.push(`${pathname}?${params.toString()}`, { scroll: false })
    }
  }

  return (
    <div
      className={cn("relative", className)}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchEnd}
    >
      {children}

      {isOpen && (filteredActions.length > 0 || menuContent) && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[160px] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-80 zoom-in-95"
          style={{ 
            top: `${position.y}px`, 
            left: `${position.x}px`,
            transform: `translate(calc(min(0px, 100vw - 100% - ${position.x}px)), calc(min(0px, 100vh - 100% - ${position.y}px)))`
          }}
          onClick={(e) => {
            // Close menu when an internal button/form is clicked
            if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('a')) {
              setIsOpen(false)
            }
          }}
        >
          {menuContent}
          {filteredActions.map(action => (
            <button
              key={action.id}
              onClick={() => handleActionClick(action)}
              className="relative flex w-full cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground"
            >
              {action.icon && <span className="mr-2">{action.icon}</span>}
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
