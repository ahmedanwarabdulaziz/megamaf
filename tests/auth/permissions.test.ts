import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock('@/lib/supabase/get-profile', () => ({
  getProfile: mocks.getProfile,
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
}))

import {
  canEditPage,
  requireAdmin,
  requirePageAccess,
} from '@/lib/require-page-access'

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: 'employee-1',
    is_active: true,
    is_super_admin: false,
    employee_page_access: [],
    ...overrides,
  }
}

function signedIn(currentProfile: Record<string, unknown> | null) {
  mocks.getProfile.mockResolvedValue({
    user: { id: 'user-1' },
    profile: currentProfile,
    supabase: {},
  })
}

describe('page permissions', () => {
  beforeEach(() => {
    mocks.getProfile.mockReset()
    mocks.redirect.mockReset()
    mocks.redirect.mockImplementation((path: string) => {
      throw new Error(`NEXT_REDIRECT:${path}`)
    })
  })

  it('redirects an unauthenticated user to login', async () => {
    mocks.getProfile.mockResolvedValue({
      user: null,
      profile: null,
      supabase: {},
    })

    await expect(requirePageAccess('banks')).rejects.toThrow(
      'NEXT_REDIRECT:/login',
    )
  })

  it('redirects an inactive employee to login', async () => {
    signedIn(profile({ is_active: false }))

    await expect(requirePageAccess('banks')).rejects.toThrow(
      'NEXT_REDIRECT:/login',
    )
  })

  it('allows a super admin to open every protected page', async () => {
    signedIn(profile({ is_super_admin: true }))

    await expect(requirePageAccess('banks')).resolves.toMatchObject({
      isSuperAdmin: true,
    })
  })

  it('allows an employee to open a granted page', async () => {
    signedIn(
      profile({
        employee_page_access: [{ page_slug: 'banks', access_level: 'view' }],
      }),
    )

    await expect(requirePageAccess('banks')).resolves.toMatchObject({
      isSuperAdmin: false,
    })
  })

  it('redirects an employee who lacks the page grant', async () => {
    signedIn(
      profile({
        employee_page_access: [{ page_slug: 'expenses', access_level: 'edit' }],
      }),
    )

    await expect(requirePageAccess('banks')).rejects.toThrow(
      'NEXT_REDIRECT:/?access_denied=1',
    )
  })

  it('allows editing only for super admins or edit-level grants', () => {
    expect(canEditPage(profile({ is_super_admin: true }), 'banks')).toBe(true)
    expect(
      canEditPage(
        profile({
          employee_page_access: [{ page_slug: 'banks', access_level: 'edit' }],
        }),
        'banks',
      ),
    ).toBe(true)
    expect(
      canEditPage(
        profile({
          employee_page_access: [{ page_slug: 'banks', access_level: 'view' }],
        }),
        'banks',
      ),
    ).toBe(false)
    expect(canEditPage(null, 'banks')).toBe(false)
  })

  it('redirects a non-admin dashboard visitor to the first granted page', async () => {
    signedIn(
      profile({
        employee_page_access: [{ page_slug: 'banks', access_level: 'view' }],
      }),
    )

    await expect(requireAdmin()).rejects.toThrow('NEXT_REDIRECT:/banks')
  })

  it('redirects an employee with no grants to login', async () => {
    signedIn(profile())

    await expect(requireAdmin()).rejects.toThrow('NEXT_REDIRECT:/login')
  })
})
