"use client"

import * as React from "react"
import { useRouter, usePathname, useSearchParams } from "next/navigation"
import { cn } from "@/lib/utils"

export interface ActionItem {
  id: string
  label: string
  icon?: React.ReactNode
  modalTrigger?: string // The name of the modal to open
  onClick?: () => void
  roles?: string[] // e.g. ['admin', 'member']
}

interface QuickActionsProps {
  children: React.ReactNode
  actions: ActionItem[]
  userRole?: string
  className?: string
}

export function QuickActions({ children, actions, userRole = "member", className }: QuickActionsProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [position, setPosition] = React.useState({ x: 0, y: 0 })
  const menuRef = React.useRef<HTMLDivElement>(null)
  
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const filteredActions = actions.filter(
    action => !action.roles || action.roles.includes(userRole)
  )

  // Handle outside click
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
    setIsOpen(true)
    setPosition({ x: e.clientX, y: e.clientY })
  }

  // Very basic long press for mobile
  const pressTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  
  const handleTouchStart = (e: React.TouchEvent) => {
    if (pressTimer.current) clearTimeout(pressTimer.current)
    const clientX = e.touches[0].clientX
    const clientY = e.touches[0].clientY
    
    pressTimer.current = setTimeout(() => {
      setIsOpen(true)
      setPosition({ x: clientX, y: clientY })
    }, 600) // Increased to 600ms to ensure it's a deliberate hold
  }
  
  const handleTouchEnd = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
  }

  const handleActionClick = (action: ActionItem) => {
    setIsOpen(false)
    if (action.onClick) {
      action.onClick()
    }
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

      {isOpen && filteredActions.length > 0 && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[160px] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md animate-in fade-in-80 zoom-in-95"
          style={{ 
            top: `${position.y}px`, 
            left: `${position.x}px`,
            // Prevent going off-screen
            transform: `translate(calc(min(0px, 100vw - 100% - ${position.x}px)), calc(min(0px, 100vh - 100% - ${position.y}px)))`
          }}
        >
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
