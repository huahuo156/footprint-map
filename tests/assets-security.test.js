import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { normalizeImageBuffer, assetFilename, assertOwnedAsset } from '../server/assets.js'

describe('private image boundary', () => {
  it('rejects traversal, zip files and encoded separators', () => {
    for (const url of ['/uploads/../secret.jpg', '/uploads/a%2fb.jpg', '/uploads/restore-x.zip', '/uploads/a.jpg?x']) expect(() => assetFilename(url)).toThrow()
    expect(assetFilename('/uploads/cover-abc.jpg')).toBe('cover-abc.jpg')
  })
  it('decodes the actual image and rejects spoofed MIME and broken images', async () => {
    await expect(normalizeImageBuffer(Buffer.from('fake'), 'image/png')).rejects.toMatchObject({ status: 400 })
    const jpeg = await sharp({ create: { width: 8, height: 4, channels: 3, background: 'red' } }).jpeg().toBuffer()
    await expect(normalizeImageBuffer(jpeg, 'image/png')).rejects.toMatchObject({ status: 400 })
  })
  it('strips metadata and emits a bounded, correctly typed display image', async () => {
    const original = await sharp({ create: { width: 8, height: 4, channels: 3, background: 'red' } }).withMetadata().jpeg().toBuffer()
    const result = await normalizeImageBuffer(original, 'image/jpeg')
    expect(result.mime).toBe('image/jpeg')
    expect(result.extension).toBe('.jpg')
    expect((await sharp(result.data).metadata()).exif).toBeUndefined()
  })
  it('never accepts public storage paths as ownership proof', async () => {
    await expect(assertOwnedAsset('/uploads/not-owned.png', { execute: async () => [[]] })).rejects.toMatchObject({ status: 401 })
  })
})
