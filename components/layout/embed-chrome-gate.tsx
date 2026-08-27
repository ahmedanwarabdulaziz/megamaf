"use client"

import { useSearchParams } from "next/navigation"

/**
 * Hides the app sidebar/header when a page is loaded with ?embed=1 — used to
 * show a real app page inside an iframe-based popup (e.g. the vendor
 * statement / claim details quick-view on the treasury payment screen)
 * without the surrounding nav chrome looking out of place in a small modal.
 */
export function EmbedChromeGate() {
  const searchParams = useSearchParams()
  if (searchParams.get("embed") !== "1") return null

  return (
    <style>{`
      .app-sidebar, .app-header { display: none !important; }
    `}</style>
  )
}
