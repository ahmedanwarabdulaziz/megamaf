import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: mocks.getUser,
    },
  })),
}))

import { proxy } from '@/proxy'

function request(path: string) {
  return new NextRequest(`https://megamaf.test${path}`)
}

function pathname(response: Response) {
  const location = response.headers.get('location')
  return location ? new URL(location).pathname : null
}

describe('global authentication proxy', () => {
  beforeEach(() => {
    mocks.getUser.mockReset()
  })

  it('redirects anonymous protected requests to login', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } })

    const response = await proxy(request('/banks'))

    expect(response.status).toBe(307)
    expect(pathname(response)).toBe('/login')
  })

  it('redirects an authenticated user away from the login page', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-1', user_metadata: {} } },
    })

    const response = await proxy(request('/login'))

    expect(response.status).toBe(307)
    expect(pathname(response)).toBe('/')
  })

  it('requires password change before other application pages', async () => {
    mocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          user_metadata: { must_change_password: true },
        },
      },
    })

    const response = await proxy(request('/expenses'))

    expect(response.status).toBe(307)
    expect(pathname(response)).toBe('/change-password')
  })

  it('allows a signed-in user to continue to a protected page', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-1', user_metadata: {} } },
    })

    const response = await proxy(request('/expenses'))

    expect(response.status).toBe(200)
    expect(pathname(response)).toBeNull()
  })

  it('lets backup-agent requests reach their token-protected handlers', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } })

    const response = await proxy(request('/api/backup-agent/pair'))

    expect(response.status).toBe(200)
    expect(pathname(response)).toBeNull()
  })
})
