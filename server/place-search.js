import { Router } from 'express'
import { gcj02ToWgs84 } from '../src/lib/coordTransform.js'

const plain = value => typeof value === 'string' ? value : ''
const unavailable = '在线地点搜索暂时不可用，仍可手动填写地点。'
export function createPlaceSearchRouter({ fetchImpl = globalThis.fetch, getKey = () => process.env.AMAP_WEB_SERVICE_KEY } = {}) {
  const router = Router(), cache = new Map()
  router.get('/', async (req, res) => {
    if (typeof req.query.q !== 'string' || req.query.q.trim().length > 80) return res.status(400).json({ error: '请填写 80 字以内的地点关键词。' })
    const query = req.query.q.trim()
    if (query.length < 2) return res.json({ places: [] })
    const key = getKey()?.trim()
    if (!key) return res.status(503).json({ error: unavailable })
    const cached = cache.get(query)
    if (cached?.expires > Date.now()) return res.json({ places: cached.places })
    const url = new URL('https://restapi.amap.com/v3/place/text')
    url.search = new URLSearchParams({ key, keywords: query, offset: '6', page: '1', extensions: 'base' })
    try {
      const response = await fetchImpl(url, { signal: AbortSignal.timeout(6000) })
      if (!response.ok) return res.status(503).json({ error: unavailable })
      const data = await response.json()
      if (data.status !== '1') return res.status(503).json({ error: data.info === 'USERKEY_PLAT_NOMATCH' ? '地点搜索的 Key 类型不匹配，请配置 Web 服务 Key。仍可手动填写地点。' : unavailable })
      const places = (Array.isArray(data.pois) ? data.pois : []).slice(0, 6).flatMap(poi => {
        const location = plain(poi.location).split(',')
        if (location.length !== 2 || location.some(value => !value.trim())) return []
        const [gcjLng, gcjLat] = location.map(Number)
        if (!Number.isFinite(gcjLng) || !Number.isFinite(gcjLat) || Math.abs(gcjLng) > 180 || Math.abs(gcjLat) > 90 || !plain(poi.name)) return []
        const [lng, lat] = gcj02ToWgs84(gcjLng, gcjLat)
        const region = [...new Set([poi.pname, poi.cityname, poi.adname].map(plain).filter(Boolean))].join('')
        return [{ id: plain(poi.id), name: plain(poi.name), address: region + plain(poi.address), lat, lng }]
      })
      if (cache.size >= 100) cache.delete(cache.keys().next().value)
      cache.set(query, { places, expires: Date.now() + 5 * 60 * 1000 })
      return res.json({ places })
    } catch { return res.status(503).json({ error: unavailable }) }
  })
  return router
}
