const aborted = () => new DOMException('图片解码已取消。', 'AbortError')

// Borrow the display URL when supplied; only revoke URLs this probe creates.
export async function decodeMedia(blob, { signal, objectUrl: displayUrl, createImage = () => new Image() } = {}) {
  if (signal?.aborted) throw aborted()
  let image, objectUrl, rejectCancellation, cleaned = false
  const cancellation = new Promise((_, reject) => { rejectCancellation = reject })
  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    signal?.removeEventListener('abort', cancel)
    if (image) image.src = ''
    image = null
    if (objectUrl && !displayUrl) URL.revokeObjectURL(objectUrl)
  }
  const cancel = () => { cleanup(); rejectCancellation(aborted()) }
  try {
    image = createImage()
    objectUrl = displayUrl || URL.createObjectURL(blob)
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) throw aborted()
    image.src = objectUrl
    await Promise.race([image.decode(), cancellation])
    if (signal?.aborted) throw aborted()
    const width = image.naturalWidth, height = image.naturalHeight
    if (![width, height].every(value => Number.isFinite(value) && value > 0 && value <= 512)) {
      throw Object.assign(new Error('缩略图尺寸不受支持。'), { code: 'MEDIA_DIMENSIONS' })
    }
    return { width, height }
  } finally {
    void cancellation.catch(() => {})
    cleanup()
  }
}
