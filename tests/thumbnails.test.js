// @vitest-environment node
import { afterEach, expect, it } from 'vitest'
import sharp from 'sharp'
import express from 'express'
import { mkdtemp, readFile, writeFile, stat, access, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { getThumbnailPath, removeAssetThumbnails, pruneThumbnailCache, createPrivateImageHandler } from '../server/thumbnails.js'
import { collectUnusedAssets } from '../server/asset-lifecycle.js'

const directories = [], servers = []
afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => { server.closeAllConnections(); server.close(resolve) })))
  for (const directory of directories.splice(0)) {
    if (!directory.startsWith(path.resolve(tmpdir()) + path.sep) || !path.basename(directory).startsWith('thumbnail-test-')) throw new Error('Unsafe test cleanup')
    await rm(directory, { recursive: true, force: true })
  }
})
async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), 'thumbnail-test-')); directories.push(directory)
  const original = await sharp({ create: { width: 1600, height: 800, channels: 3, background: '#4d8962' } }).withMetadata().jpeg().toBuffer()
  await writeFile(path.join(directory, 'photo.jpg'), original)
  return { directory, original }
}

it('creates a 512px WebP, removes metadata and leaves the full display image unchanged', async () => {
  const { directory, original } = await fixture()
  const file = await getThumbnailPath(directory, 'photo.jpg')
  const data = await readFile(file), meta = await sharp(data).metadata()
  expect(meta).toMatchObject({ format: 'webp', width: 512, height: 256 })
  expect(meta.exif).toBeUndefined()
  expect(data.length).toBeLessThan(original.length)
  expect(await readFile(path.join(directory, 'photo.jpg'))).toEqual(original)
})

it('shares concurrent generation and reuses the cached file across subsequent requests', async () => {
  const { directory } = await fixture()
  const paths = await Promise.all(Array.from({ length: 12 }, () => getThumbnailPath(directory, 'photo.jpg')))
  expect(new Set(paths).size).toBe(1)
  const before = await stat(paths[0])
  expect(await getThumbnailPath(directory, 'photo.jpg')).toBe(paths[0])
  expect((await stat(paths[0])).mtimeMs).toBe(before.mtimeMs)
  expect(await readdir(path.dirname(paths[0]))).toEqual([path.basename(paths[0])])
})

it('does not enlarge tiny images and invalidates cached variants when a source changes', async () => {
  const { directory } = await fixture()
  const old = await getThumbnailPath(directory, 'photo.jpg')
  await writeFile(path.join(directory, 'photo.jpg'), await sharp({ create: { width: 40, height: 80, channels: 3, background: 'red' } }).jpeg().toBuffer())
  const file = await getThumbnailPath(directory, 'photo.jpg')
  expect(file).not.toBe(old)
  expect(await sharp(await readFile(file)).metadata()).toMatchObject({ width: 40, height: 80 })
})

it('rejects paths and missing or corrupt sources without publishing a derivative', async () => {
  const { directory } = await fixture()
  for (const key of ['../photo.jpg', 'a/b.jpg', '.hidden.jpg', 'a%2fb.jpg', 'photo.jpg?x']) await expect(getThumbnailPath(directory, key)).rejects.toMatchObject({ status: 400 })
  await expect(getThumbnailPath(directory, 'missing.jpg')).rejects.toMatchObject({ status: 404 })
  await writeFile(path.join(directory, 'broken.jpg'), 'broken')
  await expect(getThumbnailPath(directory, 'broken.jpg')).rejects.toMatchObject({ status: 400 })
})

it('removes all versions after source deletion and prunes orphaned caches with a dry-run option', async () => {
  const { directory } = await fixture()
  const thumbnail = await getThumbnailPath(directory, 'photo.jpg')
  await rm(path.join(directory, 'photo.jpg'))
  expect(await pruneThumbnailCache(directory, { dryRun: true })).toBe(1)
  await access(thumbnail)
  expect(await pruneThumbnailCache(directory)).toBe(1)
  await expect(access(thumbnail)).rejects.toMatchObject({ code: 'ENOENT' })
  await removeAssetThumbnails(directory, 'photo.jpg')
})

