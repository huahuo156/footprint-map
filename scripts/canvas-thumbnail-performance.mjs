// Isolated production thumbnail-function timings, not HTTP/authentication timings.
import sharp from 'sharp'
import { performance } from 'node:perf_hooks'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { imageDimensions, imagePixels } from '../tests/fixtures/canvas-images.js'
import { percentile, summarizeSamples } from './lib/canvas-performance.mjs'
import { getThumbnailPath } from '../server/thumbnails.js'
import { pool } from '../server/db.js'

const directory = await mkdtemp(path.join(tmpdir(), 'shitu-thumbnail-perf-'))
const output = path.resolve('test-results/canvas-performance', `thumbnail-${Date.now()}`)
await mkdir(output, { recursive: true })
const samples = []
async function cleanupDirectory() {
  const resolved = path.resolve(directory), root = path.resolve(tmpdir()) + path.sep
  if (!resolved.startsWith(root) || !path.basename(resolved).startsWith('shitu-thumbnail-perf-')) throw new Error('Refusing unsafe temporary-directory cleanup')
  await rm(resolved, { recursive: true, force: true })
}
try {
  for (let shape = 0; shape < 3; shape++) for (let run = 1; run <= 5; run++) {
    const { width, height } = imageDimensions(shape), id = shape * 5 + run, name = `synthetic-${id}.jpg`
    const source = await sharp(imagePixels(shape), { raw: { width, height, channels: 3 } }).resize({ width: 2048, height: 2048, fit: 'inside' }).jpeg({ quality: 85 }).toBuffer()
    await writeFile(path.join(directory, name), source)
    const start = performance.now(), cold = await getThumbnailPath(directory, name), coldMs = performance.now() - start
    const warmStart = performance.now(), warm = await getThumbnailPath(directory, name), warmMs = performance.now() - warmStart
    if (cold !== warm) throw new Error('Warm call did not reuse derivative')
    const bytes = await readFile(cold), metadata = await sharp(bytes).metadata()
    if (metadata.width > 512 || metadata.height > 512 || metadata.format !== 'webp') throw new Error('Invalid derivative')
    samples.push({ shape: ['landscape', 'portrait', 'square'][shape], run, sourceWidth: Math.round(width * 2048 / Math.max(width, height)), sourceHeight: Math.round(height * 2048 / Math.max(width, height)), sourceBytes: source.length, thumbnailBytes: bytes.length, coldMs, warmMs })
  }
  const report = { mode: 'production getThumbnailPath; sequential; temp synthetic files only; no HTTP/auth/queue load', database: 'no queries or connections requested; lazy pool closed', samples,
    summary: { coldMs: summarizeSamples(samples.map(s => s.coldMs)), coldP95Ms: percentile(samples.map(s => s.coldMs), .95), warmMs: summarizeSamples(samples.map(s => s.warmMs)) } }
  await writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(`Thumbnail function baseline: 15 cold/warm pairs. Report: ${path.join(output, 'report.json')}`)
} finally {
  await pool.end()
  await cleanupDirectory()
}
