import { afterEach, expect, it, vi } from 'vitest'
import { clearApiSession, setApiSession, getApiSessionEpoch, subscribeApiSessionReset } from '../src/lib/api.js'
import { fetchPrivateMedia } from '../src/lib/privateMedia.js'

afterEach(() => { clearApiSession(); vi.useRealTimers(); vi.restoreAllMocks() })
const response = (bytes = new Uint8Array([1, 2]), options = {}) => new Response(bytes, { headers: { 'Content-Type': 'image/webp' }, ...options })
it('requests only the fixed thumbnail with private fetch policy', async () => {
  const fetcher = vi.fn(async () => response())
  const blob = await fetchPrivateMedia('/uploads/a.jpg', { fetcher })
  expect(blob.size).toBe(2)
  expect(fetcher).toHaveBeenCalledWith('/uploads/a.jpg?thumbnail=1', expect.objectContaining({ credentials: 'same-origin', cache: 'no-store', redirect: 'error' }))
})
it.each(['https://other.test/uploads/a.jpg', '//other/uploads/a.jpg', '/api/a', '/uploads/../a.jpg', '/uploads/a.jpg?full=1', '/uploads/a.svg', 'blob:test', '/uploads/a.jpg#x'])('rejects unsupported source %s before fetch', async src => {
  const fetcher = vi.fn()
  await expect(fetchPrivateMedia(src, { fetcher })).rejects.toThrow()
  expect(fetcher).not.toHaveBeenCalled()
})
it('accepts already normalized thumbnails', async () => {
  const fetcher = vi.fn(async () => response())
  await fetchPrivateMedia('/uploads/a.webp?thumbnail=1', { fetcher })
  expect(fetcher.mock.calls[0][0]).toBe('/uploads/a.webp?thumbnail=1')
})
it('exposes reset epochs and synchronous unsubscribeable notifications', () => {
  const initial = getApiSessionEpoch(), listener = vi.fn()
  const unsubscribe = subscribeApiSessionReset(listener)
  setApiSession({ csrfToken: 'test' })
  expect(getApiSessionEpoch()).toBe(initial + 1)
  expect(listener).toHaveBeenCalledOnce()
  unsubscribe(); clearApiSession()
  expect(listener).toHaveBeenCalledOnce()
})
it('rejects old response headers after a session reset', async () => {
  let finish
  const pending = fetchPrivateMedia('/uploads/a.jpg', { fetcher: () => new Promise(resolve => { finish = resolve }) })
  clearApiSession(); finish(response())
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
})
it('rejects body completion after a session reset even when transport ignores abort', async () => {
  let finish
  const reader = { read: vi.fn(() => new Promise(resolve => { finish = resolve })), cancel: vi.fn(async () => {}), releaseLock: vi.fn() }
  const pending = fetchPrivateMedia('/uploads/a.jpg', { fetcher: async () => ({ ok: true, headers: new Headers({ 'Content-Type': 'image/webp' }), body: { getReader: () => reader } }) })
  await vi.waitFor(() => expect(reader.read).toHaveBeenCalled())
  clearApiSession(); finish({ done: true })
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(reader.cancel).toHaveBeenCalled()
})
it('enforces streamed bytes even when Content-Length understates them', async () => {
  await expect(fetchPrivateMedia('/uploads/a.jpg', { maxBytes: 1, fetcher: async () => response() })).rejects.toMatchObject({ code: 'MEDIA_TOO_LARGE' })
})
it('rejects oversized declared bodies before reading', async () => {
  await expect(fetchPrivateMedia('/uploads/a.jpg', { maxBytes: 1, fetcher: async () => response(null, { headers: { 'Content-Type': 'image/webp', 'Content-Length': '3' } }) })).rejects.toMatchObject({ code: 'MEDIA_TOO_LARGE' })
})
it.each(['text/html', 'image/svg+xml', ''])('rejects MIME %s', async mime => {
  await expect(fetchPrivateMedia('/uploads/a.jpg', { fetcher: async () => response(null, { headers: { 'Content-Type': mime } }) })).rejects.toMatchObject({ code: 'MEDIA_TYPE' })
})
it('expires the session on 401 and emits the existing event', async () => {
  const expired = vi.fn(); window.addEventListener('shitu-session-expired', expired)
  const initial = getApiSessionEpoch()
  try {
    await expect(fetchPrivateMedia('/uploads/a.jpg', { fetcher: async () => response(null, { status: 401 }) })).rejects.toMatchObject({ status: 401 })
    expect(getApiSessionEpoch()).toBe(initial + 1); expect(expired).toHaveBeenCalledOnce()
  } finally { window.removeEventListener('shitu-session-expired', expired) }
})
it.each([404, 503])('preserves HTTP %s without retry or original image fallback', async status => {
  const fetcher = vi.fn(async () => response(null, { status }))
  await expect(fetchPrivateMedia('/uploads/a.jpg', { fetcher })).rejects.toMatchObject({ status })
  expect(fetcher).toHaveBeenCalledOnce()
})
it('cancels immediately for an already aborted consumer', async () => {
  const controller = new AbortController(); controller.abort()
  const fetcher = vi.fn()
  await expect(fetchPrivateMedia('/uploads/a.jpg', { signal: controller.signal, fetcher })).rejects.toMatchObject({ name: 'AbortError' })
  expect(fetcher).not.toHaveBeenCalled()
})
it('times out even when fetch ignores the abort signal', async () => {
  vi.useFakeTimers()
  const pending = fetchPrivateMedia('/uploads/a.jpg', { timeoutMs: 10, fetcher: () => new Promise(() => {}) })
  const assertion = expect(pending).rejects.toMatchObject({ name: 'TimeoutError' })
  await vi.advanceTimersByTimeAsync(10); await assertion
})
it('cancels an in-flight fetch promptly and removes its session subscription', async () => {
  const controller = new AbortController()
  let transportSignal
  const pending = fetchPrivateMedia('/uploads/a.jpg', { signal: controller.signal, fetcher: (_src, options) => { transportSignal = options.signal; return new Promise(() => {}) } })
  controller.abort()
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
  expect(transportSignal.aborted).toBe(true)
  const abort = vi.spyOn(AbortController.prototype, 'abort')
  clearApiSession()
  expect(abort).not.toHaveBeenCalled()
})
it('keeps reset delivery working if another subscriber throws', () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const detach = subscribeApiSessionReset(() => { throw new Error('consumer failed') })
  const listener = vi.fn(), unsubscribe = subscribeApiSessionReset(listener)
  try { clearApiSession(); expect(listener).toHaveBeenCalledOnce() } finally { detach(); unsubscribe() }
})
it('rejects an empty image body', async () => {
  await expect(fetchPrivateMedia('/uploads/a.jpg', { fetcher: async () => response(new Uint8Array()) })).rejects.toMatchObject({ code: 'MEDIA_BODY' })
})
