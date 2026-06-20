"use client"

import * as React from "react"
import { Download } from "lucide-react"
import { Button } from "./button"

export function PWAInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = React.useState<any>(null)
  const [isInstallable, setIsInstallable] = React.useState(false)

  React.useEffect(() => {
    const handler = (e: Event) => {
      // Prevent the mini-infobar from appearing on mobile
      e.preventDefault()
      // Stash the event so it can be triggered later.
      setDeferredPrompt(e)
      setIsInstallable(true)
    }

    window.addEventListener("beforeinstallprompt", handler)

    return () => {
      window.removeEventListener("beforeinstallprompt", handler)
    }
  }, [])

  const handleInstallClick = async () => {
    if (!deferredPrompt) return

    // Show the install prompt
    deferredPrompt.prompt()

    // Wait for the user to respond to the prompt
    const { outcome } = await deferredPrompt.userChoice
    if (outcome === "accepted") {
      console.log("User accepted the install prompt")
    } else {
      console.log("User dismissed the install prompt")
    }

    // We've used the prompt, and can't use it again, throw it away
    setDeferredPrompt(null)
    setIsInstallable(false)
  }

  // Also listen for successful install
  React.useEffect(() => {
    const handler = () => {
      console.log("PWA was installed")
      setIsInstallable(false)
    }
    window.addEventListener("appinstalled", handler)
    return () => window.removeEventListener("appinstalled", handler)
  }, [])

  if (!isInstallable) return null

  return (
    <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 md:bottom-6 md:left-auto md:right-6 md:-translate-x-0">
      <Button 
        onClick={handleInstallClick} 
        variant="secondary" 
        className="shadow-lg rounded-full px-4 border border-border bg-background/90 backdrop-blur"
      >
        <Download className="mr-2 h-4 w-4" />
        تثبيت التطبيق
      </Button>
    </div>
  )
}
