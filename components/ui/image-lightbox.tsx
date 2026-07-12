"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { ZoomIn, ZoomOut, X, RotateCcw, ImageIcon, ChevronLeft, ChevronRight, FileText, ExternalLink } from "lucide-react"

interface ImageLightboxOverlayProps {
  src: string
  alt?: string
  open: boolean
  onClose: () => void
}

/** The popup itself (zoom/pan/close), with no trigger UI — for callers that
 *  already have their own button/icon and just need to control when it shows. */
export function ImageLightboxOverlay({ src, alt = "مرفق", open, onClose }: ImageLightboxOverlayProps) {
  const [scale, setScale] = React.useState(1)
  const [pan, setPan] = React.useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = React.useState(false)
  const [mounted, setMounted] = React.useState(false)
  const [imgError, setImgError] = React.useState(false)

  // touch / pan state
  const lastDist = React.useRef<number | null>(null)
  const lastPan = React.useRef<{ x: number, y: number } | null>(null)

  React.useEffect(() => { setMounted(true) }, [])

  // reset zoom/pan/error whenever the popup is (re)opened
  React.useEffect(() => {
    if (open) { setScale(1); setPan({ x: 0, y: 0 }); setImgError(false) }
  }, [open])

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

  function handleClose() { setScale(1); setPan({ x: 0, y: 0 }); onClose() }
  function zoomIn() { setScale(s => Math.min(s + 0.4, 5)) }
  function zoomOut() { 
    setScale(s => {
      const newScale = Math.max(s - 0.4, 0.3)
      if (newScale <= 1) setPan({ x: 0, y: 0 })
      return newScale
    }) 
  }
  function resetZoom() { setScale(1); setPan({ x: 0, y: 0 }) }

  // scroll wheel zoom
  function onWheel(e: React.WheelEvent) {
    e.preventDefault()
    if (e.deltaY < 0) zoomIn()
    else zoomOut()
  }

  // --- Touch & Pinch Logic ---
  function onTouchStart(e: React.TouchEvent) {
    setIsDragging(true)
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      lastDist.current = Math.hypot(dx, dy)
      lastPan.current = null
    } else if (e.touches.length === 1) {
      lastPan.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    }
  }

  function onTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2 && lastDist.current !== null) {
      // pinch to zoom
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.hypot(dx, dy)
      
      const scaleDiff = (dist - lastDist.current) * 0.015 // slightly faster zoom
      lastDist.current = dist
      setScale(s => {
        const newScale = Math.min(Math.max(s + scaleDiff, 0.3), 5)
        if (newScale <= 1) setPan({ x: 0, y: 0 })
        return newScale
      })
    } else if (e.touches.length === 1 && lastPan.current !== null) {
      // pan with 1 finger (only if zoomed in)
      if (scale <= 1) return
      const dx = e.touches[0].clientX - lastPan.current.x
      const dy = e.touches[0].clientY - lastPan.current.y
      lastPan.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      setPan(p => ({ x: p.x + dx, y: p.y + dy }))
    }
  }

  function onTouchEnd() {
    setIsDragging(false)
    lastDist.current = null
    lastPan.current = null
  }

  // --- Mouse Pan Logic (Desktop) ---
  function onMouseDown(e: React.MouseEvent) {
    if (scale <= 1) return
    e.preventDefault()
    setIsDragging(true)
    lastPan.current = { x: e.clientX, y: e.clientY }
  }
  
  function onMouseMove(e: React.MouseEvent) {
    if (isDragging && lastPan.current && scale > 1) {
      const dx = e.clientX - lastPan.current.x
      const dy = e.clientY - lastPan.current.y
      lastPan.current = { x: e.clientX, y: e.clientY }
      setPan(p => ({ x: p.x + dx, y: p.y + dy }))
    }
  }

  function onMouseUp() {
    setIsDragging(false)
    lastPan.current = null
  }

  const lightbox = open && mounted
    ? createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label="عرض الصورة"
          className="fixed inset-0 z-[9999] flex flex-col"
          style={{ backgroundColor: "rgba(0,0,0,0.93)" }}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          {/* Top bar */}
          <div
            className="flex items-center justify-between px-4 py-3 shrink-0 z-10"
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
            className={`flex-1 flex items-center justify-center overflow-hidden select-none ${scale > 1 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-out'}`}
            onClick={(e) => {
              if (e.target === e.currentTarget) handleClose()
            }}
            onWheel={onWheel}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchEnd}
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
                onMouseDown={onMouseDown}
                className="max-w-full max-h-full object-contain rounded select-none pointer-events-auto"
                style={{
                  transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                  transition: isDragging ? "none" : "transform 0.15s ease",
                  transformOrigin: "center center",
                }}
              />
            )}
          </div>

          {/* Bottom hint */}
          <p className="text-center py-2 shrink-0 text-white/25 text-xs select-none z-10">
            عجلة الماوس أو قرصة الإصبعين للتكبير • اسحب للتحريك • انقر خارج الصورة للإغلاق
          </p>
        </div>,
        document.body
      )
    : null

  return lightbox
}

