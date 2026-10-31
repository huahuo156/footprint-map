import { captureApiSession, clearApiSession, subscribeApiSessionReset } from './api.js'

const mediaError = (message, code) => Object.assign(new Error(message), { code })
const aborted = () => new DOMException('图片请求已取消。', 'AbortError')

// Only the existing private, fixed-size thumbnail variant enters this transport.
export async function fetchPrivateMedia(src, {
  signal, fetcher = globalThis.fetch, maxBytes = 2 * 1024 * 1024, timeoutMs = 10000,
} = {}) {
  if (typeof src !== 'string' || !/^\/uploads\/[\w-]+\.(jpg|png|webp)(\?thumbnail=1)?$/.test(src)) throw mediaError('不支持的私有图片地址。', 'MEDIA_SOURCE')
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new TypeError('Invalid media limits')
  const source = src.split('?')[0] + '?thumbnail=1'
  const checkSession = captureApiSession(), controller = new AbortController()
  let reader, timer, stopped, rejectCancellation
  const cancellation = new Promise((_, reject) => { rejectCancellation = reject })
  const stop = reason => {
    if (stopped) return
    stopped = reason
    controller.abort()
    if (reader) void reader.cancel().catch(() => {})
    rejectCancellation(reason)
  }
  const cancel = () => stop(aborted())
  const unsubscribe = subscribeApiSessionReset(cancel)
  signal?.addEventListener('abort', cancel, { once: true })
  const check = () => { checkSession(); if (stopped) throw stopped }
  const wait = async promise => { const value = await Promise.race([promise, cancellation]); check(); return value }
  try {
    if (signal?.aborted) cancel()
    check()
    timer = setTimeout(() => stop(new DOMException('图片请求超时。', 'TimeoutError')), timeoutMs)
    const response = await wait(fetcher(source, { signal: controller.signal, credentials: 'same-origin', cache: 'no-store', redirect: 'error' }))
    if (response.status === 401) {
      clearApiSession()
      window.dispatchEvent(new Event('shitu-session-expired'))
      throw Object.assign(new Error('登录已过期，请重新登录。'), { status: 401 })
    }
    if (!response.ok) throw Object.assign(new Error('图片请求失败。'), { status: response.status })
    const mime = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase()
    if (!['image/webp', 'image/jpeg', 'image/png'].includes(mime)) throw mediaError('图片格式不受支持。', 'MEDIA_TYPE')
    if (Number(response.headers.get('Content-Length')) > maxBytes) throw mediaError('缩略图超过大小限制。', 'MEDIA_TOO_LARGE')
    if (!response.body) throw mediaError('图片响应为空。', 'MEDIA_BODY')
    reader = response.body.getReader()
    const chunks = []
    let total = 0
    while (true) {
      const { done, value } = await wait(reader.read())
      if (done) break
      total += value.byteLength
      if (total > maxBytes) throw mediaError('缩略图超过大小限制。', 'MEDIA_TOO_LARGE')
      chunks.push(value)
    }
    check()
    if (!total) throw mediaError('图片响应为空。', 'MEDIA_BODY')
    return new Blob(chunks, { type: mime })
  } catch (error) {
    controller.abort()
    if (reader) void reader.cancel().catch(() => {})
    throw error
  } finally {
    // Attach a handler even if cancellation happened before the first awaited step.
    void cancellation.catch(() => {})
    clearTimeout(timer)
    unsubscribe()
    signal?.removeEventListener('abort', cancel)
    try { reader?.releaseLock() } catch { /* A cancelled read may still be settling. */ }
  }
}
