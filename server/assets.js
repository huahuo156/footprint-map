import sharp from 'sharp'
import { readFile, writeFile, stat } from 'node:fs/promises'
import { pool } from './db.js'
import { currentUserId } from './auth.js'

const invalid = (message, status = 400) => Object.assign(new Error(message), { status })
const formats = { jpeg: ['image/jpeg', '.jpg'], png: ['image/png', '.png'], webp: ['image/webp', '.webp'] }
export const MAX_ASSET_BYTES = 10 * 1024 * 1024
export const USER_STORAGE_BYTES = 512 * 1024 * 1024
sharp.concurrency(2)

export function assetFilename(url) {
  const match = typeof url === 'string' && /^\/uploads\/([\w-]+\.(?:jpg|png|webp))$/.exec(url)
  if (!match) throw invalid('图片地址无效')
  return match[1]
}

export async function normalizeImageBuffer(buffer, mimetype) {
  try {
    if (!Buffer.isBuffer(buffer) || buffer.length > MAX_ASSET_BYTES) throw invalid('图片不能超过 10MB')
    const image = sharp(buffer, { limitInputPixels: 40_000_000, failOn: 'warning', animated: false })
    const meta = await image.metadata(), format = formats[meta.format]
    if (!format || (mimetype && mimetype !== format[0]) || (meta.pages || 1) > 1) throw invalid('图片内容与格式不符或不支持动画')
    // Decode and re-encode: metadata is removed by default, orientation is baked in.
    const data = await image.rotate().resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true }).toFormat(meta.format).toBuffer()
    if (data.length > MAX_ASSET_BYTES) throw invalid('处理后的图片不能超过 10MB')
    return { data, mime: format[0], extension: format[1] }
  } catch (error) {
    if (error.status) throw error
    throw invalid('图片无法解码或像素超过 4000 万')
  }
}

export async function normalizeImage(file) {
  const result = await normalizeImageBuffer(await readFile(file.path), file.mimetype)
  await writeFile(file.path, result.data)
  file.size = result.data.length
  file.mimetype = result.mime
  return file
}

export async function registerAsset(file, connection = pool) {
  const owner = currentUserId(), key = assetFilename('/uploads/' + file.filename)
  const bytes = file.size ?? (await stat(file.path)).size
  // Serialize accounting across simultaneous uploads for one user.
  const ownedConnection = connection === pool ? await pool.getConnection() : null
  const db = ownedConnection || connection
  try {
    if (ownedConnection) await db.beginTransaction()
    await db.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [owner])
    const [[usage]] = await db.execute('SELECT COALESCE(SUM(bytes),0) AS bytes FROM assets WHERE owner_id=?', [owner])
    if (Number(usage.bytes) + bytes > USER_STORAGE_BYTES) throw invalid('已达到账号 512MB 图片容量上限', 413)
    await db.execute("INSERT INTO assets (storage_key,owner_id,bytes,mime,status) VALUES (?,?,?,?,'active')", [key, owner, bytes, file.mimetype])
    if (ownedConnection) await db.commit()
  } catch (error) {
    if (ownedConnection) await db.rollback()
    throw error
  } finally { ownedConnection?.release() }
  return '/uploads/' + key
}

export async function assertOwnedAsset(url, connection = pool) {
  const owner = currentUserId(), key = assetFilename(url)
  if (connection !== pool) await connection.execute('SELECT id FROM users WHERE id=? FOR UPDATE', [owner])
  const [[asset]] = await connection.execute("SELECT storage_key FROM assets WHERE storage_key=? AND owner_id=? AND status='active'" + (connection !== pool ? ' FOR UPDATE' : ''), [key, owner])
  if (!asset) throw invalid('图片不存在', 404)
  return key
}
