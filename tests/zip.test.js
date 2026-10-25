// @vitest-environment node
import { expect, it } from 'vitest'
import { readZip, zipChunks } from '../server/zip.js'

async function archive(entries) {
  const chunks = []
  for await (const chunk of zipChunks(entries)) chunks.push(chunk)
  return Buffer.concat(chunks)
}

it('round trips UTF-8 names, empty files and photo bytes', async () => {
  const result = readZip(await archive([{ name: '照片/湖边.jpg', data: Buffer.from([0xff, 0xd8, 0xff]) }, { name: 'empty', data: Buffer.alloc(0) }]))
  expect(result.get('照片/湖边.jpg')).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
  expect(result.get('empty')).toHaveLength(0)
})

it('rejects corrupted photo bytes instead of restoring silently damaged photos', async () => {
  const zip = await archive([{ name: 'photo.jpg', data: Buffer.from('precious photo') }])
  zip[30 + 'photo.jpg'.length] ^= 1
  expect(() => readZip(zip)).toThrow(/损坏/)
})

it('rejects duplicate archive paths and excessive decompressed size', async () => {
  const duplicate = await archive([{ name: 'backup.json', data: Buffer.from('one') }, { name: 'backup.json', data: Buffer.from('two') }])
  expect(() => readZip(duplicate)).toThrow()
  const zip = await archive([{ name: 'photo.jpg', data: Buffer.alloc(100) }])
  expect(() => readZip(zip, { maxBytes: 50 })).toThrow()
})
