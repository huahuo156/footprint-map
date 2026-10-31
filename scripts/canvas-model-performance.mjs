// Source-level CPU isolation in Node/Vite SSR; not React/browser commit timing.
import { createServer } from 'vite'
import { performance } from 'node:perf_hooks'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createCanvasFixture, imageDimensions } from '../tests/fixtures/canvas-images.js'
import { summarizeSamples } from './lib/canvas-performance.mjs'
const output = path.resolve('test-results/canvas-performance', `model-${Date.now()}`)
await mkdir(output, { recursive: true })
const vite = await createServer({ configLoader: 'runner', server: { middlewareMode: true, watch: null, hmr: false }, appType: 'custom' })
try {
  const { buildCanvas, layoutCanvasGroups } = await vite.ssrLoadModule('/src/journal/model.js')
  const { collisionItems, planCanvasRepair } = await vite.ssrLoadModule('/src/journal/canvasCollision.js')
  const samples = []
  for (const count of [100, 500, 2000]) for (const dimensions of ['unknown', 'known']) {
    const fixture = createCanvasFixture(count), sizes = dimensions === 'known' ? Object.fromEntries(fixture.entries[0].photos.map((photo, index) => [photo.url, imageDimensions(index)])) : {}
    buildCanvas(fixture, sizes, false) // unmeasured JIT warmup
    for (let run = 1; run <= 5; run++) {
      let start = performance.now(); const model = buildCanvas(fixture, sizes, false); const buildMs = performance.now() - start
      start = performance.now(); layoutCanvasGroups(fixture.canvas_groups, model.items); const groupsMs = performance.now() - start
      start = performance.now(); layoutCanvasGroups(fixture.canvas_groups, collisionItems(model.items)); const reservedGroupsMs = performance.now() - start
      start = performance.now(); const repair = planCanvasRepair(fixture); const repairMs = performance.now() - start
      samples.push({ count, dimensions, run, buildMs, groupsMs, reservedGroupsMs, repairMs, repairItems: repair.items.length })
    }
  }
  const summary = [100, 500, 2000].flatMap(count => ['unknown', 'known'].map(dimensions => ({ count, dimensions, ...Object.fromEntries(['buildMs', 'groupsMs', 'reservedGroupsMs', 'repairMs'].map(field => [field, summarizeSamples(samples.filter(s => s.count === count && s.dimensions === dimensions).map(s => s[field]))])) })))
  await writeFile(path.join(output, 'report.json'), JSON.stringify({ mode: 'Node source-function microbenchmark; no React/DOM/GPU; no private data/network/database', samples, summary }, null, 2))
  console.log(`Model function baseline: 30 samples. Report: ${path.join(output, 'report.json')}`)
} finally { await vite.close() }
