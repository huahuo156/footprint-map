// Production baseline and three-variant comparison: production UI, synthetic media and explicit mock transport.
import express from 'express'
import sharp from 'sharp'
import { chromium, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, readFile, writeFile, readdir, mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'
import { createCanvasFixture, imagePixels, imageDimensions } from '../tests/fixtures/canvas-images.js'
import { parsePerformanceOptions, performanceCases, percentile, summarizeCases, installCanvasReadinessProbe, compareSummaries, warmReturnTargets } from './lib/canvas-performance.mjs'

const options = parsePerformanceOptions(process.argv.slice(2)), cases = performanceCases(options)
const output = process.env.CANVAS_PERF_OUTPUT || path.resolve('test-results/canvas-performance', `${options.compare ? 'compare' : 'baseline'}-${Date.now()}`)
await mkdir(output, { recursive: true })
const run = promisify(execFile), hash = data => createHash('sha256').update(data).digest('hex')
if (options.compare) {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), 'canvas-perf-builds-'))
  const comparison = { schema: 2, mode: 'compare', options, buildRoot, startedAt: new Date().toISOString(), variants: [], failures: [], summary: [], gates: [] }
  const save = () => writeFile(path.join(output, 'report.json'), JSON.stringify(comparison, null, 2))
  try {
    for (const [name, residency, cache] of [['old', false, false], ['residency', true, false], ['cached', true, true]]) {
      const buildDir = path.join(buildRoot, name), childOutput = path.join(output, name)
      const env = { ...process.env, VITE_CANVAS_IMAGE_RESIDENCY: String(residency), VITE_CANVAS_IMAGE_CACHE: String(cache), CANVAS_PERF_BUILD_DIR: buildDir, CANVAS_PERF_OUTPUT: childOutput }
      console.log(`Building ${name}: residency=${residency} cache=${cache}`)
      const built = await run(process.execPath, ['node_modules/vite/bin/vite.js', 'build', '--configLoader', 'runner', '--outDir', buildDir], { env, windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
      await writeFile(path.join(output, `${name}-build.log`), built.stdout + built.stderr)
      comparison.variants.push({ name, flags: { residency, cache }, buildDir, report: path.join(childOutput, 'report.json') }); await save()
      await run(process.execPath, [fileURLToPath(import.meta.url), ...process.argv.slice(2).filter(arg => arg !== '--compare'), '--baseline'], { env, windowsHide: true, maxBuffer: 64 * 1024 * 1024 }).then(async result => { await writeFile(path.join(output, `${name}-run.log`), result.stdout + result.stderr) })
      comparison.variants.at(-1).data = JSON.parse(await readFile(path.join(childOutput, 'report.json'), 'utf8')); await save()
    }
    const [old, residency, cached] = comparison.variants.map(v => v.data)
    assert.deepEqual(old.mediaManifest, residency.mediaManifest); assert.deepEqual(old.mediaManifest, cached.mediaManifest)
    comparison.summary = compareSummaries(old.summary, residency.summary, cached.summary)
    const gate = (key, name, actual, limit, enough = true, direction = 'max') => comparison.gates.push({ key, name, actual, limit, status: !enough || !Number.isFinite(actual) ? 'incomplete' : (direction === 'min' ? actual >= limit : actual <= limit) ? 'met' : 'missed' })
    for (const item of comparison.summary) {
      const current = cached.summary.find(v => v.key === item.key), previous = old.summary.find(v => v.key === item.key)
      const [count, profile] = item.key.split('/'), enough = current.runs >= 5
      const reduction = item.cachedVsResidency.warmRepeatedMediaRequests
      if (reduction.status === 'N/A') comparison.gates.push({ key: item.key, name: 'repeatMediaReductionPercent', status: 'N/A', actual: null, limit: 80 })
      else gate(item.key, 'repeatMediaReductionPercent', reduction.reductionPercent, 80, enough, 'min')
      if (count === '500') {
        gate(item.key, 'panFrameP95Ms', current.panFrameP95Ms.worst, 32, enough)
        gate(item.key, 'editableMs', current.editableMs.worst, 600, enough)
        gate(item.key, 'visible95Ms', current.visible95Ms.worst, 1500, enough)
        gate(item.key, 'maxBrowserWorkingSetBytes', current.maxBrowserWorkingSetBytes.worst, (profile === 'desktop' ? 650 : 640) * 1024 ** 2, enough)
        const baseline = previous.panFrameP95Ms.median
        gate(item.key, 'panFrameRegressionMs', current.panFrameP95Ms.median - baseline, Math.max(baseline * .2, 2), enough && Number.isFinite(baseline))
      }
      gate(item.key, 'overviewImages', current.overviewImages.worst, profile === 'desktop' ? 48 : 24, enough)
    }
    comparison.gates.push({ name: '2000TenMinuteStress', status: cached.cases.some(c => c.count === 2000 && c.stress?.durationMs >= 600000) ? 'measured' : 'incomplete' })
    comparison.acceptance = 'Raw frontend comparison only; application resource invariants, backend cold/warm, React/model timing and physical-device acceptance require separate evidence.'
    comparison.finishedAt = new Date().toISOString()
  } catch (error) { comparison.failures.push({ error: error.stack || String(error), stdout: error.stdout, stderr: error.stderr }); process.exitCode = 1 }
  await save(); console.log(`Canvas comparison report: ${path.join(output, 'report.json')}`)
  process.exit(process.exitCode || 0)
}
const buildDir = process.env.CANVAS_PERF_BUILD_DIR || path.resolve('dist')
const index = await readFile(path.join(buildDir, 'index.html')), assets = []
for (const file of (await readdir(path.join(buildDir, 'assets'))).filter(name => /\.(js|css)$/.test(name)).sort()) {
  const data = await readFile(path.join(buildDir, 'assets', file)); assets.push({ file, bytes: data.length, sha256: hash(data) })
}
const report = {
  schema: 1, mode: 'baseline', options, startedAt: new Date().toISOString(), build: { indexSha256: hash(index), assets,
    runnerSha256: hash(await readFile(new URL(import.meta.url))), fixtureSha256: hash(await readFile(new URL('../tests/fixtures/canvas-images.js', import.meta.url))), statisticsSha256: hash(await readFile(new URL('./lib/canvas-performance.mjs', import.meta.url))) },
  environment: { platform: os.platform(), release: os.release(), cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, totalMemoryBytes: os.totalmem(), node: process.version, httpLatencyMs: 20, bandwidth: 'unthrottled loopback; not a physical network' },
  boundaries: { api: 'mock journal/session/layout/group transport; no database or personal media', images: 'unique deterministic synthetic WebP, private no-store fixture HTTP', backendThumbnailColdWarm: 'not measured by this frontend runner', frames: 'rAF intervals, not GPU frame time', reactModelTime: 'not directly instrumented; CDP Script/Layout/TaskDuration are separate proxies', browserMemory: 'sum of owned browser-process working sets/private bytes; shared pages may be double counted; GPU VRAM unavailable', totalPageMemory: 'measureUserAgentSpecificMemory unavailable unless existing deployment is cross-origin isolated; no isolation headers added', stress: 'one 10-minute session in final/largest conservative profile, separate from five short-run samples' },
  expectedCases: cases.length, mediaManifest: [], cases: [], partialCases: [], failures: [],
}
const media = new Map()
sharp.concurrency(1)
for (let id = 0; id < Math.max(...options.counts); id++) {
  const dimensions = imageDimensions(id)
  const bytes = await sharp(imagePixels(id), { raw: { ...dimensions, channels: 3 } }).resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true }).webp({ quality: 78, effort: 3 }).toBuffer()
  media.set(`/uploads/perf-image-${id}.webp`, bytes)
  report.mediaManifest.push({ id, ...dimensions, bytes: bytes.length, sha256: hash(bytes) })
  if ((id + 1) % 100 === 0) console.log(`Synthetic images prepared ${id + 1}/${Math.max(...options.counts)}`)
}
assert.equal(new Set(report.mediaManifest.map(item => item.sha256)).size, media.size, 'Every media body must be distinct')

