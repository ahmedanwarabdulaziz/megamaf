"use client"

import { useRef, useCallback } from "react"

/**
 * useFormGuard
 *
 * A hook that wraps async form-submit handlers to prevent double submissions.
 * It uses a ref (not state) so the guard engages SYNCHRONOUSLY on the first call,
 * before React has any chance to batch/delay a re-render.
 *
 * Usage with <form onSubmit={...}>:
 *   const { guardedSubmit, submitting } = useFormGuard(async (e) => { ... })
 *   <form onSubmit={guardedSubmit}>
 *     <Button type="submit" disabled={submitting}>Save</Button>
 *
 * Usage with <form action={...}> (Next.js server-action style):
 *   const { guardedAction, submitting } = useFormGuard(async (formData) => { ... })
 *   <form action={guardedAction}>
 *     <Button type="submit" disabled={submitting}>Save</Button>
 */

type SubmitHandler =
  | ((e: React.FormEvent<HTMLFormElement>) => Promise<void> | void)
  | ((formData: FormData) => Promise<void> | void)

export function useFormGuard<T extends SubmitHandler>(handler: T) {
  const submittingRef = useRef(false)
  const submittingStateRef = useRef(false) // tracks for consumers that care

  const guard = useCallback(
    async (arg: any) => {
      if (submittingRef.current) {
        // Already running – silently drop the duplicate submission
        if (arg && typeof arg.preventDefault === "function") {
          arg.preventDefault()
          arg.stopPropagation()
        }
        return
      }

      submittingRef.current = true
      submittingStateRef.current = true

      try {
        await (handler as any)(arg)
      } finally {
        submittingRef.current = false
        submittingStateRef.current = false
      }
    },
    [handler]
  ) as T

  return {
    /** Drop-in replacement for the original handler – guards against duplicates */
    guarded: guard,
    /** True while the handler is running (read from ref – no re-render overhead) */
    get submitting() {
      return submittingRef.current
    },
  }
}
