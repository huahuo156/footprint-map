// 读取手机照片的拍摄日期与 GPS 坐标，添加照片时自动预填。
// 只解析 JPEG 的 EXIF：PNG / WebP 基本不带这些信息，直接跳过。
const SCAN_LIMIT = 512 * 1024
const EXIF_ASCII = new TextDecoder('windows-1252')
const TYPE_SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 }

function isJpeg(file) {
  return !!file && (file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name || ''))
}

export async function readPhotoExif(file) {
  if (!isJpeg(file)) return null
  try {
    const bytes = new Uint8Array(await file.slice(0, SCAN_LIMIT).arrayBuffer())
    return parseExif(bytes)
  } catch { return null }
}

function parseExif(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null
  let offset = 2
  while (offset + 2 <= view.byteLength) {
    if (view.getUint8(offset) !== 0xff) return null
    while (offset < view.byteLength && view.getUint8(offset) === 0xff) offset++
    if (offset >= view.byteLength) return null
    const marker = view.getUint8(offset++)
    // 独立标记没有长度字段；SOS 之后是图像数据，EXIF 一定在它之前。
    if (marker === 0x01 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (marker === 0xd9 || marker === 0xda) return null
    if (offset + 2 > view.byteLength) return null
    const length = view.getUint16(offset)
    if (length < 2 || offset + length > view.byteLength) return null
    if (marker === 0xe1 && length >= 8) {
      const start = offset + 2
      if (start + 6 <= view.byteLength
        && bytes[start] === 0x45 && bytes[start + 1] === 0x78 && bytes[start + 2] === 0x69
        && bytes[start + 3] === 0x66 && bytes[start + 4] === 0 && bytes[start + 5] === 0)
        return readTiff(new DataView(bytes.buffer, bytes.byteOffset, offset + length), bytes, start + 6)
    }
    offset += length
  }
  return null
}

function readTiff(view, bytes, base) {
  if (base + 8 > view.byteLength) return null
  const little = view.getUint16(base) === 0x4949
  if (!little && view.getUint16(base) !== 0x4d4d) return null
  const u16 = at => view.getUint16(at, little)
  const u32 = at => view.getUint32(at, little)
  if (u16(base + 2) !== 42) return null
  // IFD 内的偏移量都相对于 TIFF 头。
  const ifd = tiffOffset => {
    const start = base + tiffOffset
    if (start + 2 > view.byteLength) return null
    const count = u16(start)
    if (start + 2 + count * 12 > view.byteLength) return null
    const tags = new Map()
    for (let i = 0; i < count; i++) {
      const entry = start + 2 + i * 12
      tags.set(u16(entry), entry)
    }
    return tags
  }
  const value = (entry, expectedType) => {
    if (entry == null) return null
    const type = u16(entry + 2), count = u32(entry + 4)
    if (type !== expectedType) return null
    const unit = TYPE_SIZES[type]
    const total = unit * count
    const start = total <= 4 ? entry + 8 : base + u32(entry + 8)
    if (start + total > view.byteLength) return null
    if (type === 2) return EXIF_ASCII.decode(bytes.subarray(start, start + count))
    const numbers = []
    for (let i = 0; i < count; i++) {
      const at = start + i * unit
      if (type === 3) numbers.push(u16(at))
      else if (type === 5 || type === 10) { const denominator = u32(at + 4); numbers.push(denominator ? u32(at) / denominator : NaN) }
      else numbers.push(u32(at))
    }
    return numbers
  }
  const root = ifd(u32(base + 4))
  if (!root) return null
  const result = { date: null, lat: null, lng: null }
  const exifTags = root.has(0x8769) ? ifd(u32(root.get(0x8769) + 8)) : null
  result.date = parseExifDate(value(exifTags?.get(0x9003), 2))
    || parseExifDate(value(exifTags?.get(0x9004), 2))
    || parseExifDate(value(root.get(0x0132), 2))
  const gpsTags = root.has(0x8825) ? ifd(u32(root.get(0x8825) + 8)) : null
  if (gpsTags) {
    const lat = toDegrees(value(gpsTags.get(0x0002), 5)), lng = toDegrees(value(gpsTags.get(0x0004), 5))
    const latRef = value(gpsTags.get(0x0001), 2), lngRef = value(gpsTags.get(0x0003), 2)
    if (lat != null && lng != null && /^[NS]\0?$/i.test(latRef || '') && /^[EW]\0?$/i.test(lngRef || '')) {
      result.lat = /^[sS]/.test(latRef || '') ? -lat : lat
      result.lng = /^[wW]/.test(lngRef || '') ? -lng : lng
      // (0, 0) 在几内亚湾，几乎都是没有真正定位的照片。
      if (Math.abs(result.lat) > 90 || Math.abs(result.lng) > 180 || (!result.lat && !result.lng)) { result.lat = null; result.lng = null }
    }
  }
  return result.date || result.lat != null ? result : null
}

function parseExifDate(text) {
  const match = typeof text === 'string' && text.match(/^(\d{4})[:-](\d{2})[:-](\d{2})[ T]\d{2}:\d{2}/)
  if (!match) return null
  const [, year, month, day] = match
  if (Number(year) < 1900 || Number(month) < 1 || Number(month) > 12 || Number(day) < 1 || Number(day) > 31) return null
  const date = `${year}-${month}-${day}`
  const parsed = new Date(date + 'T12:00:00Z')
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date ? date : null
}

function toDegrees(raw) {
  if (!Array.isArray(raw) || raw.length !== 3 || raw.some(part => !Number.isFinite(part) || part < 0) || raw[1] >= 60 || raw[2] >= 60) return null
  const degrees = raw[0] + raw[1] / 60 + raw[2] / 3600
  return Number.isFinite(degrees) ? Math.round(degrees * 1e6) / 1e6 : null
}

export function haversineKm(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180, dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(a))
}

// 用景点资料做离线「逆地理解析」：坐标落在景点附近时直接带上地名。
export function matchLandmark(lat, lng, landmarks, maxKm = 10) {
  let best = null, bestDistance = maxKm
  for (const landmark of landmarks || []) {
    if (landmark.lat == null || landmark.lng == null) continue
    const distance = haversineKm(lat, lng, landmark.lat, landmark.lng)
    if (distance < bestDistance) { best = landmark; bestDistance = distance }
  }
  return best
}

// 把 EXIF 结果转成手帐组件；已存在的组件由调用方过滤，不会覆盖。
export function exifComponents(exif, landmarks = []) {
  const result = []
  if (exif?.date) result.push({ type: 'date', value: exif.date })
  if (exif?.lat != null && exif?.lng != null) {
    const landmark = matchLandmark(exif.lat, exif.lng, landmarks)
    result.push({ type: 'place', value: { name: landmark?.name || '', landmark_id: landmark?.id ?? null, lat: exif.lat, lng: exif.lng, spot_key: '' } })
  }
  return result
}
