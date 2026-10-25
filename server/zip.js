// 备份用的极简 ZIP 实现：打包只存不压缩（照片本身已是压缩格式），
// 解包支持 store 与 deflate，足够还原自己导出的备份。不支持 ZIP64。
import { readFile } from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let value = i
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1
    table[i] = value
  }
  return table
})()

function crc32(buffer) {
  let crc = -1
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xFF] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function dosDateTime(date) {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    day: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

// entries: [{ name, path?, data? }]。逐个产出块，同一时刻只在内存里放一个文件。
export async function* zipChunks(entries) {
  if (entries.length > 65535) throw new Error('文件太多，暂不支持 ZIP64 备份')
  const chunks = [], central = [], now = dosDateTime(new Date())
  let offset = 0
  const write = buffer => { chunks.push(buffer); offset += buffer.length }
  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name, 'utf8')
    if (nameBuffer.length > 65535) throw new Error('备份中的文件名过长')
    const content = entry.data ?? (await readFile(entry.path))
    if (content.length > 0xFFFFFFFF) throw new Error('有文件太大，无法放进备份')
    const crc = crc32(content)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6) // UTF-8 文件名
    local.writeUInt16LE(now.time, 10)
    local.writeUInt16LE(now.day, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(content.length, 18)
    local.writeUInt32LE(content.length, 22)
    local.writeUInt16LE(nameBuffer.length, 26)
    write(local)
    write(nameBuffer)
    yield* chunks.splice(0)
    yield content
    offset += content.length
    if (offset > 0xFFFFFFFF) throw new Error('备份超过 4GB，暂不支持 ZIP64')
    central.push({ nameBuffer, crc, size: content.length, offset: offset - content.length - nameBuffer.length - 30 })
  }
  const centralStart = offset
  for (const record of central) {
    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(0x0800, 8)
    header.writeUInt16LE(now.time, 12)
    header.writeUInt16LE(now.day, 14)
    header.writeUInt32LE(record.crc, 16)
    header.writeUInt32LE(record.size, 20)
    header.writeUInt32LE(record.size, 24)
    header.writeUInt16LE(record.nameBuffer.length, 28)
    header.writeUInt32LE(record.offset, 42)
    write(header)
    write(record.nameBuffer)
  }
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(central.length, 8)
  eocd.writeUInt16LE(central.length, 10)
  eocd.writeUInt32LE(offset - centralStart, 12)
  eocd.writeUInt32LE(centralStart, 16)
  write(eocd)
  yield* chunks.splice(0)
}

// 返回 Map<文件名, Buffer>。
export function readZip(buffer, { maxBytes = 1024 * 1024 * 1024 } = {}) {
  const corrupt = () => Object.assign(new Error('备份压缩包已损坏或超出大小限制。'), { status: 400 })
  let eocdOffset = -1
  const lowest = Math.max(0, buffer.length - 65557)
  for (let i = buffer.length - 22; i >= lowest; i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocdOffset = i; break }
  }
  if (eocdOffset < 0) throw Object.assign(new Error('读不了这个压缩包，请重新导出备份。'), { status: 400 })
  const count = buffer.readUInt16LE(eocdOffset + 10)
  let pointer = buffer.readUInt32LE(eocdOffset + 16)
  const centralEnd = pointer + buffer.readUInt32LE(eocdOffset + 12)
  if (centralEnd !== eocdOffset || buffer.readUInt16LE(eocdOffset + 4) || buffer.readUInt16LE(eocdOffset + 6)
    || buffer.readUInt16LE(eocdOffset + 8) !== count || eocdOffset + 22 + buffer.readUInt16LE(eocdOffset + 20) !== buffer.length) throw corrupt()
  const files = new Map()
  let totalBytes = 0
  for (let i = 0; i < count; i++) {
    if (pointer + 46 > buffer.length || buffer.readUInt32LE(pointer) !== 0x02014b50) throw Object.assign(new Error('备份压缩包已损坏。'), { status: 400 })
    const method = buffer.readUInt16LE(pointer + 10)
    const compressedSize = buffer.readUInt32LE(pointer + 20)
    const uncompressedSize = buffer.readUInt32LE(pointer + 24)
    const nameLength = buffer.readUInt16LE(pointer + 28)
    const extraLength = buffer.readUInt16LE(pointer + 30)
    const commentLength = buffer.readUInt16LE(pointer + 32)
    const localOffset = buffer.readUInt32LE(pointer + 42)
    if (pointer + 46 + nameLength + extraLength + commentLength > centralEnd || buffer.readUInt16LE(pointer + 8) & 1) throw corrupt()
    const name = buffer.toString('utf8', pointer + 46, pointer + 46 + nameLength)
    totalBytes += uncompressedSize
    if (totalBytes > maxBytes || files.has(name) || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) throw corrupt()
    if (localOffset === 0xFFFFFFFF || compressedSize === 0xFFFFFFFF) throw Object.assign(new Error('暂不支持 ZIP64 备份。'), { status: 400 })
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw Object.assign(new Error('备份压缩包已损坏。'), { status: 400 })
    const localNameLength = buffer.readUInt16LE(localOffset + 26), localExtraLength = buffer.readUInt16LE(localOffset + 28)
    const start = localOffset + 30 + localNameLength + localExtraLength
    if (start + compressedSize > buffer.readUInt32LE(eocdOffset + 16) || buffer.toString('utf8', localOffset + 30, localOffset + 30 + localNameLength) !== name || buffer.readUInt16LE(localOffset + 8) !== method) throw corrupt()
    const raw = buffer.subarray(start, start + compressedSize)
    let data
    if (method === 0) data = raw
    else if (method === 8) {
      try { data = inflateRawSync(raw, { maxOutputLength: Math.max(1, Math.min(uncompressedSize, maxBytes)) }) } catch { throw corrupt() }
    } else throw Object.assign(new Error('备份用了不支持的压缩方式，请用拾途导出的备份还原。'), { status: 400 })
    if (data.length !== uncompressedSize || crc32(data) !== buffer.readUInt32LE(pointer + 16)) throw corrupt()
    files.set(name, data)
    pointer += 46 + nameLength + extraLength + commentLength
  }
  if (pointer !== centralEnd) throw corrupt()
  return files
}
