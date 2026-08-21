import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = fileURLToPath(new URL('../..', import.meta.url))
const readSource = (path: string) => readFileSync(`${root}/${path}`, 'utf8')

describe('PWA security policy', () => {
  it('keeps protected application traffic out of runtime caches', () => {
    const worker = readSource('app/sw.ts')

    expect(worker).toContain('runtimeCaching: []')
    expect(worker).not.toContain('defaultCache')
    expect(worker).not.toContain('NetworkFirst')
    expect(worker).not.toContain('StaleWhileRevalidate')
    expect(worker).not.toContain('cacheName: "apis"')
    expect(worker).not.toContain('cacheName: "pages"')
  })

  it('clears legacy caches while retaining only the current precache', () => {
    const worker = readSource('app/sw.ts')

    expect(worker).toContain('self.addEventListener("activate"')
    expect(worker).toContain('caches.keys()')
    expect(worker).toContain('!cacheName.startsWith("serwist-precache")')
    expect(worker).toContain('caches.delete(cacheName)')
  })

  it('preserves push notification and notification-click handlers', () => {
    const worker = readSource('app/sw.ts')

    expect(worker).toContain('self.addEventListener("push"')
    expect(worker).toContain('showNotification')
    expect(worker).toContain('self.addEventListener("notificationclick"')
    expect(worker).toContain('openWindow(targetUrl)')
  })

  it('uses the maintained worker at the existing URL and scope', () => {
    const config = readSource('next.config.ts')
    const packageJson = JSON.parse(readSource('package.json')) as {
      dependencies: Record<string, string>
    }

    expect(config).toContain('swSrc: "app/sw.ts"')
    expect(config).toContain('swDest: "public/sw.js"')
    expect(config).toContain('disable: process.env.NODE_ENV !== "production"')
    expect(packageJson.dependencies['@serwist/next']).toBe('9.5.12')
    expect(packageJson.dependencies['@ducanh2912/next-pwa']).toBeUndefined()
  })
})
