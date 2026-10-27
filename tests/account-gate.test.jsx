import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode, Suspense, lazy } from 'react'
import { AccountGate, useAccount } from '../src/auth/Account'
import { useJournal } from '../src/journal/useJournal'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function JournalSessionProbe() {
  const journal = useJournal(), account = useAccount()
  return <><span>loaded-{journal.data.entries.length}</span><button onClick={() => account.accept({ user: account.user, csrfToken: 'csrf-a' })}>重新确认会话</button><button onClick={() => journal.reload().catch(() => {})}>刷新手帐</button><button onClick={() => journal.saveEntry(null, new FormData()).catch(() => {})}>保存照片</button></>
}

it('keeps journal reads and photo saves usable after the same account session is accepted again', async () => {
  const fetcher = vi.fn(async url => new Response(JSON.stringify(url.endsWith('/session') ? { user: { id: 'a', email: 'a@example.com' }, csrfToken: 'csrf-a' } : { entries: [{ id: 'saved-photo-entry' }] })))
  vi.stubGlobal('fetch', fetcher)
  render(<AccountGate>{() => <JournalSessionProbe />}</AccountGate>)
  await screen.findByText('loaded-1')
  fireEvent.click(screen.getByRole('button', { name: '重新确认会话' }))
  await screen.findByText('loaded-1')
  fetcher.mockClear()
  fireEvent.click(screen.getByRole('button', { name: '刷新手帐' }))
  expect(fetcher).toHaveBeenCalledWith('/api/journal', expect.anything())
  fireEvent.click(screen.getByRole('button', { name: '保存照片' }))
  expect(fetcher).toHaveBeenCalledWith('/api/journal/entries', expect.objectContaining({ method: 'POST', body: expect.any(FormData), headers: { 'X-CSRF-Token': 'csrf-a' } }))
})

it('loads existing photos when StrictMode replays effects around a lazy journal', async () => {
  const DeferredJournal = lazy(async () => { await new Promise(resolve => setTimeout(resolve, 15)); return { default: JournalSessionProbe } })
  vi.stubGlobal('fetch', vi.fn(async url => new Response(JSON.stringify(url.endsWith('/session') ? { user: { id: 'a', email: 'a@example.com' }, csrfToken: 'csrf-a' } : { entries: [{ id: 'saved-photo-entry' }] }))))
  render(<StrictMode><Suspense fallback={<span>loading journal</span>}><AccountGate>{() => <DeferredJournal />}</AccountGate></Suspense></StrictMode>)
  expect(await screen.findByText('loaded-1')).toBeInTheDocument()
})
it('keeps private content unmounted until login succeeds and removes it on session expiry', async () => {
  vi.stubGlobal('fetch', vi.fn(async url => new Response(JSON.stringify(url.endsWith('/session') ? {user:null,csrfToken:null} : {user:{id:'a',email:'a@example.com',email_verified:false},csrfToken:'a'}), {status:200})))
  render(<AccountGate>{user => <div>private-{user.id}</div>}</AccountGate>)
  expect(screen.queryByText('private-a')).not.toBeInTheDocument()
  fireEvent.change(await screen.findByLabelText('邮箱'), { target: { value: 'a@example.com' } })
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'long-password' } })
  fireEvent.click(screen.getByRole('button', { name: '登录' }))
  expect(await screen.findByText('private-a')).toBeInTheDocument()
  fireEvent(window, new Event('shitu-session-expired'))
  expect(await screen.findByRole('button', { name: '登录' })).toBeInTheDocument()
  expect(screen.queryByText('private-a')).not.toBeInTheDocument()
})
it('refreshes verification state before returning to an existing account', async () => {
  history.replaceState(null,'','#auth=verify&token=mail-token')
  let verified = false
  vi.stubGlobal('fetch',vi.fn(async url => { if(url.endsWith('/verify-email')) { verified=true; return new Response('{}') }; return new Response(JSON.stringify({user:{id:'a',email:'a@example.com',email_verified:verified},csrfToken:'a'})) }))
  render(<AccountGate>{user => <div>{user.email_verified ? 'verified account' : 'unverified account'}</div>}</AccountGate>)
  fireEvent.click(await screen.findByRole('button',{name:'验证邮箱'}))
  expect(await screen.findByText('verified account')).toBeInTheDocument()
  history.replaceState(null,'','/')
})
it('drops an existing account after password reset and returns to login', async () => {
  history.replaceState(null,'','#auth=reset&token=reset-token')
  vi.stubGlobal('fetch',vi.fn(async url => new Response(JSON.stringify(url.endsWith('/session') ? {user:{id:'a',email:'a@example.com'},csrfToken:'a'} : {}))))
  render(<AccountGate>{() => <div>private account</div>}</AccountGate>)
  fireEvent.change(await screen.findByLabelText('新密码'),{target:{value:'a-new-password'}})
  fireEvent.click(screen.getByRole('button',{name:'设置新密码'}))
  expect(await screen.findByRole('button',{name:'登录'})).toBeInTheDocument()
  expect(screen.queryByText('private account')).not.toBeInTheDocument()
  history.replaceState(null,'','/')
})
