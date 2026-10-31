import { createHash } from 'node:crypto'
import { pool } from './db.js'

// LAST_INSERT_ID(expr) returns this statement's atomic count, including when
// other API instances immediately increment the same row afterwards.
export function sharedRateLimit({ scope, max = 20, windowMs = 900000, key = req => req.ip, database = pool } = {}) {
  if (!scope || scope.length > 64 || !Number.isInteger(max) || max < 1 || !Number.isInteger(windowMs) || windowMs < 1) throw new Error('Invalid shared rate limit configuration')
  return async (req, res, next) => {
    try {
      const id = createHash('sha256').update(String(key(req) || req.ip || 'unknown').slice(0, 512)).digest('hex')
      const [result] = await database.execute(`INSERT INTO rate_limits (scope,key_hash,requests,expires_at)
        VALUES (?,?,LAST_INSERT_ID(1),TIMESTAMPADD(MICROSECOND,?,UTC_TIMESTAMP(3)))
        ON DUPLICATE KEY UPDATE requests=LAST_INSERT_ID(IF(expires_at<=UTC_TIMESTAMP(3),1,requests+1)),
        expires_at=IF(expires_at<=UTC_TIMESTAMP(3),TIMESTAMPADD(MICROSECOND,?,UTC_TIMESTAMP(3)),expires_at)`, [scope, id, windowMs * 1000, windowMs * 1000])
      if (Number(result.insertId) > max) return res.set('Retry-After', String(Math.ceil(windowMs / 1000))).status(429).json({ error: '请求过于频繁，请稍后重试' })
      next()
    } catch { next(Object.assign(new Error('请求校验服务暂时不可用，请稍后重试'), { status: 503 })) }
  }
}