export interface GalleryItem {
  src: string
  name: string
  isImage: boolean
}

interface AttachmentGalleryOverlayProps {
  items: GalleryItem[]
  index: number
  onIndexChange: (index: number) => void
  open: boolean
  onClose: () => void
}

/** Multi-attachment viewer — opens straight to the content (no intermediate file
 *  list). Images get zoom/pan; non-image files show a "open in new tab" panel.
 *  Prev/next arrows, a position counter, and a filename label appear only when
 *  there's more than one item — a single attachment gets a clean, uncluttered view. */
export function AttachmentGalleryOverlay({ items, index, onIndexChange, open, onClose }: AttachmentGalleryOverlayProps) {
  const [scale, setScale] = React.useState(1)
  const [pan, setPan] = React.useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = React.useState(false)
  const [mounted, setMounted] = React.useState(false)
  const [imgError, setImgError] = React.useState(false)

  const lastDist = React.useRef<number | null>(null)
  const lastPan = React.useRef<{ x: number, y: number } | null>(null)

  const current = items[index]
  const hasMultiple = items.length > 1

  React.useEffect(() => { setMounted(true) }, [])

  // reset zoom/pan/error whenever the popup opens or the current item changes
  React.useEffect(() => {
    if (open) { setScale(1); setPan({ x: 0, y: 0 }); setImgError(false) }
  }, [open, index])

  function goNext() { if (index < items.length - 1) onIndexChange(index + 1) }
  function goPrev() { if (index > 0) onIndexChange(index - 1) }

  // close on Escape, navigate with arrow keys
  React.useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose()
      else if (e.key === "ArrowRight") goNext()
      else if (e.key === "ArrowLeft") goPrev()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, index, items.length])

  // lock body scroll when open
  React.useEffect(() => {
    document.body.style.overflow = open ? "hidden" : ""
    return () => { document.body.style.overflow = "" }
  }, [open])

  function handleClose() { setScale(1); setPan({ x: 0, y: 0 }); onClose() }
  function zoomIn() { setScale(s => Math.min(s + 0.4, 5)) }
  function zoomOut() {
    setScale(s => {
      const newScale = Math.max(s - 0.4, 0.3)
      if (newScale <= 1) setPan({ x: 0, y: 0 })
      return newScale
    })
  }
  function resetZoom() { setScale(1); setPan({ x: 0, y: 0 }) }

  function onWheel(e: React.WheelEvent) {
    if (!current?.isImage) return
    e.preventDefault()
    if (e.deltaY < 0) zoomIn()
    else zoomOut()
  }

  function onTouchStart(e: React.TouchEvent) {
    setIsDragging(true)
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      lastDist.current = Math.hypot(dx, dy)
      lastPan.current = null
    } else if (e.touches.length === 1) {
      lastPan.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    }
  }

  function onTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2 && lastDist.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.hypot(dx, dy)
      const scaleDiff = (dist - lastDist.current) * 0.015
      lastDist.current = dist
      setScale(s => {
        const newScale = Math.min(Math.max(s + scaleDiff, 0.3), 5)
        if (newScale <= 1) setPan({ x: 0, y: 0 })
        return newScale
      })
    } else if (e.touches.length === 1 && lastPan.current !== null) {
      if (scale <= 1) return
      const dx = e.touches[0].clientX - lastPan.current.x
      const dy = e.touches[0].clientY - lastPan.current.y
      lastPan.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
      setPan(p => ({ x: p.x + dx, y: p.y + dy }))
    }
  }

  function onTouchEnd() {
    setIsDragging(false)
    lastDist.current = null
    lastPan.current = null
  }

  function onMouseDown(e: React.MouseEvent) {
    if (scale <= 1) return
    e.preventDefault()
    setIsDragging(true)
    lastPan.current = { x: e.clientX, y: e.clientY }
  }

  function onMouseMove(e: React.MouseEvent) {
    if (isDragging && lastPan.current && scale > 1) {
      const dx = e.clientX - lastPan.current.x
      const dy = e.clientY - lastPan.current.y
      lastPan.current = { x: e.clientX, y: e.clientY }
      setPan(p => ({ x: p.x + dx, y: p.y + dy }))
    }
  }

  function onMouseUp() {
    setIsDragging(false)
    lastPan.current = null
  }

  if (!open || !mounted || !current) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="عرض المرفق"
      className="fixed inset-0 z-[9999] flex flex-col"
      style={{ backgroundColor: "rgba(0,0,0,0.93)" }}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0 z-10 gap-3" style={{ background: "rgba(0,0,0,0.5)" }}>
        <div className="flex items-center gap-2 min-w-0">
          {hasMultiple && (
            <span className="text-white/50 text-xs tabular-nums shrink-0 bg-white/10 rounded-full px-2 py-1">
              {index + 1} / {items.length}
            </span>
          )}
          {hasMultiple && (
            <span className="text-white/60 text-sm truncate select-none" dir="ltr">{current.name}</span>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {current.isImage && (
            <>
              <span className="text-white/40 text-xs tabular-nums w-11 text-center select-none">
                {Math.round(scale * 100)}%
              </span>
              <button onClick={zoomOut} disabled={scale <= 0.3} className="h-9 w-9 rounded-full flex items-center justify-center text-white hover:bg-white/15 disabled:opacity-30 transition-colors" title="تصغير">
                <ZoomOut className="h-4 w-4" />
              </button>
              <button onClick={resetZoom} className="h-9 w-9 rounded-full flex items-center justify-center text-white hover:bg-white/15 transition-colors" title="إعادة تعيين">
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
              <button onClick={zoomIn} disabled={scale >= 5} className="h-9 w-9 rounded-full flex items-center justify-center text-white hover:bg-white/15 disabled:opacity-30 transition-colors" title="تكبير">
                <ZoomIn className="h-4 w-4" />
              </button>
              <div className="w-px h-5 bg-white/20 mx-1" />
            </>
          )}
          <button onClick={handleClose} className="h-9 w-9 rounded-full flex items-center justify-center text-white hover:bg-white/15 transition-colors" title="إغلاق (Esc)">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Content area */}
      <div
        className={`relative flex-1 flex items-center justify-center overflow-hidden select-none ${current.isImage ? (scale > 1 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-zoom-out') : ''}`}
        onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
        onWheel={onWheel}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {/* Prev arrow */}
        {hasMultiple && index > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); goPrev() }}
            className="absolute right-3 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full flex items-center justify-center text-white bg-white/10 hover:bg-white/20 transition-colors z-10"
            title="السابق"
          >
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
        {/* Next arrow */}
        {hasMultiple && index < items.length - 1 && (
          <button
            onClick={(e) => { e.stopPropagation(); goNext() }}
            className="absolute left-3 top-1/2 -translate-y-1/2 h-11 w-11 rounded-full flex items-center justify-center text-white bg-white/10 hover:bg-white/20 transition-colors z-10"
            title="التالي"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}

        {current.isImage ? (
          imgError ? (
            <div className="flex flex-col items-center gap-3 text-white/50">
              <ImageIcon className="h-12 w-12" />
              <p className="text-sm">تعذّر تحميل الصورة</p>
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={current.src}
              alt={current.name}
              draggable={false}
              onError={() => setImgError(true)}
              onMouseDown={onMouseDown}
              className="max-w-full max-h-full object-contain rounded select-none pointer-events-auto"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
                transition: isDragging ? "none" : "transform 0.15s ease",
                transformOrigin: "center center",
              }}
            />
          )
        ) : (
          <div className="flex flex-col items-center gap-4 text-white/70">
            <FileText className="h-16 w-16" />
            <p className="text-sm max-w-xs text-center truncate" dir="ltr">{current.name}</p>
            <a
              href={current.src}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm bg-white/10 hover:bg-white/20 px-4 py-2 rounded-full transition-colors"
            >
              <ExternalLink className="h-4 w-4" /> فتح في تبويب جديد
            </a>
          </div>
        )}
      </div>

      {/* Bottom hint */}
      {current.isImage && (
        <p className="text-center py-2 shrink-0 text-white/25 text-xs select-none z-10">
          عجلة الماوس أو قرصة الإصبعين للتكبير • اسحب للتحريك • انقر خارج الصورة للإغلاق
          {hasMultiple && ' • الأسهم للتنقل'}
        </p>
      )}
    </div>,
    document.body
  )
}

interface ImageLightboxProps {
  src: string
  alt?: string
  iconOnly?: boolean
}

/** Trigger button + popup combo — self-manages its own open state. */
export function ImageLightbox({ src, alt = "مرفق", iconOnly = false }: ImageLightboxProps) {
  const [open, setOpen] = React.useState(false)

  return (
    <>
      {/* Trigger — always visible icon button, no img thumbnail to fail */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="عرض الصورة"
        className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary/80 transition-colors group mt-0.5"
      >
        <span className="h-6 w-6 rounded-full flex items-center justify-center bg-primary/10 border border-primary/25 group-hover:bg-primary/20 group-hover:border-primary/50 transition-colors shrink-0">
          <ImageIcon className="h-3.5 w-3.5 text-primary" />
        </span>
        {!iconOnly && (
          <span className="text-xs text-muted-foreground group-hover:text-primary transition-colors">
            عرض الصورة
          </span>
        )}
      </button>

      <ImageLightboxOverlay src={src} alt={alt} open={open} onClose={() => setOpen(false)} />
    </>
  )
}
