import { render } from '@testing-library/react'
import type { NextRouter } from 'next/router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AUTH_CHANGE_KIND, FLOWS } from '../core/constants'
import { useAuthChange, useAuthStatus } from '../react/hooks'
import {
  AnonymousRoute,
  AuthChangeRedirector,
  getNext,
  getSafeNext,
} from './routing'
import type { AuthResponse } from '../core/types'

const router = vi.hoisted(() => ({
  query: {} as Record<string, string | string[] | undefined>,
  asPath: '/',
  push: vi.fn(),
}))

vi.mock('next/router', () => ({ useRouter: () => router }))

vi.mock('../react/hooks', () => ({
  useAuthChange: vi.fn(),
  useAuthStatus: vi.fn(),
  useConfig: vi.fn(),
}))

const routerWithNext = (next?: string | string[]): NextRouter =>
  ({ query: next == null ? {} : { next } }) as unknown as NextRouter

const loginByCodePending: AuthResponse = {
  status: 401,
  data: { flows: [{ id: FLOWS.LOGIN_BY_CODE, is_pending: true }] },
}

const renderAfterAuthChange = (
  auth: AuthResponse | undefined,
  event: string,
  next?: string
) => {
  router.query = next == null ? {} : { next }
  vi.mocked(useAuthChange).mockReturnValue([auth, event])
  render(<AuthChangeRedirector>page</AuthChangeRedirector>)
}

beforeEach(() => {
  router.query = {}
  router.push.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getSafeNext', () => {
  it.each([
    ['/dashboard', '/dashboard'],
    ['/projects/1?tab=files#top', '/projects/1?tab=files#top'],
    [`${window.location.origin}/dashboard`, '/dashboard'],
  ])('keeps the same-origin path %s', (next, expected) => {
    expect(getSafeNext(routerWithNext(next))).toBe(expected)
  })

  it('uses the first value when next is repeated', () => {
    expect(getSafeNext(routerWithNext(['/dashboard', '/home']))).toBe(
      '/dashboard'
    )
  })

  it('returns null when there is no next', () => {
    expect(getSafeNext(routerWithNext())).toBeNull()
  })

  it.each([
    '',
    '//evil.com',
    '/\\evil.com',
    '\\\\evil.com',
    '/\t/evil.com',
    '/\n/evil.com',
    'https://evil.com',
    'javascript:alert(1)',
  ])('refuses %j, which a browser would not keep on this site', (next) => {
    expect(getSafeNext(routerWithNext(next))).toBeNull()
  })

  it.each([
    '/.//hacked-site.com',
    '/%2e//hacked-site.com',
    '/%2E//hacked-site.com',
    '/..//hacked-site.com',
    '/a/..//hacked-site.com',
    '/./\\hacked-site.com',
    '/.\\/hacked-site.com',
    '\\/hacked-site.com',
  ])(
    'refuses %j, whose dot segments resolve to a path starting with //',
    (next) => {
      expect(getSafeNext(routerWithNext(next))).toBeNull()
    }
  )

  it('refuses a URL of another protocol that keeps this origin', () => {
    expect(
      getSafeNext(routerWithNext(`blob:${window.location.origin}/1234`))
    ).toBeNull()
  })

  it('returns null when rendering on the server', () => {
    vi.stubGlobal('window', undefined)
    expect(getSafeNext(routerWithNext('/dashboard'))).toBeNull()
  })
})

describe('getNext', () => {
  it('returns a same-site next', () => {
    expect(getNext(routerWithNext('/dashboard'), '/home')).toBe('/dashboard')
  })

  it('falls back to the default for a next on another site', () => {
    expect(getNext(routerWithNext('//evil.com'), '/home')).toBe('/home')
  })
})

describe('AuthChangeRedirector', () => {
  it('keeps next when a login step moves to the next flow', () => {
    renderAfterAuthChange(
      loginByCodePending,
      AUTH_CHANGE_KIND.FLOW_UPDATED,
      '/dashboard'
    )
    expect(router.push).toHaveBeenCalledWith(
      '/account/login/code/confirm?next=%2Fdashboard'
    )
  })

  it('moves to the next flow without next when there is none', () => {
    renderAfterAuthChange(loginByCodePending, AUTH_CHANGE_KIND.FLOW_UPDATED)
    expect(router.push).toHaveBeenCalledWith('/account/login/code/confirm')
  })

  it('drops a next on another site when moving to the next flow', () => {
    renderAfterAuthChange(
      loginByCodePending,
      AUTH_CHANGE_KIND.FLOW_UPDATED,
      '//evil.com'
    )
    expect(router.push).toHaveBeenCalledWith('/account/login/code/confirm')
  })

  it('sends the user to next after logging in', () => {
    renderAfterAuthChange(undefined, AUTH_CHANGE_KIND.LOGGED_IN, '/dashboard')
    expect(router.push).toHaveBeenCalledWith('/dashboard')
  })

  it('sends the user to the default page when next is on another site', () => {
    renderAfterAuthChange(
      undefined,
      AUTH_CHANGE_KIND.LOGGED_IN,
      'https://evil.com'
    )
    expect(router.push).toHaveBeenCalledWith('/account/settings')
  })
})

describe('AnonymousRoute', () => {
  beforeEach(() => {
    vi.mocked(useAuthStatus).mockReturnValue({
      initialised: true,
      isLoading: false,
      isAuthenticated: true,
    })
  })

  it('sends a logged-in user to a same-site next', () => {
    router.query = { next: '/dashboard' }
    render(<AnonymousRoute>login page</AnonymousRoute>)
    expect(router.push).toHaveBeenCalledWith('/dashboard')
  })

  it('sends a logged-in user to the default page when next is on another site', () => {
    router.query = { next: '//evil.com' }
    render(<AnonymousRoute>login page</AnonymousRoute>)
    expect(router.push).toHaveBeenCalledWith('/account/settings')
  })
})
