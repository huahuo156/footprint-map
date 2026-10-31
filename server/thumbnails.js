import sharp from 'sharp'
import { createHash, randomUUID } from 'node:crypto'
import { stat, readFile, mkdir, writeFile, rename, unlink, readdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { assetFilename, assertOwnedAsset, MAX_ASSET_BYTES } from './assets.js'

const pending = new Map(), waiting = []
let generating = false
const failure = (status, message) => Object.assign(new Error(message), { status })
const cacheRoot = directory => path.resolve(directory, '.thumbnails', 'v1')
const fingerprint = info => createHash('sha256').update(`${info.size}:${info.mtimeMs}:${info.ctimeMs}`).digest('hex').slice(0, 24) + '.webp'
function assetCache(directory, key) {
  assetFilename('/uploads/' + key)
  const root = cacheRoot(directory), target = path.resolve(root, key)
  if (path.dirname(target) !== root) throw failure(400, '图片地址无效')
  return target
}
async function sourceInfo(source) {
  try { const info = await stat(source); if (!info.isFile()) throw failure(404, '图片不存在'); return info }
  catch (error) { if (error.code === 'ENOENT') throw failure(404, '图片不存在'); throw error }
}
async function exists(file) {
  try { return (await stat(file)).isFile() } catch (error) { if (error.code === 'ENOENT') return false; throw error }
}
async function acquire() {
  if (!generating) { generating = true; return }
  await new Promise(resolve => waiting.push(resolve))
}
function release() { const next = waiting.shift(); if (next) next(); else generating = false }

async function generate(directory, key) {
  const source = path.resolve(directory, key), folder = assetCache(directory, key)
  let name = fingerprint(await sourceInfo(source)), target = path.join(folder, name)
  if (await exists(target)) return target
  await acquire()
  let temporary
  try {
    const info = await sourceInfo(source)
    if (info.size > MAX_ASSET_BYTES) throw failure(413, '图片不能超过 10MB')
    name = fingerprint(info); target = path.join(folder, name)
    if (await exists(target)) return target
    let data
    try {
      // A bounded buffer avoids libvips retaining file handles on Windows,
      // which would otherwise prevent a just-viewed source being deleted.
      data = await sharp(await readFile(source), { limitInputPixels: 40_000_000, failOn: 'warning', animated: false })
        .rotate().resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78, effort: 3 }).toBuffer()
    } catch { await sourceInfo(source); throw failure(400, '图片无法生成缩略图') }
    await mkdir(folder, { recursive: true })
    temporary = path.join(folder, '.tmp-' + randomUUID())
    await writeFile(temporary, data, { flag: 'wx' })
    if (fingerprint(await sourceInfo(source)) !== name) throw failure(409, '图片已更新，请重试')
    await rename(temporary, target)
    return target
  } finally {
    try { if (temporary) await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error }) }
    finally { release() }
  }
}

export async function getThumbnailPath(directory, key) {
  assetCache(directory, key)
  const source = path.resolve(directory, key)
  if (pending.has(source)) return pending.get(source)
  // Fixed variant + one decoder + bounded queue prevent a photo grid from
  // triggering unbounded native image decoding and memory allocations.
  if (pending.size >= 64) {
    const cached = path.join(assetCache(directory, key), fingerprint(await sourceInfo(source)))
    if (await exists(cached)) return cached
    throw failure(503, '缩略图处理中，请稍后重试')
  }
  const job = generate(directory, key)
  pending.set(source, job)
  try { return await job } finally { if (pending.get(source) === job) pending.delete(source) }
}

export async function removeAssetThumbnails(directory, key) {
  const folder = assetCache(directory, key)
  // Cleanup unlinks the source first. Wait for readers that already opened it
  // before removing derivatives so they cannot leave a fresh orphan behind.
  await pending.get(path.resolve(directory, key))?.catch(() => {})
  await rm(folder, { recursive: true, force: true })
}

export async function pruneThumbnailCache(directory, { dryRun = false } = {}) {
  let entries
  try { entries = await readdir(cacheRoot(directory), { withFileTypes: true }) }
  catch (error) { if (error.code === 'ENOENT') return 0; throw error }
  let removed = 0
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[\w-]+\.(jpg|png|webp)$/.test(entry.name)) continue
    const folder = assetCache(directory, entry.name)
    let current
    try { current = fingerprint(await sourceInfo(path.resolve(directory, entry.name))) }
    catch (error) {
      if (error.status !== 404) throw error
      removed++
      if (!dryRun) await removeAssetThumbnails(directory, entry.name)
      continue
    }
    for (const file of await readdir(folder, { withFileTypes: true })) {
      if (!file.isFile()) continue
      const target = path.join(folder, file.name)
      const staleVariant = /^[a-f0-9]{24}\.webp$/.test(file.name) && file.name !== current
      const oldTemporary = /^\.tmp-[a-f0-9-]{36}$/.test(file.name) && (await stat(target)).mtimeMs < Date.now() - 86400000
      if (!staleVariant && !oldTemporary) continue
      removed++
      if (!dryRun) await unlink(target).catch(error => { if (error.code !== 'ENOENT') throw error })
    }
  }
  return removed
}

export function createPrivateImageHandler(directory, { authorize = url => assertOwnedAsset(url) } = {}) {
  return async (req, res, next) => {
    try {
      // Authorization happens on every request, including a warm disk cache.
      const key = await authorize('/uploads' + req.path, req)
      assetCache(directory, key)
      const variant = req.query.thumbnail
      if (variant !== undefined && variant !== '1' || Object.keys(req.query).some(key => key.startsWith('thumbnail') && key !== 'thumbnail')) throw failure(400, '缩略图参数无效')
      const file = variant === '1' ? await getThumbnailPath(directory, key) : path.resolve(directory, key)
      res.sendFile(file, { dotfiles: variant === '1' ? 'allow' : 'deny', cacheControl: false, lastModified: false, headers: { 'Cache-Control': 'private, no-store' } }, error => { if (error) next(error) })
    } catch (error) { next(error) }
  }
}
