import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { AuthProvider, useAuth } from '../../src/components/Auth/AuthProvider'

// Mock supabase
vi.mock('../../src/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      signUp: vi.fn(),
      signInWithPassword: vi.fn(),
      signInWithOtp: vi.fn(),
      signInWithOAuth: vi.fn(),
      signOut: vi.fn(),
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(),
        })),
      })),
    })),
  },
}))

import { supabase } from '../../src/lib/supabase'

// Test component to access auth context
function TestComponent() {
  const { user, profile, loading, signIn, signOut } = useAuth()
  return (
    <div>
      <div data-testid="loading">{loading ? 'loading' : 'loaded'}</div>
      <div data-testid="user">{user ? user.email : 'no-user'}</div>
      <div data-testid="profile">{profile ? profile.nickname : 'no-profile'}</div>
      <button onClick={() => signIn('test@test.com', 'password')}>Sign In</button>
      <button onClick={signOut}>Sign Out</button>
    </div>
  )
}

describe('AuthProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should show loading initially', () => {
    supabase.auth.getSession.mockResolvedValue({
      data: { session: null },
    })
    supabase.auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    })

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    )

    expect(screen.getByTestId('loading')).toHaveTextContent('loading')
  })

  it('should set user when session exists', async () => {
    const mockUser = { id: '123', email: 'test@test.com' }
    supabase.auth.getSession.mockResolvedValue({
      data: { session: { user: mockUser } },
    })
    supabase.auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    })

    // Mock the from().select().eq().single() chain
    const mockSingle = vi.fn().mockResolvedValue({ data: { nickname: 'Test User' } })
    const mockEq = vi.fn(() => ({ single: mockSingle }))
    const mockSelect = vi.fn(() => ({ eq: mockEq }))
    supabase.from.mockReturnValue({ select: mockSelect })

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('user')).toHaveTextContent('test@test.com')
    })
  })

  it('should handle sign in', async () => {
    const mockUser = { id: '123', email: 'test@test.com' }
    supabase.auth.getSession.mockResolvedValue({
      data: { session: null },
    })
    supabase.auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    })
    supabase.auth.signInWithPassword.mockResolvedValue({
      data: { user: mockUser },
      error: null,
    })

    render(
      <AuthProvider>
        <TestComponent />
      </AuthProvider>
    )

    await waitFor(() => {
      expect(screen.getByTestId('loading')).toHaveTextContent('loaded')
    })
  })

  it('should throw error when useAuth is used outside AuthProvider', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(() => {
      render(<TestComponent />)
    }).toThrow('useAuth must be used within AuthProvider')

    consoleSpy.mockRestore()
  })
})
