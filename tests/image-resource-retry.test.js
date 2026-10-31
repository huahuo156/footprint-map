import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRetryMedia } from '../src/journal/images/retryMedia.js'

afterEach(() => vi.useRealTimers())

describe('media retry adapter', () => {
  it.each([new TypeError('Failed to fetch'), Object.assign(new Error('unavailable'), { status: 503 })])('retries transient errors at 800 and 1600ms', async error => {
    vi.useFakeTimers()
    let attempts = 0
    const blob = new Blob(['image'])
    const fetchMedia = createRetryMedia(async () => { if (++attempts < 3) throw error; return blob })
    const pending = fetchMedia('/uploads/image.jpg')
    await vi.advanceTimersByTimeAsync(799)
    expect(attempts).toBe(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(attempts).toBe(2)
    await vi.advanceTimersByTimeAsync(1599)
    expect(attempts).toBe(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toBe(blob)
    expect(attempts).toBe(3)
  })

  it('stops after two retries and preserves the final failure', async () => {
    vi.useFakeTimers()
    let attempts = 0
    const error = new TypeError('offline')
    const pending = createRetryMedia(async () => { attempts++; throw error })('src')
    const rejected = expect(pending).rejects.toBe(error)
    await vi.runAllTimersAsync()
    await rejected
    expect(attempts).toBe(3)
  })

  it.each([
    new DOMException('cancelled', 'AbortError'),
    new DOMException('timeout', 'TimeoutError'),
    ...[400, 401, 404, 429, 500].map(status => Object.assign(new Error('http'), { status })),
    ...['MEDIA_SOURCE', 'MEDIA_TYPE', 'MEDIA_TOO_LARGE', 'MEDIA_BODY'].map(code => Object.assign(new Error('invalid media'), { code })),
  ])('does not retry permanent errors: %s', async error => {
    vi.useFakeTimers()
    let attempts = 0
    await expect(createRetryMedia(async () => { attempts++; throw error })('src')).rejects.toBe(error)
    expect(attempts).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels backoff promptly and clears its timer', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    let attempts = 0
    const pending = createRetryMedia(async () => { attempts++; throw new TypeError('offline') })('src', { signal: controller.signal })
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(1)
    controller.abort()
    await rejected
    expect(vi.getTimerCount()).toBe(0)
    await vi.runAllTimersAsync()
    expect(attempts).toBe(1)
  })

  it('forwards the signal and rejects a success arriving after cancellation', async () => {
    const controller = new AbortController()
    let resolveFetch, received
    const fetchMedia = createRetryMedia((src, options) => {
      received = { src, signal: options.signal }
      return new Promise(resolve => { resolveFetch = resolve })
    })
    const pending = fetchMedia('src', { signal: controller.signal })
    controller.abort()
    resolveFetch(new Blob(['image']))
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    expect(received).toEqual({ src: 'src', signal: controller.signal })
  })

  it('does not start a request with an already aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    let attempts = 0
    await expect(createRetryMedia(async () => { attempts++ })('src', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
    expect(attempts).toBe(0)
  })
})
