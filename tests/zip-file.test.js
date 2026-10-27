// @vitest-environment node
import { afterEach, expect, test } from 'vitest'
import { mkdtemp, writeFile, open, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { createWriteStream } from 'node:fs'
import { deflateRawSync } from 'node:zlib'
import * as zip from '../server/zip.js'

const directories = [], archives = []
afterEach(async () => {
  for (const archive of archives.splice(0)) await archive.close()
  for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
})
async function fixture(entries) {
  const directory = await mkdtemp(path.join(tmpdir(), 'zip-file-')); directories.push(directory)
  const target = path.join(directory, 'backup.zip')
  await pipeline(Readable.from(zip.zipChunks(entries)), createWriteStream(target))
  return target
}
async function load(target, options) {
  const archive = await zip.openZipFile(target, options); archives.push(archive); return archive
}

test('indexes a ZIP larger than 64MiB and reads only the requested image', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'large-zip-')); directories.push(directory)
  const photo = path.join(directory, 'image.png'), handle = await open(photo, 'wx')
  await handle.truncate(8 * 1024 * 1024); await handle.close()
  const entries = [{ name: 'backup.json', data: Buffer.from('{"version":1}') }, ...Array.from({ length: 9 }, (_, i) => ({ name: `photos/image-${i}.png`, path: photo }))]
  const archive = await load(await fixture(entries))
  expect(archive.files.size).toBe(10)
  expect((await archive.files.get('backup.json').read()).toString()).toBe('{"version":1}')
  expect((await archive.files.get('photos/image-8.png').read()).length).toBe(8 * 1024 * 1024)
})

test.each(['../escape.png', '/escape.png', 'photos\\escape.png', 'photos/../escape.png', 'other.txt'])('rejects unsafe or unexpected entry %s', async name => {
  await expect(load(await fixture([{ name, data: Buffer.from('x') }]))).rejects.toMatchObject({ status: 400 })
})

test('rejects duplicate entries, oversized individual files, manifests and expanded totals', async () => {
  await expect(load(await fixture([{ name: 'backup.json', data: Buffer.from('{}') }, { name: 'backup.json', data: Buffer.from('{}') }]))).rejects.toMatchObject({ status: 400 })
  const target = await fixture([{ name: 'backup.json', data: Buffer.alloc(100) }, { name: 'photos/a.png', data: Buffer.alloc(100) }])
  await expect(load(target, { maxManifestBytes: 99 })).rejects.toMatchObject({ status: 400 })
  await expect(load(target, { maxFileBytes: 99 })).rejects.toMatchObject({ status: 400 })
  await expect(load(target, { maxBytes: 199 })).rejects.toMatchObject({ status: 400 })
})

test('checks CRC and rejects truncated directories without extracting files', async () => {
  const target = await fixture([{ name: 'backup.json', data: Buffer.from('{}') }])
  const handle = await open(target, 'r+')
  await handle.write(Buffer.from('!'), 0, 1, 41); await handle.close()
  const archive = await load(target)
  await expect(archive.files.get('backup.json').read()).rejects.toMatchObject({ status: 400 })
  await writeFile(target, Buffer.from('truncated'))
  await expect(load(target)).rejects.toMatchObject({ status: 400 })
})

test('reads old deflated ZIPs asynchronously with output bounds', async () => {
  const content = Buffer.from('{"old":"compatible"}'), name = Buffer.from('backup.json')
  const chunks = []; for await (const chunk of zip.zipChunks([{ name: 'backup.json', data: content }])) chunks.push(chunk)
  const stored = Buffer.concat(chunks), compressed = deflateRawSync(content)
  const local = Buffer.from(stored.subarray(0, 30 + name.length)), central = Buffer.from(stored.subarray(30 + name.length + content.length))
  local.writeUInt16LE(8, 8); local.writeUInt32LE(compressed.length, 18)
  central.writeUInt16LE(8, 10); central.writeUInt32LE(compressed.length, 20)
  central.writeUInt32LE(local.length + compressed.length, central.length - 6)
  const target = await fixture([])
  await writeFile(target, Buffer.concat([local, compressed, central]))
  const archive = await load(target)
  expect(await archive.files.get('backup.json').read()).toEqual(content)
  // Lie about the expanded length in both headers: the decoder must still stop.
  local.writeUInt32LE(1, 22); central.writeUInt32LE(1, 24)
  const bomb = await fixture([])
  await writeFile(bomb, Buffer.concat([local, compressed, central]))
  const bounded = await load(bomb)
  await expect(bounded.files.get('backup.json').read()).rejects.toMatchObject({ status: 400 })
})

test('rejects ZIP64 markers and local/central filename disagreement', async () => {
  const target = await fixture([{ name: 'backup.json', data: Buffer.from('{}') }])
  const handle = await open(target, 'r+'), size = (await handle.stat()).size
  const marker = Buffer.alloc(2); marker.writeUInt16LE(65535)
  await handle.write(marker, 0, 2, size - 12); await handle.close()
  await expect(load(target)).rejects.toMatchObject({ status: 400 })
  const mismatch = await fixture([{ name: 'backup.json', data: Buffer.from('{}') }])
  const changed = await open(mismatch, 'r+')
  await changed.write(Buffer.from('!'), 0, 1, 30); await changed.close()
  await expect(load(mismatch)).rejects.toMatchObject({ status: 400 })
})