let scenario = null, browser = null
const app = express(); app.disable('etag'); app.use(express.json({ limit: '2mb' }))
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'private, no-store'); next() })
app.get('/api/auth/session', (_req, res) => res.json({ user: { id: 'perf-user', email: 'synthetic@example.com', email_verified: true }, csrfToken: 'fixture-only' }))
app.get('/api/journal', (_req, res) => res.json(scenario.journal))
app.patch('/api/journal/layout', (req, res) => {
  const journal = scenario.journal, rows = new Map(journal.entries.flatMap(entry => [[`entry:${entry.id}`, entry], ...entry.photos.map(photo => [`photo:${photo.id}`, photo])]))
  if (scenario.injectConflict) {
    scenario.injectConflict = false; scenario.conflictResponses++
    const photo = journal.entries[0].photos[0]
    photo.canvas_x += 1; photo.layout_version = String(BigInt(photo.layout_version) + 1n)
    return res.status(409).json({ error: 'Synthetic concurrent edit', code: 'LAYOUT_CONFLICT' })
  }
  if (req.body.expected_structure_version !== journal.structure_version || req.body.items.some(item => rows.get(`${item.kind}:${item.id}`)?.layout_version !== item.expected_version)) return res.status(409).json({ error: 'Fixture layout conflict', code: 'LAYOUT_CONFLICT' })
  const items = req.body.items.map(item => {
    const row = rows.get(`${item.kind}:${item.id}`)
    Object.assign(row, { canvas_x: item.x, canvas_y: item.y, rotation: item.rotation, canvas_absolute: 1, layout_version: String(BigInt(row.layout_version) + 1n) })
    return { kind: item.kind, id: item.id, layout_version: row.layout_version }
  })
  scenario.layoutWrites++; res.json({ saved: items.length, items })
})
app.patch('/api/journal/groups/:id', (req, res) => {
  const journal = scenario.journal, group = journal.canvas_groups.find(value => value.id === req.params.id)
  if (!group || req.body.expected_structure_version !== journal.structure_version) return res.status(409).json({ error: 'Fixture group conflict' })
  for (const p of req.body.positions || []) {
    const row = journal.entries[0].photos.find(value => value.id === p.id)
    if (!row || row.layout_version !== p.expected_version) return res.status(409).json({ error: 'Fixture row conflict' })
  }
  for (const p of req.body.positions || []) {
    const row = journal.entries[0].photos.find(value => value.id === p.id)
    if (row.canvas_x !== p.x || row.canvas_y !== p.y || row.rotation !== p.rotation) Object.assign(row, { canvas_x: p.x, canvas_y: p.y, rotation: p.rotation, layout_version: String(BigInt(row.layout_version) + 1n) })
  }
  if (group.collapsed !== req.body.collapsed) journal.structure_version = String(BigInt(journal.structure_version) + 1n)
  Object.assign(group, { collapsed: req.body.collapsed }); scenario.groupWrites++; res.json(group)
})
app.use('/api', (req, res) => res.status(404).json({ error: `Unexpected fixture API ${req.method} ${req.path}` }))
app.get('/uploads/:file', (req, res) => {
  const bytes = media.get('/uploads/' + req.params.file), active = scenario
  if (!bytes || req.query.thumbnail !== '1') return res.status(404).end()
  active.serverRequests++; active.serverActive++; active.serverPeak = Math.max(active.serverPeak, active.serverActive)
  let finished = false
  const done = () => { if (!finished) { finished = true; active.serverActive-- } }
  res.once('finish', done); res.once('close', done)
  const timer = setTimeout(() => { if (!res.destroyed) res.set({ 'Cache-Control': 'private, no-store', 'Content-Type': 'image/webp' }).send(bytes) }, 20)
  res.once('close', () => clearTimeout(timer))
})
app.use(express.static(buildDir))
app.get('/{*path}', (_req, res) => res.sendFile(path.join(buildDir, 'index.html')))
const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
const baseURL = `http://127.0.0.1:${server.address().port}`
const writeReport = async () => { report.summary = summarizeCases(report.cases); await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)) }

