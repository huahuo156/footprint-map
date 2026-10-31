// @vitest-environment node
import { beforeAll, afterAll, expect, it } from 'vitest'
import { app } from '../server/app.js'
let server, base
beforeAll(async () => {
  server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  base = `http://127.0.0.1:${server.address().port}`
})
afterAll(async () => { await new Promise(resolve => server.close(resolve)) })
it('denies every private read and upload without a session before touching the database', async () => {
  for (const route of ['/api/journal', '/api/journal/backup', '/api/places?q=杭州', '/uploads/known.jpg']) {
    const response = await fetch(base + route)
    expect(response.status, route).toBe(401)
    expect(response.headers.get('cache-control')).toContain('no-store')
  }
  expect((await fetch(base + '/api/journal/entries', { method: 'POST' })).status).toBe(401)
})
it('closes old shared workspace APIs explicitly', async () => {
  for (const route of ['/api/checkins', '/api/guides/1', '/api/likes/checkin/1', '/api/search', '/api/uploads/checkin-images']) expect((await fetch(base + route, { method: 'POST' })).status, route).toBe(410)
})
it('sets security headers without publicly caching media', async () => {
  const response = await fetch(base + '/uploads/known.jpg')
  expect(response.headers.get('x-content-type-options')).toBe('nosniff')
  expect(response.headers.get('referrer-policy')).toBe('same-origin')
  expect(response.headers.get('content-security-policy-report-only')).toContain("default-src 'self'")
})
