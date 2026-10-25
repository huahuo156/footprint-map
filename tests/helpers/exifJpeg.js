export function buildExifJpeg({ date = '2024:05:01 10:20:00', latitude = [30, 1, 15, 1, 5000, 100], latRef = 'N', longitude = [120, 1, 9, 1, 0, 1], lngRef = 'E', little = false } = {}) {
  const bigEndian = (value, bytes) => { const buffer = new Uint8Array(bytes); for (let i = 0; i < bytes; i++) buffer[i] = value >> (8 * (bytes - 1 - i)) & 0xFF; return buffer }
  const encoder = (value, bytes) => little ? bigEndian(value, bytes).reverse() : bigEndian(value, bytes)
  const text = value => Uint8Array.from([...value].map(char => char.charCodeAt(0)))
  const rational = ([numerator, denominator]) => new Uint8Array([...encoder(numerator, 4), ...encoder(denominator, 4)])
  // 先排版：IFD0(2 + 2*12 + 4) → ExifIFD(2 + 12 + 4) → 日期串 → GPS IFD(2 + 4*12 + 4) → 纬度 3×8 → 经度 3×8
  const ifd0Offset = 8, exifIfdOffset = ifd0Offset + 2 + 2 * 12 + 4, dateOffset = exifIfdOffset + 2 + 12 + 4
  const gpsIfdOffset = dateOffset + 20, latOffset = gpsIfdOffset + 2 + 4 * 12 + 4, lngOffset = latOffset + 24
  const tiff = new Uint8Array(lngOffset + 24)
  const write = (bytes, at) => tiff.set(bytes, at)
  write(text(little ? 'II' : 'MM'), 0); write(encoder(42, 2), 2); write(encoder(ifd0Offset, 4), 4)
  write(encoder(2, 2), ifd0Offset) // IFD0 两项：ExifIFD 指针 + GPS 指针
  write(encoder(0x8769, 2), ifd0Offset + 2); write(encoder(4, 2), ifd0Offset + 4); write(encoder(1, 4), ifd0Offset + 6); write(encoder(exifIfdOffset, 4), ifd0Offset + 10)
  write(encoder(0x8825, 2), ifd0Offset + 14); write(encoder(4, 2), ifd0Offset + 16); write(encoder(1, 4), ifd0Offset + 18); write(encoder(gpsIfdOffset, 4), ifd0Offset + 22)
  write(encoder(0, 4), ifd0Offset + 26)
  write(encoder(1, 2), exifIfdOffset) // DateTimeOriginal
  write(encoder(0x9003, 2), exifIfdOffset + 2); write(encoder(2, 2), exifIfdOffset + 4); write(encoder(20, 4), exifIfdOffset + 6); write(encoder(dateOffset, 4), exifIfdOffset + 10)
  write(encoder(0, 4), exifIfdOffset + 14)
  write(text(date + '\0'), dateOffset)
  write(encoder(4, 2), gpsIfdOffset)
  const entry = (at, tag, type, count, value) => { write(encoder(tag, 2), at); write(encoder(type, 2), at + 2); write(encoder(count, 4), at + 4); write(encoder(value, 4), at + 8) }
  const gps = gpsIfdOffset + 2
  entry(gps, 0x0001, 2, 2, 0) // "N\0" 内联
  write(text(latRef + '\0'), gps + 8)
  entry(gps + 12, 0x0002, 5, 3, latOffset)
  entry(gps + 24, 0x0003, 2, 2, 0)
  write(text(lngRef + '\0'), gps + 32)
  entry(gps + 36, 0x0004, 5, 3, lngOffset)
  write(encoder(0, 4), gps + 48) // next IFD
  const values = latitude.concat(longitude)
  for (let index = 0; index < 6; index++) write(rational(values.slice(index * 2, index * 2 + 2)), latOffset + index * 8)
  const app1 = new Uint8Array([...text('Exif\0\0'), ...tiff])
  return new Uint8Array([...bigEndian(0xFFD8, 2), ...bigEndian(0xFFE1, 2), ...bigEndian(app1.length + 2, 2), ...app1])
}

