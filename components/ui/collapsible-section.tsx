"use client"

import * as React from "react"
import { ChevronDown, ChevronUp } from "lucide-react"

interface Props {
  title: string
  icon?: React.ReactNode
  badges?: React.ReactNode
  defaultOpen?: boolean
  children: React.ReactNode
}

export function CollapsibleSection({ title, icon, badges, defaultOpen = false, children }: Props) {
  const [isOpen, setIsOpen] = React.useState(defaultOpen)

  return (
    <section className="flex flex-col gap-3">
      <div 
        className="flex items-center gap-2 border-b border-border pb-2 cursor-pointer select-none hover:bg-muted/30 p-1.5 -mx-1.5 rounded-lg transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        {icon}
        <h2 className="font-semibold text-sm">{title}</h2>
        {badges && <div className="mr-auto flex items-center gap-2">{badges}</div>}
        <button 
          className="text-muted-foreground hover:text-foreground transition-colors mr-2 p-1 rounded-full hover:bg-muted"
          onClick={(e) => {
            e.stopPropagation()
            setIsOpen(!isOpen)
          }}
        >
          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>
      
      {isOpen && (
        <div className="animate-in fade-in slide-in-from-top-2 duration-200">
          {children}
        </div>
      )}
    </section>
  )
}
