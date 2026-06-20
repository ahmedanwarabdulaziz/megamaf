"use client"

import * as React from "react"
import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

interface ModalProps {
  name: string
  title: string
  description?: string
  children: React.ReactNode
}

export function Modal({ name, title, description, children }: ModalProps) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  const isOpen = searchParams.get("modal") === name

  const closeModal = React.useCallback(() => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete("modal")
    router.push(`${pathname}?${params.toString()}`, { scroll: false })
  }, [pathname, router, searchParams])

  // Handle ESC key
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        closeModal()
      }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, closeModal])

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center pb-16 sm:pb-0">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-background/80 backdrop-blur-sm transition-opacity"
        onClick={closeModal}
      />

      {/* Modal Content */}
      <div className={cn(
        "relative z-[60] w-full bg-card shadow-2xl sm:rounded-xl sm:border-2 sm:border-primary sm:max-w-lg transition-transform flex flex-col",
        "animate-in slide-in-from-bottom-full sm:slide-in-from-bottom-0 sm:zoom-in-95",
        "rounded-t-2xl border-t-4 border-primary sm:border-t-2",
        "max-h-[calc(100dvh-5rem)] sm:max-h-[90vh]"
      )}>
        <div className="flex items-center justify-between bg-primary text-primary-foreground p-4 sm:px-6 shrink-0">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            {description && (
              <p className="text-sm text-primary-foreground/80 mt-1">{description}</p>
            )}
          </div>
          <button
            onClick={closeModal}
            className="rounded-full p-2 hover:bg-primary-foreground/20 transition-colors text-primary-foreground"
          >
            <X className="h-5 w-5" />
            <span className="sr-only">Close</span>
          </button>
        </div>

        <div className="p-4 sm:p-6 bg-card text-card-foreground overflow-y-auto flex-1">
          {children}
        </div>
      </div>
    </div>
  )
}
