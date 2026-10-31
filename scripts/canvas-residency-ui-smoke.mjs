// Opt-in native-browser integration check. Every record and API response is synthetic.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { chromium, expect } from '@playwright/test'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64')
const requests = [], errors = [], results = []
let sessionRequests = 0
const html = `<!doctype html><html><head><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module">
import React from 'react';
import { createRoot } from 'react-dom/client';
import JourneyCanvas from '/src/journal/JourneyCanvas.jsx';
import CanvasImageResources from '/src/journal/images/CanvasImageResources.jsx';
import { ImageResourceProvider } from '/src/journal/images/ImageResourceProvider.jsx';
import '/src/journal/journal.css';
const params = new URLSearchParams(location.search), count = Number(params.get('count') || 500);
const profile = params.get('profile') || 'desktop', residency = params.get('residency') !== 'off', cache = params.get('cache') === 'on';
localStorage.clear();
localStorage.setItem('shitu-camera-v1:synthetic-owner', JSON.stringify({ x: 0, y: 0, scale: 1, detail: true }));
const data = { trips: [{ id: 'fixture-trip', name: 'Synthetic journey', color: 'sage', canvas_x: 0, canvas_y: 0 }], notebooks: [], notebook_pages: [], canvas_groups: [], entries: Array.from({ length: count }, (_, i) => ({ id: 'entry-' + i, trip_id: 'fixture-trip', title: 'Synthetic ' + i, place_name: 'Synthetic ' + i, entry_date: '2026-01-01', components: [], photos: [{ id: 'photo-' + i, url: '/uploads/fixture-' + i + '.png', canvas_absolute: 1, canvas_x: (i % 40 - 20) * 42, canvas_y: (Math.floor(i / 40) - 6) * 42, rotation: 0 }] })) };
data.notebooks = Array.from({ length: 8 }, (_, i) => ({ id: 'fixture-book-' + i, name: 'Synthetic book ' + i, canvas_x: (i - 4) * 30, canvas_y: -70, rotation: 0, cover_mode: i % 2 ? 'solid' : 'photo', cover_url: i % 2 ? null : '/uploads/fixture-' + (3000 + i) + '.png' }));
// A collapsed cover competes for the same image budget as detail cards.
data.canvas_groups = [{ id: 'fixture-group', name: 'Synthetic cover', color: 'sage', collapsed: true, photo_ids: ['photo-20', 'photo-21', 'photo-22'] }];
const root = createRoot(document.getElementById('root'));
window.smoke = { count, opened: [], moves: [], errors: [], render(defaults = false) {
 const props = { userId: 'synthetic-owner', data, onOpen: (...args) => window.smoke.opened.push(args[1]), onMove: (...args) => window.smoke.moves.push(args), onError: message => window.smoke.errors.push(message), onBatchEdit() {}, onBatchDelete() {}, onSaveGroup: async () => {} };
 if (!defaults) Object.assign(props, { imageResidency: residency, imageCache: cache, imageProfile: profile });
 if (params.get('auto') === 'on') { delete props.imageProfile; root.render(React.createElement(CanvasImageResources, props)); return; }
 root.render(React.createElement(ImageResourceProvider, { enabled: cache, ownerId: 'synthetic-owner', profile, mediaSources: [...data.entries.flatMap(e => e.photos.map(p => p.url)), ...data.notebooks.map(b => b.cover_url).filter(Boolean)] }, React.createElement(JourneyCanvas, props)));
}, unmount() { root.unmount(); } };
window.smoke.render(params.get('defaults') === 'on');
window.smoke.peaks = { images: 0, details: 0 };
new MutationObserver(() => {
 window.smoke.peaks.images = Math.max(window.smoke.peaks.images, document.querySelectorAll('.j-canvas img').length);
 window.smoke.peaks.details = Math.max(window.smoke.peaks.details, document.querySelectorAll('.j-canvas [data-photo-id], .j-canvas [data-notebook-id]').length);
}).observe(document.getElementById('root'), { childList: true, subtree: true });
</script><style>html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}.j-canvas-shell{height:100vh!important}.j-canvas{min-height:0!important;flex:1}</style></body></html>`

