// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import express from 'express'
import { createPlaceSearchRouter } from '../server/place-search.js'
import { wgs84ToGcj02 } from '../src/lib/coordTransform.js'
vi.mock('../server/db.js', () => ({ pool: {} }))
import { components } from '../server/journal.js'

const servers = []
afterEach(async () => { await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve)))) })
async function serve(fetchImpl, key = 'private-test-key') {
  const app = express()
  app.use('/places', createPlaceSearchRouter({ fetchImpl, getKey: () => key }))
  const server = app.listen(0, '127.0.0.1'); servers.push(server)
  await new Promise(resolve => server.once('listening', resolve))
  return `http://127.0.0.1:${server.address().port}/places`
}
it('returns usable places in WGS84, filters invalid locations and caches repeated queries', async () => {
  const upstream = vi.fn(async () => ({ ok: true, json: async () => ({ status: '1', pois: [
    { id: 'school', name: '中南民族大学', pname: '湖北省', cityname: '武汉市', adname: '洪山区', address: '民族大道182号', location: '114.399,30.493' },
    { id: 'bad', name: '空位置', location: '' },
  ] }) }))
  const base = await serve(upstream)
  const response = await fetch(base + '?q=' + encodeURIComponent('中南民族大学'))
  const result = await response.json()
  expect(result.places).toHaveLength(1)
  expect(result.places[0]).toMatchObject({ id: 'school', name: '中南民族大学', address: '湖北省武汉市洪山区民族大道182号' })
  const [lng, lat] = wgs84ToGcj02(result.places[0].lng, result.places[0].lat)
  expect(lng).toBeCloseTo(114.399, 6); expect(lat).toBeCloseTo(30.493, 6)
  expect(JSON.stringify(result)).not.toContain('private-test-key')
  await fetch(base + '?q=' + encodeURIComponent('中南民族大学'))
  expect(upstream).toHaveBeenCalledTimes(1)
})
it('rejects invalid queries before contacting the provider', async () => {
  const upstream = vi.fn(), base = await serve(upstream)
  expect((await fetch(base + '?q=' + 'a'.repeat(81))).status).toBe(400)
  expect((await fetch(base + '?q=x&q=y')).status).toBe(400)
  expect(upstream).not.toHaveBeenCalled()
})
it('handles platform mismatch and network errors without exposing the key', async () => {
  const upstream = vi.fn(async () => ({ ok: true, json: async () => ({ status: '0', info: 'USERKEY_PLAT_NOMATCH', infocode: '10009' }) }))
  const base = await serve(upstream)
  const response = await fetch(base + '?q=school')
  expect(response.status).toBe(503)
  expect((await response.json()).error).toContain('Web 服务')
  upstream.mockRejectedValueOnce(new Error('https://provider/?key=private-test-key'))
  const failed = await fetch(base + '?q=other')
  expect(await failed.text()).not.toContain('private-test-key')
})

it('keeps selected address and provider details when validating stored photo metadata', () => {
  const value = { name: '中南民族大学', lat: 30.49, lng: 114.39, address: '湖北省武汉市洪山区民族大道182号', provider: 'amap', poi_id: 'school' }
  expect(components([{ type: 'place', value }])[0].value).toMatchObject(value)
})
