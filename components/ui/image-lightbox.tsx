"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { ZoomIn, ZoomOut, X, RotateCcw, ImageIcon } from "lucide-react"

interface ImageLightboxProps {
  src: string
  alt?: string
}

export function ImageLightbox({ src, alt = "مرفق" }: ImageLightboxProps) {
  const [open, setOpen] = React.useState(false)
  const [scale, setScale] = React.useState(1)
  const [mounted, setMounted] = React.useState(false)
  const [imgError, setImgError] = React.useState(false)

  // touch / pinch state
  const lastDist = React.useRef<number | null>(null)

  React.useEffect(() => { setMounted(true) }, [])

  // close on Escape
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") handleClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open])

  // lock body scroll when open
  React.useEffect(() => {
    document.body.style.overflow = open ? "hidden" : ""
    return () => { document.body.style.overflow = "" }
  }, [open])

  function handleOpen() { setOpen(true); setScale(1); setImgError(false) }
  function handleClose() { setOpen(false); setScale(1) }
  function zoomIn() { setScale(s => Math.min(s + 0.4, 5)) }
  function zoomOut() { setScale(s => Math.max(s - 0.4, 0.3)) }
  function resetZoom() { setScale(1) }

  // scroll wheel zoom
  function onWheel(e: React.WheelEvent) {
    e.preventDefault()
    if (e.deltaY < 0) zoomIn()
    else zoomOut()
  }

  // pinch-to-zoom on touch
  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      lastDist.current = Math.hypot(dx, dy)
    }
  }
  function onTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2 && lastDist.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.hypot(dx, dy)
      lastDist.current = dist
      setScale(s => Math.min(Math.max(s + (dist - lastDist.current!) * 0.01, 0.3), 5))
    }
  }
  function onTouchEnd() { lastDist.current = null }

  const lightbox = open && mounted
    ? createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="عرض الصورة"
          className="fixed inset-0 z-[9999] flex flex-col"
          style={{ backgroundColor: "rgba(0,0,0,0.93)" }}
        >
          {/* Top bar */}
          <div
            className="flex items-center justify-between px-4 py-3 shrink-0"
            style={{ background: "rgba(0,0,0,0.5)" }}
          >
            <span className="text-white/60 text-sm truncate max-w-[50%] select-none">{alt}</span>

            <div className="flex items-center gap-1">
              {/* Zoom % */}
              <span className="text-white/40 text-xs tabular-nums w-11 text-center select-none">
                {Math.round(scale * 100)}%
              </span>
              {/* Zoom out */}
              <button
                onClick={zoomOut}
                disabled={scale <= 0.3}
                className="h-9 w-9 rounded-full flex items-center justify-center text-white hover:bg-white/15 disabled:opacity-30 transition-colors"
                title="تصغير"
              >
                <ZoomOut className="h-4 w-4" />
              </button>
              {/* Reset */}
              <button
                onClick={resetZoom}
                className="h-9 w-9 rounded-full flex items-center justify-center text-white hover:bg-white/15 transition-colors"
                title="إعادة تعيين"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              {/* Zoom in */}
              <button
                onClick={zoomIn}
                disabled={scale >= 5}
                className="h-9 w-9 rounded-full flex items-center justify-center text-white hover:bg-white/15 disabled:opacity-30 transition-colors"
                title="تكبير"
              >
                <ZoomIn className="h-4 w-4" />
              </button>
              <div className="w-px h-5 bg-white/20 mx-1" />
              {/* Close */}
              <button
                onClick={handleClose}
                className="h-9 w-9 rounded-full flex items-center justify-center text-white hover:bg-white/15 transition-colors"
                title="إغلاق (Esc)"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Image area — click backdrop to close */}
          <div
            className="flex-1 flex items-center justify-center overflow-hidden cursor-zoom-out select-none"
            onClick={handleClose}
            onWheel={onWheel}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
          >
            {imgError ? (
              <div className="flex flex-col items-center gap-3 text-white/50">
                <ImageIcon className="h-12 w-12" />
                <p className="text-sm">تعذّر تحميل الصورة</p>
              </div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={alt}
                draggable={false}
                onError={() => setImgError(true)}
                onClick={(e) => e.stopPropagation()}
                className="max-w-full max-h-full object-contain rounded select-none cursor-default"
                style={{
                  transform: `scale(${scale})`,
                  transition: "transform 0.15s ease",
                  transformOrigin: "center center",
                }}
              />
            )}
          </div>

          {/* Bottom hint */}
          <p className="text-center py-2 shrink-0 text-white/25 text-xs select-none">
            عجلة الماوس أو قرصة الإصبعين للتكبير • انقر خارج الصورة للإغلاق
          </p>
        </div>,
        document.body
      )
    : null

  return (
    <>
      {/* Trigger — always visible icon button, no img thumbnail to fail */}
      <button
        type="button"
        onClick={handleOpen}
        title="عرض الصورة"
        className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors group mt-0.5"
      >
        <span className="h-7 w-7 rounded-md flex items-center justify-center bg-primary/10 border border-primary/25 group-hover:bg-primary/20 group-hover:border-primary/50 transition-colors shrink-0">
          <ImageIcon className="h-3.5 w-3.5 text-primary" />
        </span>
        <span className="text-xs text-muted-foreground group-hover:text-primary transition-colors">
          عرض الصورة
        </span>
      </button>

      {lightbox}
    </>
  )
}
