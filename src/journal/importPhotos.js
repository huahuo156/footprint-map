import { captureApiSession, fetchLandmarks, saveJournalEntry } from '../lib/api'
import { exifComponents, readPhotoExif } from '../lib/exif'

export async function readPhotoDimensions(files) {
  const sizes = []
  // Decode one at a time: a large import must not retain hundreds of full-size bitmaps.
  for (const file of files) {
    if (!file.size || file.size > 10 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) { sizes.push(null); continue }
    let url
    try {
      url = URL.createObjectURL(file)
      const image = new Image(); image.src = url
      await image.decode()
      sizes.push({ width: image.naturalWidth, height: image.naturalHeight })
    } catch { sizes.push(null) }
    finally { if (url) URL.revokeObjectURL(url) }
  }
  return sizes
}

// A failed request saves none of its chunk. Remove only explicitly rejected files,
// then submit the valid remainder; a service/network failure keeps that remainder.
export async function importPhotoFiles(files, positions, onProgress, save = saveJournalEntry) {
  const guard = captureApiSession()
  const rejectedFiles = [], pending = []
  let importedCount = 0
  for (const [index, file] of files.entries()) {
    const reason = file.size > 10 * 1024 * 1024 ? '超过 10MB，请压缩后重新选择。'
      : !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ? '暂不支持此格式，请转换为 JPG、PNG 或 WebP。'
        : !file.size ? '文件为空，请重新选择。' : ''
    if (reason) rejectedFiles.push({ name: file.name, reason })
    else pending.push({ file, position: positions[index] })
  }
  let landmarks
  const progress = () => onProgress({ completed: importedCount + rejectedFiles.length, total: files.length })
  progress()
  try {
    while (pending.length) {
      const chunk = pending.slice(0, 20), body = new FormData()
      // Read only this upload batch: 500 photos must not allocate 500 EXIF buffers together.
      const unread = chunk.filter(item => item.components === undefined)
      const exifs = await Promise.all(unread.map(({ file }) => readPhotoExif(file).catch(() => null)))
      guard()
      if (exifs.some(exif => exif?.lat != null)) landmarks ??= await fetchLandmarks().catch(() => [])
      guard()
      unread.forEach((item, index) => { item.components = exifComponents(exifs[index], landmarks || []) })
      chunk.forEach(({ file }) => body.append('images', file))
      body.append('data', JSON.stringify({ components: [], photos: chunk.map(({ position, components }, index) => ({ upload_index: index, components, canvas_x: position.x, canvas_y: position.y })) }))
      try {
        await save(null, body)
        guard()
        pending.splice(0, chunk.length); importedCount += chunk.length
      } catch (error) {
        const rejected = error.status === 400 && error.code === 'INVALID_IMAGES' && Array.isArray(error.invalidFiles) ? error.invalidFiles : []
        const indices = new Set(rejected.filter(item => Number.isInteger(item.index) && item.index >= 0 && item.index < chunk.length).map(item => item.index))
        if (!indices.size) throw error
        for (const index of indices) rejectedFiles.push({ name: chunk[index].file.name, reason: rejected.find(item => item.index === index).reason || '照片未通过校验，请重新选择。' })
        for (const index of [...indices].sort((a, b) => b - a)) pending.splice(index, 1)
      }
      progress()
    }
  } catch (error) {
    throw Object.assign(error, { importedCount, rejectedFiles, remainingFiles: pending.map(item => item.file), retryable: !error.status || error.status >= 500 || [408, 429].includes(error.status) })
  }
  return { importedCount, rejectedFiles }
}
