const table = new Int32Array(256)
for (let i = 0; i < 256; i++) {
  let value = i
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1
  table[i] = value
}
export function crc32(buffer) {
  let crc = -1
  for (let i = 0; i < buffer.length; i++) crc = table[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}
