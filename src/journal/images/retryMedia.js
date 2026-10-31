const aborted = () => new DOMException('图片请求已取消。', 'AbortError')
const checkAbort = signal => { if (signal?.aborted) throw aborted() }

// HTTP failures carry status; media validation failures carry code. Fetch's
// network failures are TypeErrors, unlike cancellation and timeout DOMExceptions.
const retryable = error => error?.name !== 'AbortError' && (
  error?.status === 503 || (error?.status == null && !error?.code && error?.name === 'TypeError')
)

export function createRetryMedia(fetchMedia, { setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  const backoff = (delay, signal) => new Promise((resolve, reject) => {
    let timer
    const cleanup = () => {
      clearTimer(timer)
      signal?.removeEventListener('abort', cancel)
    }
    const cancel = () => { cleanup(); reject(aborted()) }
    if (signal?.aborted) { reject(aborted()); return }
    signal?.addEventListener('abort', cancel, { once: true })
    timer = setTimer(() => { cleanup(); resolve() }, delay)
  })

  return async (src, { signal } = {}) => {
    for (let attempt = 0; ; attempt++) {
      checkAbort(signal)
      try {
        const media = await fetchMedia(src, { signal })
        checkAbort(signal)
        return media
      } catch (error) {
        checkAbort(signal)
        if (attempt === 2 || !retryable(error)) throw error
        await backoff(800 * 2 ** attempt, signal)
      }
    }
  }
}