const vite = await createServer({ configFile: false, root: process.cwd(), server: { host: '127.0.0.1', port: 0 }, plugins: [{
  name: 'canvas-residency-synthetic-fixtures', configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      const url = new URL(req.url, 'http://localhost')
      if (url.pathname === '/__canvas_residency_smoke__') {
        res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml(url.pathname, html))
      } else if (/^\/uploads\/fixture-\d+\.png$/.test(url.pathname)) {
        requests.push(url.pathname + url.search)
        res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length, 'Cache-Control': 'private, no-store' }); res.end(png)
      } else if (url.pathname === '/api/auth/session') {
        sessionRequests++
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' }); res.end(JSON.stringify({ user: { id: 'synthetic-owner' }, csrfToken: 'synthetic-only' }))
      } else next()
    })
  },
}] })
let browser
try {
  await vite.listen()
  browser = await chromium.launch({ channel: 'msedge' })
  const address = vite.httpServer.address()
  const base = 'http://127.0.0.1:' + address.port + '/__canvas_residency_smoke__'
  const snapshot = page => page.evaluate(() => ({ images: document.querySelectorAll('.j-canvas img').length, details: document.querySelectorAll('.j-canvas [data-photo-id], .j-canvas [data-notebook-id]').length, sources: [...document.querySelectorAll('.j-canvas img')].map(n => n.getAttribute('src')) }))
  for (const profile of ['desktop', 'tablet']) for (const count of [500, 2000]) for (const cache of ['off', 'on']) {
    console.log('Checking synthetic canvas:', profile, count, 'cache=' + cache)
    const page = await browser.newPage({ viewport: profile === 'tablet' ? { width: 1024, height: 768 } : { width: 1440, height: 900 } })
    page.setDefaultTimeout(10000)
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') errors.push(profile + '/' + count + '/' + cache + ': ' + message.text()) })
    const start = requests.length
    await page.goto(base + '?count=' + count + '&profile=' + profile + '&cache=' + cache)
    await expect(page.locator('.j-canvas')).toBeVisible()
    const limits = profile === 'tablet' ? { images: 24, details: 60 } : { images: 48, details: 120 }
    await expect.poll(async () => (await snapshot(page)).images).toBeGreaterThan(0)
    await expect.poll(() => page.locator('.j-canvas img').evaluateAll(nodes => nodes.every(n => n.complete && n.naturalWidth > 0))).toBe(true)
    const initial = await snapshot(page)
    assert(initial.images <= limits.images, JSON.stringify({ profile, count, cache, initial }))
    assert(initial.details <= limits.details, JSON.stringify({ profile, count, cache, initial }))
    if (cache === 'on') assert(initial.sources.every(src => src?.startsWith('blob:')), 'cached detail and group pixels use resource provider')
    await page.getByRole('button', { name: '多选内容', exact: true }).click()
    await page.locator('.j-canvas').press('Control+a')
    await expect(page.locator('.j-selection-bar strong')).toHaveText('已选 ' + Math.min(count, 500) + ' 项')
    const selected = await snapshot(page)
    assert(selected.images <= limits.images, 'selection cannot pin all images')
    assert(selected.details <= limits.details, 'selection cannot pin all detail nodes')
    await page.locator('.j-canvas').press('Escape')
    await page.getByRole('button', { name: '查看全部旅程' }).click()
    const overview = page.locator('.j-residency-overview').last()
    await expect(overview).toBeVisible()
    const beforeZoom = await page.locator('.j-zoom-value').textContent()
    await overview.focus()
    await overview.press('Enter')
    await expect(page.locator('.j-zoom-value')).not.toHaveText(beforeZoom)
    await expect(page.locator('.j-canvas')).toBeFocused()
    await page.getByRole('button', { name: '查看全部旅程' }).click()
    await overview.click()
    await expect(page.locator('.j-zoom-value')).not.toHaveText(beforeZoom)
    assert.deepEqual(await page.evaluate(() => window.smoke.errors), [])
    const peaks = await page.evaluate(() => window.smoke.peaks)
    assert(peaks.images <= limits.images, 'peak image count exceeds budget: ' + JSON.stringify(peaks))
    assert(peaks.details <= limits.details, 'peak detailed node count exceeds budget: ' + JSON.stringify(peaks))
    results.push({ profile, records: count, cache, initial: { images: initial.images, details: initial.details }, selected: { images: selected.images, details: selected.details }, peaks, requests: requests.length - start })
    await page.close()
  }
  // Exercise the real shell with a native held pointer across a viewport change.
  const resizePage = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  resizePage.on('pageerror', error => errors.push('auto-resize: ' + error.message))
  resizePage.on('console', message => { if (message.type() === 'error') errors.push('auto-resize: ' + message.text()) })
  await resizePage.goto(base + '?count=500&cache=on&auto=on')
  await expect(resizePage.locator('.j-canvas-shell')).toHaveAttribute('data-residency-mode', 'desktop')
  await expect.poll(async () => (await snapshot(resizePage)).images).toBeGreaterThan(0)
  await resizePage.evaluate(() => {
    window.smoke.originalCanvas = document.querySelector('.j-canvas')
    window.smoke.resizeViolations = []
    new MutationObserver(() => {
      const mode = document.querySelector('.j-canvas-shell')?.dataset.residencyMode
      const images = document.querySelectorAll('.j-canvas img').length
      if (images > (mode === 'tablet' ? 24 : 48)) window.smoke.resizeViolations.push({ mode, images })
    }).observe(document.getElementById('root'), { subtree: true, childList: true, attributes: true })
  })
  // Select a blank point by hit testing, so photos and notebook covers cannot
  // intercept the pan gesture and turn this into an item drag.
  const blank = await resizePage.locator('.j-canvas').evaluate(canvas => {
    const rect = canvas.getBoundingClientRect()
    for (let y = rect.top + 20; y < rect.bottom - 20; y += 20) {
      for (let x = rect.left + 20; x < rect.right - 20; x += 20) {
        if (document.elementFromPoint(x, y) === canvas) return { x, y }
      }
    }
    throw new Error('Synthetic canvas has no blank gesture point')
  })
  await resizePage.mouse.move(blank.x, blank.y)
  await resizePage.mouse.down()
  await resizePage.mouse.move(blank.x + 10, blank.y + 10)
  await resizePage.setViewportSize({ width: 900, height: 900 })
  await expect(resizePage.locator('.j-canvas-shell')).toHaveAttribute('data-residency-mode', 'desktop')
  assert((await snapshot(resizePage)).images <= 48)
  await resizePage.mouse.up()
  await expect(resizePage.locator('.j-canvas-shell')).toHaveAttribute('data-residency-mode', 'tablet')
  await expect.poll(async () => (await snapshot(resizePage)).images).toBeGreaterThan(0)
  const resized = await snapshot(resizePage)
  assert(resized.images <= 24)
  assert(await resizePage.evaluate(() => window.smoke.originalCanvas === document.querySelector('.j-canvas')), 'resize preserves the canvas DOM node')
  assert.deepEqual(await resizePage.evaluate(() => window.smoke.resizeViolations), [], 'no intermediate profile/image budget mismatch')
  assert.deepEqual(await resizePage.evaluate(() => window.smoke.errors), [])
  results.push({ scenario: 'native held pointer resize', profile: 'desktop to tablet', images: resized.images, canvasPreserved: true })
  await resizePage.close()
  // Compare absent flags with explicit opt-out under identical data and camera.
  const baseline = []
  for (const query of ['defaults=on', 'residency=off']) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(base + '?count=500&' + query)
    await expect(page.locator('.j-canvas')).toBeVisible()
    await expect.poll(async () => (await snapshot(page)).images).toBeGreaterThan(0)
    const state = await snapshot(page)
    baseline.push({ images: state.images, details: state.details })
    await page.close()
  }
  assert.deepEqual(baseline[0], baseline[1], 'default flags preserve explicit opt-out rendering')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ passed: ['image and detail caps including group covers', 'all logical selections preserved without image pins', 'overview click and keyboard activation', 'default opt-out equivalence'], results, baseline, mediaRequests: requests.length, sessionRequests, errors, fixtures: 'synthetic only; no personal data; no performance claims' }, null, 2))
} finally {
  await browser?.close()
  await vite.close()
}