it('preserves referenced derivatives and removes them with the source after its last reference is removed', async () => {
  const { directory } = await fixture()
  const file = await getThumbnailPath(directory, 'photo.jpg')
  let references = 1, removed = false
  const connection = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async () => [[{ storage_key: 'photo.jpg' }]],
    execute: async sql => sql.includes('AS total') ? [[{ total: references }]] : [[]],
  }
  const database = { getConnection: async () => connection, execute: async () => { removed = true } }
  expect(await collectUnusedAssets(directory, { database, ownerId: 'owner', urls: ['/uploads/photo.jpg'] })).toMatchObject({ retained: 1, deleted: 0 })
  await access(file)
  references = 0
  expect(await collectUnusedAssets(directory, { database, ownerId: 'owner', urls: ['/uploads/photo.jpg'], dryRun: true })).toMatchObject({ deleted: 1 })
  await access(file)
  expect(removed).toBe(false)
  await collectUnusedAssets(directory, { database, ownerId: 'owner', urls: ['/uploads/photo.jpg'] })
  expect(removed).toBe(true)
  await expect(access(file)).rejects.toMatchObject({ code: 'ENOENT' })
  await expect(access(path.join(directory, 'photo.jpg'))).rejects.toMatchObject({ code: 'ENOENT' })
})

it('bounds pending generation while sharing duplicates and rejects oversized sources', async () => {
  const { directory } = await fixture()
  const cached = await getThumbnailPath(directory, 'photo.jpg')
  const tiny = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'blue' } }).jpeg().toBuffer()
  await Promise.all(Array.from({ length: 65 }, (_, index) => writeFile(path.join(directory, `tiny-${index}.jpg`), tiny)))
  const jobs = Array.from({ length: 64 }, (_, index) => getThumbnailPath(directory, `tiny-${index}.jpg`))
  const finished = Promise.allSettled(jobs)
  const duplicate = getThumbnailPath(directory, 'tiny-0.jpg')
  const warmResult = Promise.allSettled([getThumbnailPath(directory, 'photo.jpg')])
  const overflow = Promise.allSettled([getThumbnailPath(directory, 'tiny-64.jpg')])
  const results = await finished
  const files = results.map(result => result.value)
  expect(results.every(result => result.status === 'fulfilled')).toBe(true)
  expect(await duplicate).toBe(files[0])
  expect(await warmResult).toEqual([{ status: 'fulfilled', value: cached }])
  expect((await overflow)[0]).toMatchObject({ status: 'rejected', reason: { status: 503 } })
  await writeFile(path.join(directory, 'large.jpg'), Buffer.alloc(10 * 1024 * 1024 + 1))
  await expect(getThumbnailPath(directory, 'large.jpg')).rejects.toMatchObject({ status: 413 })
})

it('checks ownership even for cached thumbnails and keeps original and derivative responses private', async () => {
  const { directory, original } = await fixture()
  await getThumbnailPath(directory, 'photo.jpg')
  const app = express()
  app.use('/uploads', (req, res, next) => req.get('x-test-user') ? next() : res.sendStatus(401), createPrivateImageHandler(directory, {
    authorize: async (url, req) => {
      if (req.get('x-test-user') !== 'owner' || url !== '/uploads/photo.jpg') throw Object.assign(new Error('missing'), { status: 404 })
      return 'photo.jpg'
    },
  }))
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }))
  const server = app.listen(0, '127.0.0.1'); servers.push(server); await new Promise(resolve => server.once('listening', resolve))
  const base = `http://127.0.0.1:${server.address().port}/uploads/photo.jpg`
  expect((await fetch(base + '?thumbnail=1')).status).toBe(401)
  expect((await fetch(base + '?thumbnail=1', { headers: { 'x-test-user': 'other' } })).status).toBe(404)
  const headers = { 'x-test-user': 'owner' }
  const small = await fetch(base + '?thumbnail=1', { headers })
  expect(small.status).toBe(200)
  expect(small.headers.get('content-type')).toContain('image/webp')
  expect(small.headers.get('cache-control')).toContain('no-store')
  const full = await fetch(base, { headers })
  expect(Buffer.from(await full.arrayBuffer())).toEqual(original)
  for (const query of ['?thumbnail=999', '?thumbnail=1&thumbnail=1', '?thumbnail[width]=9999']) expect((await fetch(base + query, { headers })).status).toBe(400)
})