async function processMemory(browserSession) {
  if (process.platform !== 'win32') return null
  try {
    const processes = (await browserSession.send('SystemInfo.getProcessInfo')).processInfo
    const ids = processes.map(p => Number(p.id)).filter(id => Number.isSafeInteger(id) && id > 0)
    if (!ids.length) return null
    const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Get-Process -Id ${ids.join(',')} -ErrorAction SilentlyContinue | Select-Object Id,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress`], { windowsHide: true, maxBuffer: 1024 * 1024 })
    const parsed = JSON.parse(stdout), values = Array.isArray(parsed) ? parsed : [parsed]
    return { processCount: values.length, workingSetBytes: values.reduce((sum, p) => sum + p.WorkingSet64, 0), privateBytes: values.reduce((sum, p) => sum + p.PrivateMemorySize64, 0) }
  } catch { return null }
}
async function runCase(config, doStress) {
  const started = performance.now(), phases = [], memory = [], errors = [], attempts = new Map(), activeRequests = new Set()
  let peakRequests = 0, encodedBytes = 0, failedRequests = 0
  scenario = { journal: createCanvasFixture(config.count), layoutWrites: 0, groupWrites: 0, conflictResponses: 0, serverRequests: 0, serverActive: 0, serverPeak: 0 }
  browser = await chromium.launch({ channel: process.platform === 'win32' ? 'msedge' : undefined, args: ['--enable-precise-memory-info'] })
  report.environment.browser = browser.version()
  const browserSession = await browser.newBrowserCDPSession()
  const context = await browser.newContext({ viewport: config.profile === 'desktop' ? { width: 1440, height: 1000 } : { width: 1024, height: 844 }, colorScheme: config.theme, hasTouch: config.profile === 'tablet', isMobile: config.profile === 'tablet' })
  try {
    const page = await context.newPage(); page.setDefaultTimeout(30000)
    page.on('pageerror', error => errors.push(error.message))
    const session = await context.newCDPSession(page)
    await session.send('Network.enable'); await session.send('Performance.enable')
    session.on('Network.requestWillBeSent', event => {
      if (!event.request.url.includes('/uploads/perf-image-')) return
      attempts.set(event.requestId, event.request.url); activeRequests.add(event.requestId); peakRequests = Math.max(peakRequests, activeRequests.size)
    })
    session.on('Network.loadingFinished', event => { if (activeRequests.delete(event.requestId)) encodedBytes += event.encodedDataLength })
    session.on('Network.loadingFailed', event => { if (activeRequests.delete(event.requestId)) failedRequests++ })
    await page.addInitScript(() => {
      localStorage.setItem('shitu-camera-v1:perf-user', JSON.stringify({ x: 0, y: 0, scale: .8, detail: true }))
      const audit = window.canvasPerfAudit = { current: 'cold', frames: {}, longTasks: [], longTaskSupported: PerformanceObserver.supportedEntryTypes.includes('longtask'), last: null, started: 0, firstImageMs: null }
      const frame = now => { if (audit.last !== null) (audit.frames[audit.current] ||= []).push(now - audit.last); audit.last = now; requestAnimationFrame(frame) }
      requestAnimationFrame(frame)
      if (PerformanceObserver.supportedEntryTypes.includes('longtask')) new PerformanceObserver(list => { for (const item of list.getEntries()) audit.longTasks.push({ start: item.startTime, duration: item.duration }) }).observe({ type: 'longtask', buffered: true })
      document.addEventListener('load', event => { if (audit.firstImageMs === null && event.target instanceof HTMLImageElement && event.target.src.includes('/uploads/perf-image-')) audit.firstImageMs = performance.now() }, true)
    })
    await page.addInitScript(installCanvasReadinessProbe)
    let phaseNetworkStart = 0
    const begin = name => { phaseNetworkStart = attempts.size; return page.evaluate(name => { window.canvasPerfAudit.current = name; window.canvasPerfAudit.last = null; window.canvasPerfAudit.started = performance.now() }, name) }
    const take = async name => {
      const dom = await page.evaluate(() => {
        const audit = window.canvasPerfAudit, region = document.querySelector('.j-canvas')?.getBoundingClientRect()
        const images = [...document.querySelectorAll('.j-canvas img')], visible = images.filter(node => { const b = node.getBoundingClientRect(); return region && b.right > region.left && b.left < region.right && b.bottom > region.top && b.top < region.bottom })
        const result = { images: images.length, visibleImages: visible.length, visibleReady: visible.filter(node => node.complete && node.naturalWidth > 0).length, cards: document.querySelectorAll('[data-photo-id]').length, nodes: document.getElementsByTagName('*').length, firstImageMs: audit.firstImageMs, durationMs: performance.now() - audit.started, frames: audit.frames[audit.current] || [], longTasks: audit.longTaskSupported ? audit.longTasks.filter(t => t.start >= audit.started) : null, pageMemoryCapability: { crossOriginIsolated, apiAvailable: typeof performance.measureUserAgentSpecificMemory === 'function' } }
        audit.current = 'between'; audit.last = null; return result
      })
      const metrics = Object.fromEntries((await session.send('Performance.getMetrics')).metrics.map(item => [item.name, item.value]))
      const { frames, longTasks, durationMs, ...counts } = dom
      const urls = [...attempts.values()], known = new Set(urls.slice(0, phaseNetworkStart))
      let repeatedMediaRequests = 0
      for (const url of urls.slice(phaseNetworkStart)) { if (known.has(url)) repeatedMediaRequests++; known.add(url) }
      phases.push({ name, repeatedMediaRequests, durationMs, dom: counts, frames, frameP95Ms: percentile(frames, .95), longTasks, metrics, mediaRequests: attempts.size - phaseNetworkStart, cumulativeMediaRequests: attempts.size })
      if (name.startsWith('warmReturn')) phases.at(-1).requestedMediaUrls = urls.slice(phaseNetworkStart)
    }
    const sampleMemory = async name => { const value = await processMemory(browserSession); if (value) memory.push({ phase: name, ...value }) }
    const ready = () => expect(page.getByLabel('布局保存状态').getByRole('status')).toHaveText('已保存')
    const canvas = page.getByRole('region', { name: /旅行照片画布/ })
    await page.goto(baseURL); await ready()
    await page.waitForFunction(() => Number.isFinite(window.canvasPerfReadyMs))
    const editableMs = await page.evaluate(() => window.canvasPerfReadyMs)
    await page.waitForFunction(() => {
      const region = document.querySelector('.j-canvas').getBoundingClientRect()
      const visible = [...document.querySelectorAll('.j-canvas img')].filter(node => { const b = node.getBoundingClientRect(); return b.right > region.left && b.left < region.right && b.bottom > region.top && b.top < region.bottom })
      // Loading resource placeholders are also intended display consumers; excluding
      // them would report 95% readiness as soon as the first cached img appears.
      const failed = [...document.querySelectorAll('.j-canvas .j-image-failed')].filter(node => { const b = node.getBoundingClientRect(); return b.right > region.left && b.left < region.right && b.bottom > region.top && b.top < region.bottom })
      return visible.length > 0 && visible.filter(node => node.complete && node.naturalWidth > 0).length / (visible.length + failed.length) >= .95
    })
    const visible95Ms = await page.evaluate(() => performance.now())
    assert.equal(await page.locator('.j-canvas .j-image-failed[aria-label*="暂时无法显示"]').count(), 0, 'Synthetic thumbnail errors must not count as readiness')
    await page.waitForTimeout(200); await take('cold'); await sampleMemory('cold')
    async function pan(dx, dy = 0, duration = options.pathMs, steps = 8) {
      const box = await canvas.boundingBox(), x = box.x + box.width / 2, y = box.y + box.height / 2
      const segments = Math.max(1, Math.ceil(Math.max(Math.abs(dx) / (box.width * .35), Math.abs(dy) / (box.height * .35))))
      await canvas.focus(); await page.keyboard.down('Space')
      for (let segment = 0; segment < segments; segment++) {
        await page.mouse.move(x, y); await page.mouse.down()
        for (let step = 1; step <= steps; step++) { await page.mouse.move(x + dx / segments * step / steps, y + dy / segments * step / steps); await page.waitForTimeout(duration / segments / steps) }
        await page.mouse.up()
      }
      await page.keyboard.up('Space')
    }
    for (const [name, dx] of [['panA', 900], ['panB', -1800], ['panReturn', 900]]) { await begin(name); await pan(dx); await take(name) }
    // Native center zoom and mouse panning only. Read the live transform after
    // every move: zoom scales the camera translation as well as photo positions.
    await begin('warmReturnA')
    for (let step = 0; step < 4; step++) await page.getByRole('button', { name: '放大画布', exact: true }).click()
    const cameraSnapshot = () => page.evaluate(() => {
      const region = document.querySelector('.j-canvas'), matrix = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.j-world')).transform)
      return { x: matrix.e - region.clientWidth / 2, y: matrix.f - region.clientHeight / 2, scale: matrix.a, width: region.clientWidth, height: region.clientHeight }
    })
    const returnCamera = await cameraSnapshot()
    const targets = warmReturnTargets(scenario.journal.entries.flatMap(entry => entry.photos), returnCamera, returnCamera.scale)
    for (const target of targets) {
      if (target.name !== 'warmReturnA') await begin(target.name)
      const camera = await cameraSnapshot()
      await pan(-target.x * camera.scale - camera.x, -target.y * camera.scale - camera.y, 350, 2)
      await page.waitForTimeout(500)
      await take(target.name)
      phases.at(-1).camera = await cameraSnapshot()
      phases.at(-1).worldTarget = target
      phases.at(-1).photos = await canvas.locator('[data-photo-id]').evaluateAll(nodes => nodes.map(node => ({ id: node.dataset.photoId, source: node.querySelector('img')?.getAttribute('src') })))
    }
    await sampleMemory('warmReturnEnd')
    await begin('overview'); await page.getByRole('button', { name: '查看全部旅程', exact: true }).click(); await page.waitForTimeout(500); await take('overview'); await sampleMemory('overview')
    async function editAndFold() {
      await page.getByRole('button', { name: '多选内容', exact: true }).click()
      await page.keyboard.press('ControlOrMeta+a'); await page.keyboard.press('f')
      const saved = page.waitForResponse(response => response.url().endsWith('/api/journal/layout') && response.request().method() === 'PATCH' && response.status() === 200)
      await page.keyboard.press('ArrowRight'); await saved; await ready()
      assert.ok(await page.getByRole('button', { name: '撤销布局', exact: true }).isEnabled(), 'Keyboard edit must create history')
      const undone = page.waitForResponse(response => response.url().endsWith('/api/journal/layout') && response.request().method() === 'PATCH' && response.status() === 200)
      await page.keyboard.press('ControlOrMeta+z'); await undone; await ready()
      await page.keyboard.press('Escape')
      for (const action of ['折叠', '展开']) {
        const button = page.getByRole('button', { name: `${action}分组：性能外层`, exact: true })
        const grouped = page.waitForResponse(response => response.url().endsWith('/api/journal/groups/perf-outer') && response.request().method() === 'PATCH' && response.status() === 200)
        await button.evaluate(node => node.focus({ preventScroll: true })); await page.keyboard.press('Enter'); await grouped; await ready()
      }
      await canvas.focus()
    }
    await begin('editFold'); await editAndFold(); await take('editFold'); await sampleMemory('editFoldEnd')
    // Frame-all can aggregate every photo at low zoom. Reveal the central photos
    // through the same native controls in every variant before testing dragging.
    // Keep this outside the measured warm-pan and drag/undo phases.
    for (let step = 0; step < 8; step++) await page.getByRole('button', { name: '放大画布', exact: true }).click()
    await page.waitForTimeout(200)
    await begin('dragUndo')
    const grouped = new Set(scenario.journal.canvas_groups.flatMap(group => group.photo_ids))
    const candidates = await canvas.locator('[data-kind="photo"]').evaluateAll(nodes => {
      const region = document.querySelector('.j-canvas').getBoundingClientRect()
      return nodes.filter(node => { const b = node.getBoundingClientRect(); return b.x + b.width / 2 > region.left + 20 && b.x + b.width / 2 < region.right - 20 && b.y + b.height / 2 > region.top + 20 && b.y + b.height / 2 < region.bottom - 20 }).map(node => node.dataset.photoId)
    })
    const dragId = candidates.find(id => !grouped.has(id)); assert.ok(dragId, 'A visible ungrouped photo must be draggable')
    const row = scenario.journal.entries[0].photos.find(photo => photo.id === dragId), origin = { x: row.canvas_x, y: row.canvas_y }, beforeDrag = scenario.layoutWrites
    const card = canvas.locator(`[data-photo-id="${dragId}"]`), bounds = await card.boundingBox(), cx = bounds.x + bounds.width / 2, cy = bounds.y + bounds.height / 2
    await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 8, cy, { steps: 3 }); await page.mouse.up()
    await expect.poll(() => scenario.layoutWrites).toBe(beforeDrag + 1); await ready()
    await canvas.focus(); await page.keyboard.press('ControlOrMeta+z'); await ready()
    await expect.poll(() => scenario.layoutWrites).toBe(beforeDrag + 2)
    assert.equal(row.canvas_x, origin.x); assert.equal(row.canvas_y, origin.y); await take('dragUndo'); await sampleMemory('dragUndoEnd')
    await begin('conflictRecovery')
    await page.getByRole('button', { name: '多选内容', exact: true }).click(); await page.keyboard.press('ControlOrMeta+a')
    scenario.injectConflict = true; await page.keyboard.press('ArrowRight')
    const recover = page.getByRole('button', { name: '丢弃本页布局并重新载入', exact: true }); await expect(recover).toBeVisible()
    page.once('dialog', dialog => dialog.accept()); await recover.click(); await ready()
    assert.equal(scenario.conflictResponses, 1); await expect(recover).toHaveCount(0)
    await canvas.focus(); await page.keyboard.press('Escape'); await take('conflictRecovery'); await sampleMemory('conflictRecoveryEnd')
    await begin('idle'); await page.waitForTimeout(200); await take('idle'); await sampleMemory('idle')
    const shortNetwork = { requests: attempts.size, uniqueUrls: new Set(attempts.values()).size, completedEncodedBytes: encodedBytes, peakLogicalRequests: peakRequests, failedRequests, remainingRequests: activeRequests.size }
    if (config.run === 1) await page.screenshot({ path: path.join(output, `${config.count}-${config.profile}-${config.theme}.png`) })
    let stress = null
    if (doStress) {
      const stressStart = performance.now(); let iterations = 0, lastLog = 0
      await begin('stress')
      while (performance.now() - stressStart < options.stressMs) {
        await pan(iterations % 2 ? -200 : 200)
        await page.getByRole('button', { name: '查看全部旅程', exact: true }).click()
        await editAndFold(); iterations++
        if (performance.now() - lastLog > 30000) {
          const value = await processMemory(browserSession)
          if (value) memory.push({ phase: 'stress', elapsedMs: performance.now() - stressStart, ...value })
          console.log(`Stress ${config.count}/${config.profile}/${config.theme}: ${Math.round((performance.now() - stressStart) / 1000)}/${options.stressMs / 1000}s, ${iterations} edit cycles`)
          if (os.freemem() < 1024 ** 3 || value?.workingSetBytes > 3 * 1024 ** 3) throw new Error('Host resource guard: stop before exhausting memory')
          lastLog = performance.now()
        }
      }
      stress = { durationMs: performance.now() - stressStart, iterations }; await take('stress'); await sampleMemory('stressEnd')
    }
    assert.deepEqual(errors, [])
    const result = { ...config, editableMs, visible95Ms, durationMs: performance.now() - started, phases, memory, stress, shortNetwork,
      writes: { layout: scenario.layoutWrites, groups: scenario.groupWrites, conflicts: scenario.conflictResponses }, errors,
      network: { requests: attempts.size, uniqueUrls: new Set(attempts.values()).size, completedEncodedBytes: encodedBytes, peakLogicalRequests: peakRequests, failedRequests, remainingRequests: activeRequests.size, serverRequests: scenario.serverRequests, serverPeakActiveHandlers: scenario.serverPeak } }
    await session.detach(); await browserSession.detach()
    return result
  } catch (error) {
    error.performanceSample = { ...config, completed: false, phases, memory, network: { requests: attempts.size, uniqueUrls: new Set(attempts.values()).size, failedRequests }, error: error.message }
    throw error
  } finally { await context.close(); await browser.close(); browser = null }
}
try {
  for (let index = 0; index < cases.length; index++) {
    const config = cases[index], label = `${config.count}/${config.profile}/${config.theme}/${config.run}`
    console.log(`Baseline ${index + 1}/${cases.length}: ${label}`)
    try { report.cases.push(await runCase(config, index === cases.length - 1 && options.stressMs > 0)) }
    catch (error) {
      report.failures.push({ ...config, error: error.stack || String(error) })
      if (error.performanceSample) report.partialCases.push(error.performanceSample)
      console.log(`FAILED ${label}: ${error.message}`)
      if (error.message.includes('Host resource guard')) throw error
    }
    finally { await writeReport() }
    if (report.cases.at(-1)?.count === config.count && report.cases.at(-1)?.profile === config.profile && report.cases.at(-1)?.theme === config.theme && report.cases.at(-1)?.run === config.run) console.log(`Completed ${label}: ${report.cases.at(-1).shortNetwork.requests} short-run media requests`)
  }
  report.finishedAt = new Date().toISOString(); await writeReport()
  console.log(`Canvas baseline complete: ${report.cases.length} cases. Report: ${path.join(output, 'report.json')}`)
  if (report.failures.length) process.exitCode = 1
} finally {
  await browser?.close()
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
}
