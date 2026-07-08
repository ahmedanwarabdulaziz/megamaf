"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { useFormStatus } from "react-dom"

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "secondary" | "destructive" | "ghost" | "link" | "outline"
  size?: "default" | "sm" | "lg" | "icon"
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "default", size = "default", onClick, disabled, ...props }, ref) => {
    const { pending } = useFormStatus()
    const [isPending, setIsPending] = React.useState(false)

    const handleClick = React.useCallback(
      async (e: React.MouseEvent<HTMLButtonElement>) => {
        // Prevent physical double clicks within 1.5 seconds for submits, and 500ms for others
        const now = Date.now()
        const lastClick = Number(e.currentTarget.dataset.lastClick || "0")
        const delay = props.type === "submit" ? 1500 : 500
        if (now - lastClick < delay) {
          e.preventDefault()
          e.stopPropagation()
          return
        }
        e.currentTarget.dataset.lastClick = now.toString()

        if (onClick) {
          try {
            const result = onClick(e) as any
            if (result instanceof Promise) {
              setIsPending(true)
              await result
            }
          } finally {
            if (isPending) setIsPending(false)
          }
        }
      },
      [onClick, props.type, isPending]
    )

    const isDisabled = disabled || pending || isPending

    return (
      <button
        ref={ref}
        onClick={handleClick}
        disabled={isDisabled}
        className={cn(
          "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
          {
            "bg-primary text-primary-foreground hover:bg-primary/90":
              variant === "default",
            "bg-secondary text-secondary-foreground hover:bg-secondary/80":
              variant === "secondary",
            "bg-destructive text-destructive-foreground hover:bg-destructive/90":
              variant === "destructive",
            "hover:bg-accent hover:text-accent-foreground": variant === "ghost",
            "border border-input bg-background hover:bg-accent hover:text-accent-foreground":
              variant === "outline",
            "text-primary underline-offset-4 hover:underline":
              variant === "link",
            "h-10 px-4 py-2": size === "default",
            "h-9 rounded-md px-3": size === "sm",
            "h-11 rounded-md px-8": size === "lg",
            "h-10 w-10": size === "icon",
          },
          className
        )}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button }
