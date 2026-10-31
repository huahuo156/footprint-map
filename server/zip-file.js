import { open } from 'node:fs/promises'
import { inflateRaw } from 'node:zlib'
import { promisify } from 'node:util'
import { crc32 } from './zip-crc.js'

const inflate = promisify(inflateRaw)
const corrupt = () => Object.assign(new Error('备份压缩包已损坏、格式不支持或超出大小限制。'), { status: 400 })

// The index stores offsets, never image buffers. Each read is independently bounded.
export async function openZipFile(filename, { maxBytes = 576 * 1024 * 1024, maxFileBytes = 10 * 1024 * 1024, maxManifestBytes = 16 * 1024 * 1024 } = {}) {
  const handle = await open(filename, 'r')
  async function range(position, length) {
    if (!Number.isSafeInteger(position) || position < 0 || !Number.isSafeInteger(length) || length < 0) throw corrupt()
    const buffer = Buffer.alloc(length)
    let offset = 0
    while (offset < length) {
      const { bytesRead } = await handle.read(buffer, offset, length - offset, position + offset)
      if (!bytesRead) throw corrupt()
      offset += bytesRead
    }
    return buffer
  }
  try {
    const { size } = await handle.stat()
    if (size < 22 || size > maxBytes) throw corrupt()
    const tailStart = Math.max(0, size - 65557), tail = await range(tailStart, size - tailStart)
    let end = -1
    for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { end = i; break }
    if (end < 0) throw corrupt()
    const count = tail.readUInt16LE(end + 10), centralStart = tail.readUInt32LE(end + 16), centralSize = tail.readUInt32LE(end + 12)
    if (count === 65535 || centralStart === 0xFFFFFFFF || centralSize === 0xFFFFFFFF || centralSize > 16 * 1024 * 1024 || centralStart + centralSize !== tailStart + end || tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6) || tail.readUInt16LE(end + 8) !== count) throw corrupt()
    const central = await range(centralStart, centralSize), files = new Map(), spans = []
    let pointer = 0, total = 0
    for (let i = 0; i < count; i++) {
      if (pointer + 46 > central.length || central.readUInt32LE(pointer) !== 0x02014b50) throw corrupt()
      const flags = central.readUInt16LE(pointer + 8), method = central.readUInt16LE(pointer + 10), crc = central.readUInt32LE(pointer + 16)
      const compressed = central.readUInt32LE(pointer + 20), expanded = central.readUInt32LE(pointer + 24)
      const nameLength = central.readUInt16LE(pointer + 28), extraLength = central.readUInt16LE(pointer + 30), commentLength = central.readUInt16LE(pointer + 32), localOffset = central.readUInt32LE(pointer + 42)
      const next = pointer + 46 + nameLength + extraLength + commentLength
      if (next > central.length || flags & ~0x0808 || ![0, 8].includes(method) || central.readUInt16LE(pointer + 6) >= 45 || central.readUInt16LE(pointer + 34)) throw corrupt()
      const name = central.toString('utf8', pointer + 46, pointer + 46 + nameLength)
      if ((name !== 'backup.json' && !/^photos\/[\w-]+\.(jpg|png|webp)$/.test(name)) || files.has(name)) throw corrupt()
      const limit = name === 'backup.json' ? maxManifestBytes : maxFileBytes
      total += expanded
      if (total > maxBytes || expanded > limit || compressed > limit + 65536 || localOffset >= centralStart || (method === 0 && compressed !== expanded)) throw corrupt()
      const local = await range(localOffset, 30)
      if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(6) !== flags || local.readUInt16LE(8) !== method) throw corrupt()
      const localNameLength = local.readUInt16LE(26), localExtraLength = local.readUInt16LE(28)
      const start = localOffset + 30 + localNameLength + localExtraLength
      if (start + compressed > centralStart || localNameLength !== nameLength || (await range(localOffset + 30, localNameLength)).toString('utf8') !== name) throw corrupt()
      if (!(flags & 8) && (local.readUInt32LE(14) !== crc || local.readUInt32LE(18) !== compressed || local.readUInt32LE(22) !== expanded)) throw corrupt()
      spans.push([localOffset, start + compressed])
      files.set(name, { size: expanded, async read() {
        const raw = await range(start, compressed)
        let data
        try { data = method === 0 ? raw : await inflate(raw, { maxOutputLength: Math.max(1, expanded) }) }
        catch { throw corrupt() }
        if (data.length !== expanded || crc32(data) !== crc) throw corrupt()
        return data
      } })
      pointer = next
    }
    if (pointer !== central.length) throw corrupt()
    spans.sort((a, b) => a[0] - b[0])
    if (spans.some((span, i) => i > 0 && span[0] < spans[i - 1][1])) throw corrupt()
    return { files, close: () => handle.close() }
  } catch (error) { await handle.close(); throw error }
}
