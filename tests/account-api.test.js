import { afterEach, expect, it, vi } from 'vitest'
import { fetchJournal, saveJournalLayout, setApiSession, clearApiSession } from '../src/lib/api'
afterEach(() => { clearApiSession(); vi.unstubAllGlobals() })
it('sends session cookies and CSRF for private writes', async () => {
  const fetcher = vi.fn(async () => new Response('{}', { status: 200 }))
  vi.stubGlobal('fetch', fetcher)
  setApiSession({ csrfToken: 'account-a' })
  await saveJournalLayout([])
  expect(fetcher.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin', headers: { 'X-CSRF-Token': 'account-a' } })
})
it('aborts private reads and ignores late responses after account changes', async () => {
  let resolve
  vi.stubGlobal('fetch', vi.fn(() => new Promise(done => { resolve = done })))
  const pending = fetchJournal()
  clearApiSession()
  resolve(new Response('{"entries":[{"id":"old-user"}]}', { status: 200 }))
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
})
it('clears the session and aborts other requests on 401', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"登录已过期"}', { status: 401 })))
  const expired = vi.fn()
  window.addEventListener('shitu-session-expired', expired)
  await expect(fetchJournal()).rejects.toMatchObject({ status: 401 })
  expect(expired).toHaveBeenCalledOnce()
  window.removeEventListener('shitu-session-expired', expired)
})
it('invalidates a captured workflow before it can issue follow-up work', async () => {
  const { captureApiSession } = await import('../src/lib/api')
  setApiSession({csrfToken:'a'})
  const guard = captureApiSession()
  clearApiSession()
  expect(guard).toThrow(expect.objectContaining({name:'AbortError'}))
})
it('keeps response body downloads cancellable until decoding completes', async () => {
  let finish
  let signal
  vi.stubGlobal('fetch', vi.fn(async (_url, options) => { signal = options.signal; return {status:200,ok:true,json:() => new Promise(resolve => {finish = resolve})} }))
  const pending = fetchJournal()
  await Promise.resolve(); await Promise.resolve()
  clearApiSession()
  expect(signal.aborted).toBe(true)
  finish({entries:[]})
  await expect(pending).rejects.toMatchObject({name:'AbortError'})
})
