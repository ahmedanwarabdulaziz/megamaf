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

    // ── Synchronous guard: uses a ref so it's immune to React's async state
    // batching. The flag is set immediately on first click (before any re-render)
    // and cleared after the operation completes, preventing any double-submit.
    const submittingRef = React.useRef(false)

    const handleClick = React.useCallback(
      async (e: React.MouseEvent<HTMLButtonElement>) => {
        // If already submitting, block immediately – no await needed
        if (submittingRef.current) {
          e.preventDefault()
          e.stopPropagation()
          return
        }

        // For submit buttons, engage the guard immediately and synchronously
        const isSubmit = props.type === "submit" || (!props.type && e.currentTarget.form !== null)
        if (isSubmit) {
          submittingRef.current = true
          // Visually disable the button right away (before React re-renders)
          e.currentTarget.setAttribute("data-submitting", "true")
          e.currentTarget.disabled = true
        }

        if (onClick) {
          try {
            const result = onClick(e) as any
            if (result instanceof Promise) {
              await result
            }
          } catch {
            // swallow – callers handle errors themselves
          } finally {
            // Re-enable only if still mounted (button wasn't removed from DOM)
            submittingRef.current = false
            if (document.body.contains(e.currentTarget)) {
              e.currentTarget.removeAttribute("data-submitting")
              e.currentTarget.disabled = disabled ?? false
            }
          }
        } else if (isSubmit) {
          // For form-action submits (no onClick), release the guard after a
          // generous timeout so the navigation/re-render can happen first.
          // If the page navigates away, the timeout is a no-op.
          setTimeout(() => {
            submittingRef.current = false
          }, 3000)
        }
      },
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [onClick, props.type, disabled]
    )

    const isDisabled = disabled || pending

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
